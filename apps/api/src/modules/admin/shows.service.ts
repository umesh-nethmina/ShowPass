import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { dec, toCents } from '../../lib/money.js';
import { resolvePrice, type RuleLike } from '../pricing/pricing.js';
import type { AuthUser } from '../../middleware/auth.js';
import { assertCinemaAccess } from './scope.js';

/** Minutes between shows on the same screen for cleaning and ads. */
export const TURNAROUND_MIN = 15;

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/**
 * FR-9.3: schedule one or more showtimes for a movie on a screen.
 * Each show blocks the screen for the movie runtime + turnaround. A Postgres advisory lock per screen
 * serialises concurrent scheduling so two admins cannot create overlapping shows at the same moment.
 * Seat prices are frozen into ShowSeat rows from the cinema's price rules (FR-9.4).
 */
export async function scheduleShows(user: AuthUser, input: { movieId: string; screenId: string; language: string; startTimes: Date[] }) {
  const [movie, screen] = await Promise.all([
    prisma.movie.findUnique({ where: { id: input.movieId } }),
    prisma.screen.findUnique({ where: { id: input.screenId }, include: { seats: { where: { isActive: true } } } }),
  ]);
  if (!movie || movie.status === 'ARCHIVED') throw notFound('Movie');
  if (!screen || !screen.isActive) throw notFound('Screen');
  assertCinemaAccess(user, screen.cinemaId);
  if (!screen.seats.length) throw badRequest('NO_SEATS', 'This screen has no seats. Set up its layout first.');

  const rules: RuleLike[] = (await prisma.priceRule.findMany({ where: { cinemaId: screen.cinemaId } })).map((r) => ({
    ...r,
    priceCents: toCents(r.price),
  }));

  const blockMs = (movie.durationMin + TURNAROUND_MIN) * 60_000;
  const slots = input.startTimes
    .map((start) => ({ start, end: new Date(start.getTime() + blockMs) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const s of slots) if (s.start < new Date()) throw badRequest('IN_PAST', 'Shows cannot be scheduled in the past');
  for (let i = 1; i < slots.length; i++) {
    if (overlaps(slots[i - 1].start, slots[i - 1].end, slots[i].start, slots[i].end)) {
      throw conflict('SHOW_OVERLAP', 'Two of the new showtimes overlap each other');
    }
  }

  // Resolve prices for every slot before writing anything.
  const priced = slots.map((slot) => {
    const prices = new Map<string, number>();
    for (const cat of new Set(screen.seats.map((s) => s.category))) {
      const p = resolvePrice(rules, cat, slot.start);
      if (p == null) throw badRequest('NO_PRICE', `No ticket price is set for ${cat} seats at this cinema for ${slot.start.toLocaleString()}`);
      prices.set(cat, p);
    }
    return { ...slot, prices };
  });

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${screen.id}))`;
    const clash = await tx.show.findFirst({
      where: {
        screenId: screen.id,
        status: 'SCHEDULED',
        OR: slots.map((s) => ({ startTime: { lt: s.end }, endTime: { gt: s.start } })),
      },
      include: { movie: { select: { title: true } } },
    });
    if (clash) {
      throw conflict('SHOW_OVERLAP', `Overlaps with "${clash.movie.title}" at ${clash.startTime.toLocaleString()} on this screen`);
    }
    const created = [];
    for (const slot of priced) {
      const show = await tx.show.create({
        data: { movieId: movie.id, screenId: screen.id, startTime: slot.start, endTime: slot.end, language: input.language },
      });
      await tx.showSeat.createMany({
        data: screen.seats.map((seat) => ({ showId: show.id, seatId: seat.id, price: dec(slot.prices.get(seat.category)!) })),
      });
      created.push(show);
    }
    return created;
  });
}
