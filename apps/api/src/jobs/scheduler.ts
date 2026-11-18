import { logger } from '../lib/logger.js';
import { expireLapsedHolds } from '../modules/bookings/booking.service.js';
import { reconcilePayments } from '../modules/payments/payment.service.js';
import { notifyWatchlists, sendShowReminders } from './notifications.js';

function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, ms);
  t.unref();
  void tick();
  return t;
}

/** Background jobs. All are idempotent, so running them on several instances is safe. */
export function startJobs() {
  const timers = [
    every('expire-holds', 30_000, async () => {
      const n = await expireLapsedHolds();
      if (n) logger.info({ n }, 'expired lapsed seat holds');
    }), // FR-4.6
    every('reconcile-payments', 5 * 60_000, () => reconcilePayments()), // NFR-6, FR-5.6
    every('show-reminders', 5 * 60_000, () => sendShowReminders()), // FR-6.4
    every('watchlist-notify', 10 * 60_000, () => notifyWatchlists()), // FR-2.5
  ];
  return () => timers.forEach(clearInterval);
}
