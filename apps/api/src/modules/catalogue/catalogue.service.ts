import type { MovieStatus, Prisma, ScreenFormat } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { toCents } from '../../lib/money.js';
import { dayRange, localDateKey } from '../../lib/format.js';
import { getSettings, type Settings } from '../settings/settings.service.js';
import { availabilityLabel } from '../pricing/pricing.js';

export interface MovieFilters {
  status?: MovieStatus;
  q?: string;
  genre?: string;
  language?: string;
  format?: ScreenFormat;
  date?: string; // YYYY-MM-DD
}

const bookableFrom = (s: Settings) => new Date(Date.now() + s.bookingCutoffMinutes * 60_000);

/** FR-2.1, FR-2.3, FR-2.4 */
export async function listMovies(f: MovieFilters) {
  const settings = await getSettings();
  const where: Prisma.MovieWhereInput = { status: f.status ?? { in: ['NOW_SHOWING', 'COMING_SOON'] } };
  if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
  if (f.genre) where.genres = { has: f.genre };
  if (f.language) where.language = { equals: f.language, mode: 'insensitive' };
  if (f.format || f.date) {
    const showWhere: Prisma.ShowWhereInput = { status: 'SCHEDULED', startTime: { gt: bookableFrom(settings) } };
    if (f.format) showWhere.screen = { format: f.format };
    if (f.date) {
      const { start, end } = dayRange(f.date);
      showWhere.startTime = { gt: new Date(Math.max(start.getTime(), bookableFrom(settings).getTime())), lt: end };
    }
    where.shows = { some: showWhere };
  }
  const movies = await prisma.movie.findMany({
    where,
    orderBy: [{ status: 'desc' }, { releaseDate: 'desc' }],
    select: {
      id: true,
      title: true,
      slug: true,
      posterUrl: true,
      backdropUrl: true,
      genres: true,
      language: true,
      durationMin: true,
      ageRating: true,
      releaseDate: true,
      status: true,
    },
  });
  const ratings = await prisma.review.groupBy({
    by: ['movieId'],
    where: { movieId: { in: movies.map((m) => m.id) }, isHidden: false },
    _avg: { rating: true },
    _count: true,
  });
  const byMovie = new Map(ratings.map((r) => [r.movieId, { avg: r._avg.rating, count: r._count }]));
  return movies.map((m) => ({ ...m, rating: byMovie.get(m.id) ?? null }));
}

export async function catalogueMeta() {
  const movies = await prisma.movie.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { genres: true, language: true } });
  const cinemas = await prisma.cinema.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } });
  return {
    genres: [...new Set(movies.flatMap((m) => m.genres))].sort(),
    languages: [...new Set(movies.map((m) => m.language))].sort(),
    formats: ['TWO_D', 'THREE_D', 'IMAX'],
    cinemas,
  };
}

