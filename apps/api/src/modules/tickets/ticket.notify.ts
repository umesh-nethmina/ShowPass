import { prisma } from '../../lib/prisma.js';
import { toCents } from '../../lib/money.js';
import { formatMoney, formatShowTime } from '../../lib/format.js';
import { audit } from '../../lib/audit.js';
import { sendEmail } from '../notifications/email.js';
import { sendSms } from '../notifications/sms.js';
import { cancellationEmail, ticketEmail } from '../notifications/templates.js';
import { getSettings } from '../settings/settings.service.js';
import { renderTicketPdf, type TicketData } from './ticket.pdf.js';

const FORMAT_LABEL = { TWO_D: '2D', THREE_D: '3D', IMAX: 'IMAX' } as const;

export async function loadTicketData(bookingId: string): Promise<TicketData & { email: string; phone: string }> {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { user: true, seats: { orderBy: { label: 'asc' } }, show: { include: { movie: true, screen: { include: { cinema: true } } } } },
  });
  const settings = await getSettings();
  return {
    reference: b.reference,
    qrToken: b.qrToken ?? b.reference,
    customerName: b.user.name,
    email: b.user.email,
    phone: b.user.phone,
    movieTitle: b.show.movie.title,
    ageRating: b.show.movie.ageRating,
    cinemaName: b.show.screen.cinema.name,
    cinemaAddress: b.show.screen.cinema.address,
    screenName: b.show.screen.name,
    format: `${FORMAT_LABEL[b.show.screen.format]} · ${b.show.language}`,
    startTime: b.show.startTime,
    seats: b.seats.map((s) => s.label),
    totalCents: toCents(b.total),
    currency: settings.currency,
    status: b.status,
  };
}

/** FR-6.2: e-ticket by email (PDF attached) and confirmation SMS, sent right after payment. */
export async function sendTicketNotifications(bookingId: string) {
  const t = await loadTicketData(bookingId);
  const pdf = await renderTicketPdf(t);
  const startsAt = formatShowTime(t.startTime);
  const total = formatMoney(t.totalCents, t.currency);
  await Promise.allSettled([
    sendEmail({
      to: t.email,
      ...ticketEmail({ name: t.customerName, reference: t.reference, movie: t.movieTitle, cinema: t.cinemaName, screen: t.screenName, startsAt, seats: t.seats.join(', '), total }),
      attachments: [{ filename: `ShowPass-${t.reference}.pdf`, content: pdf, contentType: 'application/pdf' }],
    }),
    sendSms(t.phone, `ShowPass: booking ${t.reference} confirmed. ${t.movieTitle}, ${startsAt}, ${t.cinemaName}. Seats ${t.seats.join(',')}. Show the QR in your email at entry.`),
  ]);
  await audit({ action: 'ticket.sent', entity: 'Booking', entityId: bookingId });
}

export async function sendCancellationNotice(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { user: true, show: { include: { movie: true } } } });
  const settings = await getSettings();
  const refund = formatMoney(b.refundAmount ? toCents(b.refundAmount) : 0, settings.currency);
  await Promise.allSettled([
    sendEmail({ to: b.user.email, ...cancellationEmail(b.user.name, b.reference, b.show.movie.title, refund) }),
    sendSms(b.user.phone, `ShowPass: booking ${b.reference} cancelled. Refund ${refund}.`),
  ]);
}
