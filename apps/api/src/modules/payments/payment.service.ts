import { prisma } from '../../lib/prisma.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { dec, toCents } from '../../lib/money.js';
import { randomToken } from '../../lib/ids.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import type { AuthUser } from '../../middleware/auth.js';
import { emitSeatChanges } from '../../realtime/socket.js';
import { getSettings } from '../settings/settings.service.js';
import { getOwnBooking, processRefund, releasePending } from '../bookings/booking.service.js';
import { sendTicketNotifications } from '../tickets/ticket.notify.js';
import type { GatewayEvent } from './gateway.js';
import { activeGateway, gatewayByName } from './index.js';

class SeatsLostError extends Error {
  constructor(public why: 'SEATS_TAKEN' | 'ALREADY_FINAL') {
    super(why);
  }
}

/** FR-5.2: start a payment for a pending booking and tell the browser how to reach the gateway. */
export async function initiatePayment(user: AuthUser, bookingId: string) {
  const booking = await getOwnBooking(user, bookingId);
  if (booking.status !== 'PENDING') throw badRequest('NOT_PENDING', 'This booking can no longer be paid');
  if (booking.holdExpiresAt < new Date()) {
    const r = await releasePending(booking.id, 'EXPIRED');
    if (r.showId) emitSeatChanges(r.showId, r.seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));
    throw new AppError(410, 'HOLD_EXPIRED', 'Your seat hold has expired. Please select seats again.');
  }
  const settings = await getSettings();
  const gateway = activeGateway();
  const amountCents = toCents(booking.total);

  // Only the latest attempt is live; earlier unfinished attempts are recorded as abandoned (FR-5.6).
  await prisma.payment.updateMany({
    where: { bookingId: booking.id, status: 'INITIATED' },
    data: { status: 'FAILED', failReason: 'Superseded by a new payment attempt' },
  });

  const payment = await prisma.payment.create({
    data: { bookingId: booking.id, gateway: gateway.name, amount: dec(amountCents), currency: settings.currency },
  });
  await audit({ userId: user.id, action: 'payment.initiate', entity: 'Payment', entityId: payment.id, meta: { bookingId: booking.id, amountCents } });

  if (amountCents === 0) {
    // Fully discounted booking: nothing to charge.
    await handleGatewayEvent({ paymentId: payment.id, outcome: 'SUCCESS', amountCents: 0, gatewayRef: `FREE-${payment.id}`, method: 'PROMO' });
    return { paymentId: payment.id, checkout: { type: 'redirect' as const, url: `/payment/result?payment=${payment.id}` } };
  }

  const checkout = await gateway.createCheckout({
    paymentId: payment.id,
    bookingReference: booking.reference,
    amountCents,
    currency: settings.currency,
    description: `${booking.show.movie.title} – ${booking.seats.length} ticket(s)`,
    customer: { name: user.name, email: user.email, phone: user.phone },
  });
  return { paymentId: payment.id, checkout };
}

/**
 * FR-5.3: the single place where gateway results change bookings. Idempotent.
 * Success → seats BOOKED + booking CONFIRMED. If the seats were lost (hold lapsed and resold), or the booking
 * was already finalised, the money is refunded automatically (NFR-6).
 */
