import type { Booking, BookingSeat } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { bookingReference } from '../../lib/ids.js';
import { dec, toCents } from '../../lib/money.js';
import { seatLabel } from '../../lib/format.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { isVerified, type AuthUser } from '../../middleware/auth.js';
import { emitSeatChanges } from '../../realtime/socket.js';
import { getSettings, type Settings } from '../settings/settings.service.js';
import { computeTotals, promoDiscount, refundPercent } from '../pricing/pricing.js';
import { gatewayByName } from '../payments/index.js';
import { sendCancellationNotice } from '../tickets/ticket.notify.js';

export const bookingInclude = {
  seats: { orderBy: { label: 'asc' as const } },
  promoCode: { select: { code: true } },
  show: {
    include: {
      movie: { select: { id: true, title: true, slug: true, posterUrl: true, ageRating: true, durationMin: true } },
      screen: { select: { id: true, name: true, format: true, cinema: { select: { id: true, name: true, city: true, address: true } } } },
    },
  },
  payments: { orderBy: { createdAt: 'desc' as const }, select: { id: true, status: true, amount: true, method: true, paidAt: true, refundAmount: true, gateway: true } },
};

/** Throws unless the show exists, is scheduled, and is before its booking cut-off (FR-3.3). */
export async function assertShowBookable(showId: string, settings: Settings) {
  const show = await prisma.show.findUnique({ where: { id: showId } });
  if (!show || show.status !== 'SCHEDULED') throw notFound('Show');
  const closesAt = show.startTime.getTime() - settings.bookingCutoffMinutes * 60_000;
  if (Date.now() >= closesAt) throw badRequest('BOOKING_CLOSED', 'Booking for this show has closed');
  return show;
}

/**
 * Releases the seats of a pending booking and marks it EXPIRED or FAILED.
 * Only touches seats still HELD by this booking, so it never frees a seat someone else holds.
 */
export async function releasePending(bookingId: string, status: 'EXPIRED' | 'FAILED', tx: Tx = prisma) {
  const updated = await tx.booking.updateMany({ where: { id: bookingId, status: 'PENDING' }, data: { status } });
  const seats = await tx.showSeat.findMany({ where: { bookingId, status: 'HELD' }, select: { seatId: true, showId: true } });
  if (seats.length) {
    await tx.showSeat.updateMany({ where: { bookingId, status: 'HELD' }, data: { status: 'AVAILABLE', heldUntil: null, bookingId: null } });
  }
  return { changed: updated.count > 0, showId: seats[0]?.showId, seatIds: seats.map((s) => s.seatId) };
}

function emitReleased(r: { showId?: string; seatIds: string[] }) {
  if (r.showId) emitSeatChanges(r.showId, r.seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));
}

/**
 * FR-4.4 / FR-4.5 / NFR-4: hold seats for the customer.
 * The conditional UPDATE only matches seats that are free (or whose hold has lapsed); Postgres row locks
 * serialise concurrent requests, so if fewer rows than requested were updated another customer won the race
 * and the whole transaction is rolled back.
 */
