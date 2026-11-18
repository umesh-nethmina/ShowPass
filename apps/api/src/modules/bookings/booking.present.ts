import type { Prisma } from '@prisma/client';
import { toCents } from '../../lib/money.js';
import { getSettings } from '../settings/settings.service.js';
import { bookingInclude, cancellationQuote } from './booking.service.js';

type FullBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** API shape for a booking. Money is returned as integer cents. QR token only for confirmed bookings. */
export async function presentBooking(b: FullBooking) {
  const settings = await getSettings();
  const quote = cancellationQuote(b, settings);
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    currency: settings.currency,
    subtotalCents: toCents(b.subtotal),
    convenienceFeeCents: toCents(b.convenienceFee),
    taxCents: toCents(b.tax),
    discountCents: toCents(b.discount),
    totalCents: toCents(b.total),
    refundCents: b.refundAmount != null ? toCents(b.refundAmount) : null,
    promoCode: b.promoCode?.code ?? null,
    holdExpiresAt: b.holdExpiresAt,
    confirmedAt: b.confirmedAt,
    cancelledAt: b.cancelledAt,
    checkedInAt: b.checkedInAt,
    createdAt: b.createdAt,
    qrToken: b.status === 'CONFIRMED' ? b.qrToken : null,
    seats: b.seats.map((s) => ({ seatId: s.seatId, label: s.label, category: s.category, priceCents: toCents(s.price) })),
    show: {
      id: b.show.id,
      startTime: b.show.startTime,
      language: b.show.language,
      movie: b.show.movie,
      screen: { id: b.show.screen.id, name: b.show.screen.name, format: b.show.screen.format },
      cinema: b.show.screen.cinema,
    },
    payments: b.payments.map((p) => ({ ...p, amount: undefined, amountCents: toCents(p.amount), refundAmount: undefined })),
    cancellation: { allowed: quote.allowed, refundCents: quote.refundCents, refundPercent: quote.percent, cutoffMinutes: quote.cutoffMinutes },
  };
}
