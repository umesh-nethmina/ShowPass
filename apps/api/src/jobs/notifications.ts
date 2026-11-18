import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { formatShowTime } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import { sendEmail } from '../modules/notifications/email.js';
import { sendSms } from '../modules/notifications/sms.js';
import { bookingOpenEmail, reminderEmail } from '../modules/notifications/templates.js';

const REMINDER_LEAD_MIN = 120;
/** Reminders go out when the show is 105–125 minutes away; the job runs every 5 minutes. */
const WINDOW_EARLY_MIN = 15;
const WINDOW_LATE_MIN = 5;

/**
 * FR-6.4: remind customers about 2 hours before their show. Each booking is claimed with a
 * conditional update first, so a reminder is sent at most once even with several API instances.
 */
export async function sendShowReminders(now = new Date()) {
  const from = new Date(now.getTime() + (REMINDER_LEAD_MIN - WINDOW_EARLY_MIN) * 60_000);
  const to = new Date(now.getTime() + (REMINDER_LEAD_MIN + WINDOW_LATE_MIN) * 60_000);
  const due = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', reminderSentAt: null, show: { status: 'SCHEDULED', startTime: { gt: from, lte: to } } },
    include: { user: true, seats: { orderBy: { label: 'asc' } }, show: { include: { movie: true, screen: { include: { cinema: true } } } } },
    take: 500,
  });
  let sent = 0;
  for (const b of due) {
    const { count } = await prisma.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!count) continue;
    const startsAt = formatShowTime(b.show.startTime);
    const seats = b.seats.map((s) => s.label).join(', ');
    const c = b.show.screen.cinema;
    const results = await Promise.allSettled([
      sendEmail({ to: b.user.email, ...reminderEmail({ name: b.user.name, reference: b.reference, movie: b.show.movie.title, cinema: c.name, screen: b.show.screen.name, startsAt, seats, address: c.address }) }),
      b.user.phone ? sendSms(b.user.phone, `ShowPass reminder: ${b.show.movie.title} at ${startsAt}, ${c.name}. Seats ${seats}.`) : Promise.resolve(),
    ]);
    results.filter((r) => r.status === 'rejected').forEach((r) => logger.warn({ err: (r as PromiseRejectedResult).reason, bookingId: b.id }, 'reminder delivery failed'));
    sent++;
  }
  return sent;
}

/** FR-2.5: tell watchlisted customers once a movie has bookable shows. */
export async function notifyWatchlists(now = new Date()) {
  const items = await prisma.watchlistItem.findMany({
    where: { notifiedAt: null, movie: { status: { not: 'ARCHIVED' }, shows: { some: { status: 'SCHEDULED', startTime: { gt: now } } } } },
    include: { user: true, movie: true },
    take: 500,
  });
  let sent = 0;
  for (const w of items) {
    const { count } = await prisma.watchlistItem.updateMany({ where: { userId: w.userId, movieId: w.movieId, notifiedAt: null }, data: { notifiedAt: now } });
    if (!count) continue;
    try {
      await sendEmail({ to: w.user.email, ...bookingOpenEmail({ name: w.user.name, movie: w.movie.title, url: `${env.WEB_ORIGIN}/movies/${w.movie.slug}` }) });
      sent++;
    } catch (err) {
      logger.warn({ err, movieId: w.movieId }, 'watchlist notification failed');
    }
  }
  return sent;
}