export async function handleGatewayEvent(ev: GatewayEvent) {
  const payment = await prisma.payment.findUnique({ where: { id: ev.paymentId }, include: { booking: { include: { seats: true } } } });
  if (!payment) throw notFound('Payment');
  if (ev.outcome === 'PENDING') return { status: payment.status };

  if (ev.outcome === 'FAILED') {
    if (payment.status !== 'INITIATED') return { status: payment.status };
    const released = await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failReason: ev.reason ?? 'Payment failed', gatewayRef: ev.gatewayRef ?? null } });
      await audit({ action: 'payment.failed', entity: 'Payment', entityId: payment.id, meta: { reason: ev.reason ?? null } }, tx);
      return releasePending(payment.bookingId, 'FAILED', tx);
    });
    if (released.showId) emitSeatChanges(released.showId, released.seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));
    return { status: 'FAILED' as const };
  }

  // SUCCESS
  if (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') return { status: payment.status };
  const amountOk = ev.amountCents == null || ev.amountCents === toCents(payment.amount);
  const booking = payment.booking;
  const seatIds = booking.seats.map((s) => s.seatId);
  const paidAt = new Date();

  try {
    if (!amountOk) throw new SeatsLostError('ALREADY_FINAL');
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (!['PENDING', 'EXPIRED', 'FAILED'].includes(fresh.status)) throw new SeatsLostError('ALREADY_FINAL');
      const now = new Date();
      const { count } = await tx.showSeat.updateMany({
        where: {
          showId: booking.showId,
          seatId: { in: seatIds },
          OR: [{ bookingId: booking.id, status: 'HELD' }, { status: 'AVAILABLE' }, { status: 'HELD', heldUntil: { lt: now } }],
        },
        data: { status: 'BOOKED', heldUntil: null, bookingId: booking.id },
      });
      if (count !== seatIds.length) throw new SeatsLostError('SEATS_TAKEN'); // rolls back the partial update
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', confirmedAt: now, qrToken: randomToken(18) },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS', gatewayRef: ev.gatewayRef ?? null, method: ev.method ?? null, paidAt },
      });
      if (booking.promoCodeId) await tx.promoCode.update({ where: { id: booking.promoCodeId }, data: { usedCount: { increment: 1 } } });
      await audit({ userId: booking.userId, action: 'booking.confirm', entity: 'Booking', entityId: booking.id, meta: { paymentId: payment.id } }, tx);
    });
  } catch (err) {
    if (!(err instanceof SeatsLostError)) throw err;
    return refundOrphanPayment(payment.id, ev, paidAt, amountOk ? err.why : 'AMOUNT_MISMATCH');
  }

  emitSeatChanges(booking.showId, seatIds.map((seatId) => ({ seatId, status: 'BOOKED' as const })));
  sendTicketNotifications(booking.id).catch((err) => logger.error({ err, bookingId: booking.id }, 'ticket notification failed'));
  return { status: 'SUCCESS' as const };
}

/** Money was taken but no seats can be issued: record the payment and refund it in full. */
async function refundOrphanPayment(paymentId: string, ev: GatewayEvent, paidAt: Date, reason: string) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'SUCCESS', gatewayRef: ev.gatewayRef ?? null, method: ev.method ?? null, paidAt, failReason: reason },
  });
  const r = await prisma.$transaction((tx) => releasePending(payment.bookingId, 'FAILED', tx));
  if (r.showId) emitSeatChanges(r.showId, r.seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));
  const amountCents = ev.amountCents ?? toCents(payment.amount);
  logger.warn({ paymentId, reason }, 'payment succeeded but booking could not be confirmed; refunding');
  try {
    const { refundRef } = await gatewayByName(payment.gateway).refund({ paymentId, gatewayRef: payment.gatewayRef, amountCents, reason });
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED', refundAmount: dec(amountCents), refundRef } });
    await audit({ action: 'payment.auto_refund', entity: 'Payment', entityId: paymentId, meta: { reason, amountCents, refundRef } });
  } catch (err) {
    logger.error({ err, paymentId }, 'automatic refund failed; reconciliation will retry');
  }
  return { status: 'REFUNDED' as const, reason };
}

/**
 * NFR-6 / FR-5.6: payments stuck in INITIATED are looked up at the gateway. Those that cannot be looked up
 * and are older than the abandon window are recorded as abandoned and their seats released.
 * Also retries refunds for cancelled bookings and orphan payments.
 */
export async function reconcilePayments(now = new Date()) {
  const stale = await prisma.payment.findMany({
    where: { status: 'INITIATED', createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    take: 200,
  });
  for (const p of stale) {
    try {
      const ev = await gatewayByName(p.gateway).lookup(p.id);
      if (ev && ev.outcome !== 'PENDING') {
        await handleGatewayEvent(ev);
      } else if (p.createdAt < new Date(now.getTime() - 15 * 60_000)) {
        await handleGatewayEvent({ paymentId: p.id, outcome: 'FAILED', reason: 'Abandoned – no result from gateway' });
      }
    } catch (err) {
      logger.error({ err, paymentId: p.id }, 'reconciliation failed for payment');
    }
  }

  const owed = await prisma.booking.findMany({
    where: { status: 'CANCELLED', refundAmount: { gt: 0 }, payments: { some: { status: 'SUCCESS' } } },
    select: { id: true },
    take: 100,
  });
  for (const b of owed) await processRefund(b.id).catch((err) => logger.error({ err, bookingId: b.id }, 'refund retry failed'));

  const orphans = await prisma.payment.findMany({
    where: { status: 'SUCCESS', failReason: { not: null }, booking: { status: { not: 'CONFIRMED' } } },
    take: 100,
  });
  for (const p of orphans) {
    await refundOrphanPayment(p.id, { paymentId: p.id, outcome: 'SUCCESS', gatewayRef: p.gatewayRef ?? undefined }, p.paidAt ?? now, p.failReason!).catch(() => {});
  }
}