export async function createHold(user: AuthUser, showId: string, rawSeatIds: string[]) {
  if (!isVerified(user)) {
    throw new AppError(403, 'VERIFICATION_REQUIRED', 'Please verify your email or mobile number before booking');
  }
  const settings = await getSettings();
  const seatIds = [...new Set(rawSeatIds)];
  if (seatIds.length === 0) throw badRequest('NO_SEATS', 'Select at least one seat');
  if (seatIds.length > settings.maxSeatsPerBooking) {
    throw badRequest('TOO_MANY_SEATS', `You can book up to ${settings.maxSeatsPerBooking} seats at a time`);
  }
  await assertShowBookable(showId, settings);

  // A customer re-picking seats for the same show replaces their earlier hold.
  const previous = await prisma.booking.findMany({ where: { userId: user.id, showId, status: 'PENDING' }, select: { id: true } });
  for (const p of previous) emitReleased(await releasePending(p.id, 'EXPIRED'));

  const now = new Date();
  const holdUntil = new Date(now.getTime() + settings.holdMinutes * 60_000);

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        reference: bookingReference(),
        userId: user.id,
        showId,
        subtotal: dec(0),
        total: dec(0),
        holdExpiresAt: holdUntil,
      },
    });

    const { count } = await tx.showSeat.updateMany({
      where: {
        showId,
        seatId: { in: seatIds },
        OR: [{ status: 'AVAILABLE' }, { status: 'HELD', heldUntil: { lt: now } }],
      },
      data: { status: 'HELD', heldUntil: holdUntil, bookingId: created.id },
    });

    if (count !== seatIds.length) {
      const taken = await tx.showSeat.findMany({
        where: { showId, seatId: { in: seatIds }, NOT: { bookingId: created.id } },
        select: { seatId: true },
      });
      throw conflict('SEATS_UNAVAILABLE', 'Sorry, some of the seats you picked were just taken. Please choose again.', {
        seatIds: taken.map((t) => t.seatId),
      });
    }

    const showSeats = await tx.showSeat.findMany({ where: { bookingId: created.id }, include: { seat: true } });
    await tx.bookingSeat.createMany({
      data: showSeats.map((ss) => ({
        bookingId: created.id,
        seatId: ss.seatId,
        label: seatLabel(ss.seat),
        category: ss.seat.category,
        price: ss.price,
      })),
    });
    const totals = computeTotals(showSeats.map((s) => toCents(s.price)), settings);
    return tx.booking.update({
      where: { id: created.id },
      data: {
        subtotal: dec(totals.subtotal),
        convenienceFee: dec(totals.convenienceFee),
        tax: dec(totals.tax),
        discount: dec(0),
        total: dec(totals.total),
      },
      include: bookingInclude,
    });
  });

  emitSeatChanges(showId, seatIds.map((seatId) => ({ seatId, status: 'HELD' as const })));
  await audit({ userId: user.id, action: 'booking.hold', entity: 'Booking', entityId: booking.id, meta: { seatIds } });
  return booking;
}

export async function getOwnBooking(user: AuthUser, bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking) throw notFound('Booking');
  if (booking.userId !== user.id) throw forbidden();
  return booking;
}

export async function listOwnBookings(user: AuthUser) {
  return prisma.booking.findMany({
    where: { userId: user.id, status: { in: ['CONFIRMED', 'CANCELLED', 'REFUNDED'] } },
    include: bookingInclude,
    orderBy: { show: { startTime: 'desc' } },
  });
}

async function assertPendingAndLive(user: AuthUser, bookingId: string) {
  const booking = await getOwnBooking(user, bookingId);
  if (booking.status !== 'PENDING') throw badRequest('NOT_PENDING', 'This booking can no longer be changed');
  if (booking.holdExpiresAt < new Date()) {
    emitReleased(await releasePending(booking.id, 'EXPIRED'));
    throw new AppError(410, 'HOLD_EXPIRED', 'Your seat hold has expired. Please select seats again.');
  }
  return booking;
}

/** FR-5.4: one promo code per booking; pass null to remove it. */
export async function applyPromo(user: AuthUser, bookingId: string, code: string | null) {
  const booking = await assertPendingAndLive(user, bookingId);
  const settings = await getSettings();
  const seatCents = booking.seats.map((s: BookingSeat) => toCents(s.price));

  let promoCodeId: string | null = null;
  let discount = 0;
  if (code) {
    const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
    const now = new Date();
    if (!promo || !promo.isActive || promo.validFrom > now || promo.validTo < now) {
      throw badRequest('PROMO_INVALID', 'This promo code is not valid');
    }
    if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
      throw badRequest('PROMO_EXHAUSTED', 'This promo code has reached its usage limit');
    }
    const subtotal = seatCents.reduce((a: number, b: number) => a + b, 0);
    discount = promoDiscount(
      {
        type: promo.type,
        valueCents: toCents(promo.value),
        maxDiscountCents: promo.maxDiscount != null ? toCents(promo.maxDiscount) : null,
        minAmountCents: promo.minAmount != null ? toCents(promo.minAmount) : null,
      },
      subtotal,
    );
    if (discount === 0) throw badRequest('PROMO_NOT_APPLICABLE', 'This promo code does not apply to this booking');
    promoCodeId = promo.id;
  }

  const totals = computeTotals(seatCents, settings, discount);
  return prisma.booking.update({
    where: { id: booking.id },
    data: { promoCodeId, discount: dec(totals.discount), tax: dec(totals.tax), total: dec(totals.total) },
    include: bookingInclude,
  });
}