/** FR-2.2 */
export async function getMovie(slug: string) {
  const movie = await prisma.movie.findUnique({ where: { slug } });
  if (!movie || movie.status === 'ARCHIVED') throw notFound('Movie');
  const [agg, reviews] = await Promise.all([
    prisma.review.aggregate({ where: { movieId: movie.id, isHidden: false }, _avg: { rating: true }, _count: true }),
    prisma.review.findMany({
      where: { movieId: movie.id, isHidden: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);
  return {
    ...movie,
    rating: agg._count ? { avg: agg._avg.rating, count: agg._count } : null,
    reviews: reviews.map((r) => ({ ...r, user: { name: r.user.name.split(' ')[0] } })),
  };
}

/** Available seat counts per show; a lapsed hold counts as available. */
async function availabilityFor(showIds: string[]) {
  if (!showIds.length) return new Map<string, { available: number; total: number }>();
  const now = new Date();
  const [totals, available] = await Promise.all([
    prisma.showSeat.groupBy({ by: ['showId'], where: { showId: { in: showIds } }, _count: true }),
    prisma.showSeat.groupBy({
      by: ['showId'],
      where: { showId: { in: showIds }, OR: [{ status: 'AVAILABLE' }, { status: 'HELD', heldUntil: { lt: now } }] },
      _count: true,
    }),
  ]);
  const avail = new Map(available.map((a) => [a.showId, a._count]));
  return new Map(totals.map((t) => [t.showId, { total: t._count, available: avail.get(t.showId) ?? 0 }]));
}

/** FR-3.1, FR-3.2, FR-3.3: showtimes for a movie for a date, grouped by cinema. */
export async function movieShowtimes(movieId: string, date: string | undefined, cinemaId: string | undefined) {
  const settings = await getSettings();
  const from = bookableFrom(settings);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + settings.showtimeDaysAhead);

  const upcoming = await prisma.show.findMany({
    where: { movieId, status: 'SCHEDULED', startTime: { gt: from, lt: horizon } },
    select: { startTime: true },
  });
  const dates = [...new Set(upcoming.map((s) => localDateKey(s.startTime)))].sort();
  const day = date && dates.includes(date) ? date : dates[0];
  if (!day) return { dates, date: null, cinemas: [] };

  const { start, end } = dayRange(day);
  const shows = await prisma.show.findMany({
    where: {
      movieId,
      status: 'SCHEDULED',
      startTime: { gt: new Date(Math.max(from.getTime(), start.getTime())), lt: end },
      ...(cinemaId ? { screen: { cinemaId } } : {}),
    },
    orderBy: { startTime: 'asc' },
    include: { screen: { include: { cinema: true } } },
  });
  const avail = await availabilityFor(shows.map((s) => s.id));
  const grouped = new Map<string, { cinema: { id: string; name: string; city: string; address: string }; shows: unknown[] }>();
  for (const s of shows) {
    const c = s.screen.cinema;
    if (!grouped.has(c.id)) grouped.set(c.id, { cinema: { id: c.id, name: c.name, city: c.city, address: c.address }, shows: [] });
    const a = avail.get(s.id) ?? { available: 0, total: 0 };
    grouped.get(c.id)!.shows.push({
      id: s.id,
      startTime: s.startTime,
      language: s.language,
      screen: { id: s.screen.id, name: s.screen.name, format: s.screen.format },
      availability: availabilityLabel(a.available, a.total, settings.fillingFastThreshold),
      seatsLeft: a.available,
    });
  }
  return { dates, date: day, cinemas: [...grouped.values()] };
}

/** FR-4.1, FR-4.2: seat map for a show, with this viewer's own held seats flagged. */
export async function showSeatMap(showId: string, viewerId?: string) {
  const settings = await getSettings();
  const show = await prisma.show.findUnique({
    where: { id: showId },
    include: {
      movie: { select: { id: true, title: true, slug: true, posterUrl: true, ageRating: true, durationMin: true } },
      screen: { include: { cinema: { select: { id: true, name: true, city: true, address: true } } } },
      showSeats: { include: { seat: true, booking: { select: { userId: true } } } },
    },
  });
  if (!show || show.status !== 'SCHEDULED') throw notFound('Show');
  const now = new Date();
  const closed = now.getTime() >= show.startTime.getTime() - settings.bookingCutoffMinutes * 60_000;

  const categories = new Map<string, number>();
  const seats = show.showSeats.map((ss) => {
    const heldLive = ss.status === 'HELD' && ss.heldUntil && ss.heldUntil > now;
    const status = ss.status === 'BOOKED' ? 'BOOKED' : heldLive ? 'HELD' : 'AVAILABLE';
    const price = toCents(ss.price);
    const cat = ss.seat.category;
    categories.set(cat, Math.min(categories.get(cat) ?? Infinity, price));
    return {
      id: ss.seatId,
      label: `${ss.seat.rowLabel}${ss.seat.seatNumber}`,
      row: ss.seat.rowLabel,
      number: ss.seat.seatNumber,
      gridRow: ss.seat.gridRow,
      gridCol: ss.seat.gridCol,
      category: cat,
      priceCents: price,
      status,
      mine: Boolean(heldLive && viewerId && ss.booking?.userId === viewerId),
    };
  });

  return {
    show: {
      id: show.id,
      startTime: show.startTime,
      language: show.language,
      bookingOpen: !closed,
      movie: show.movie,
      screen: { id: show.screen.id, name: show.screen.name, format: show.screen.format, gridRows: show.screen.gridRows, gridCols: show.screen.gridCols },
      cinema: show.screen.cinema,
    },
    categories: [...categories.entries()].map(([category, priceCents]) => ({ category, priceCents })),
    seats,
    rules: {
      maxSeats: settings.maxSeatsPerBooking,
      holdMinutes: settings.holdMinutes,
      currency: settings.currency,
      convenienceFeePerTicket: settings.convenienceFeePerTicket,
      taxPercent: settings.taxPercent,
    },
  };
}