/** Customer abandons checkout: free the seats right away. */
export async function abandonHold(user: AuthUser, bookingId: string) {
  const booking = await getOwnBooking(user, bookingId);
  if (booking.status !== 'PENDING') return;
  emitReleased(await releasePending(booking.id, 'EXPIRED'));
  await audit({ userId: user.id, action: 'booking.abandon', entity: 'Booking', entityId: booking.id });
}

/** Sweeper (FR-4.6): expire lapsed holds. Safe to run on several instances. */
export async function expireLapsedHolds() {
  const lapsed = await prisma.booking.findMany({
    where: { status: 'PENDING', holdExpiresAt: { lt: new Date() } },
    select: { id: true },
    take: 500,
  });
  for (const b of lapsed) {
    const r = await prisma.$transaction((tx) => releasePending(b.id, 'EXPIRED', tx));
    emitReleased(r);
  }
  return lapsed.length;
}

export function cancellationQuote(booking: Booking & { show: { startTime: Date } }, settings: Settings, now = new Date()) {
  const minutesBefore = (booking.show.startTime.getTime() - now.getTime()) / 60_000;
  const allowed = booking.status === 'CONFIRMED' && !booking.checkedInAt && minutesBefore >= settings.cancelCutoffMinutes;
  const percent = allowed ? refundPercent(settings.refundPolicy, minutesBefore / 60) : 0;
  const refundCents = Math.floor((toCents(booking.total) * percent) / 100);
  return { allowed, percent, refundCents, cutoffMinutes: settings.cancelCutoffMinutes };
}

/** FR-7.1–7.3: cancel a confirmed booking, free seats immediately, then refund via the gateway. */
export async function cancelBooking(user: AuthUser, bookingId: string, opts: { byStaff?: boolean } = {}) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking) throw notFound('Booking');
  if (!opts.byStaff && booking.userId !== user.id) throw forbidden();
  const settings = await getSettings();
  const quote = cancellationQuote(booking, settings);
  if (!opts.byStaff && !quote.allowed) {
    throw badRequest(
      'CANCEL_NOT_ALLOWED',
      booking.status !== 'CONFIRMED'
        ? 'Only confirmed bookings can be cancelled'
        : `Bookings can be cancelled up to ${Math.round(settings.cancelCutoffMinutes / 60)} hours before the show`,
    );
  }
  // Staff cancellations (e.g. show cancelled by the cinema) refund in full.
  const refundCents = opts.byStaff ? toCents(booking.total) : quote.refundCents;

  const seatIds = await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id: booking.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), refundAmount: dec(refundCents) },
    });
    if (count === 0) throw badRequest('CANCEL_NOT_ALLOWED', 'This booking is already cancelled');
    const seats = await tx.showSeat.findMany({ where: { bookingId: booking.id }, select: { seatId: true } });
    await tx.showSeat.updateMany({ where: { bookingId: booking.id }, data: { status: 'AVAILABLE', heldUntil: null, bookingId: null } });
    await audit({ userId: user.id, action: opts.byStaff ? 'booking.cancel.staff' : 'booking.cancel', entity: 'Booking', entityId: booking.id, meta: { refundCents } }, tx);
    return seats.map((s) => s.seatId);
  });
  emitSeatChanges(booking.showId, seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));

  if (refundCents > 0) await processRefund(booking.id).catch((err) => logger.error({ err, bookingId }, 'refund failed; will retry'));
  sendCancellationNotice(booking.id).catch((err) => logger.warn({ err }, 'cancellation notice failed'));
  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
}

/** Sends the refund for a cancelled booking. Idempotent; also retried by the reconciliation job. */
export async function processRefund(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const payment = await prisma.payment.findFirst({ where: { bookingId, status: 'SUCCESS' }, orderBy: { paidAt: 'desc' } });
  if (!payment || !booking.refundAmount || toCents(booking.refundAmount) <= 0) return;
  const gw = gatewayByName(payment.gateway);
  const amountCents = toCents(booking.refundAmount);
  const { refundRef } = await gw.refund({ paymentId: payment.id, gatewayRef: payment.gatewayRef, amountCents, reason: 'Customer cancellation' });
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundAmount: dec(amountCents), refundRef } }),
    prisma.booking.update({ where: { id: bookingId }, data: { status: 'REFUNDED' } }),
  ]);
  await audit({ action: 'payment.refund', entity: 'Payment', entityId: payment.id, meta: { amountCents, refundRef } });
}
