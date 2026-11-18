import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { h } from '../../lib/http.js';
import { toCents } from '../../lib/money.js';
import { badRequest } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as bookings from './booking.service.js';
import { presentBooking } from './booking.present.js';
import { initiatePayment } from '../payments/payment.service.js';
import { loadTicketData } from '../tickets/ticket.notify.js';
import { qrPayload, renderTicketPdf } from '../tickets/ticket.pdf.js';

export const bookingRouter = Router();
bookingRouter.use(requireAuth);

bookingRouter.get(
  '/',
  h(async (req, res) => {
    const list = await bookings.listOwnBookings(req.user!);
    res.json({ bookings: await Promise.all(list.map(presentBooking)) });
  }),
);

bookingRouter.get(
  '/:id',
  h(async (req, res) => {
    res.json({ booking: await presentBooking(await bookings.getOwnBooking(req.user!, req.params.id)) });
  }),
);

bookingRouter.post(
  '/:id/promo',
  validate(z.object({ code: z.string().trim().max(40).nullable() })),
  h(async (req, res) => {
    const b = await bookings.applyPromo(req.user!, req.params.id, req.body.code || null);
    res.json({ booking: await presentBooking(b) });
  }),
);

/** FR-5.5: food & drinks on sale at this booking's cinema. */
bookingRouter.get(
  '/:id/concessions',
  h(async (req, res) => {
    const b = await bookings.getOwnBooking(req.user!, req.params.id);
    const list = await bookings.concessionsForCinema(b.show.screen.cinema.id);
    res.json({
      concessions: list.map((c) => ({ id: c.id, name: c.name, description: c.description, imageUrl: c.imageUrl, priceCents: toCents(c.price) })),
      maxQuantity: bookings.MAX_ITEM_QUANTITY,
    });
  }),
);

bookingRouter.put(
  '/:id/items',
  validate(z.object({ items: z.array(z.object({ concessionId: z.string().min(1).max(40), quantity: z.number().int().min(0).max(99) })).max(30) })),
  h(async (req, res) => {
    const b = await bookings.setBookingItems(req.user!, req.params.id, req.body.items);
    res.json({ booking: await presentBooking(b) });
  }),
);

bookingRouter.post(
  '/:id/pay',
  h(async (req, res) => {
    res.json(await initiatePayment(req.user!, req.params.id));
  }),
);

bookingRouter.delete(
  '/:id/hold',
  h(async (req, res) => {
    await bookings.abandonHold(req.user!, req.params.id);
    res.status(204).end();
  }),
);

bookingRouter.post(
  '/:id/cancel',
  h(async (req, res) => {
    const b = await bookings.cancelBooking(req.user!, req.params.id);
    res.json({ booking: await presentBooking(b) });
  }),
);

/** QR image for display on screen (My Bookings). */
bookingRouter.get(
  '/:id/qr.svg',
  h(async (req, res) => {
    const b = await bookings.getOwnBooking(req.user!, req.params.id);
    if (b.status !== 'CONFIRMED' || !b.qrToken) throw badRequest('NO_TICKET', 'This booking has no valid ticket');
    res.type('image/svg+xml').set('Cache-Control', 'private, no-store').send(await QRCode.toString(qrPayload(b.qrToken), { type: 'svg', margin: 1 }));
  }),
);

/** FR-6.3: download the e-ticket as PDF. */
bookingRouter.get(
  '/:id/ticket.pdf',
  h(async (req, res) => {
    const b = await bookings.getOwnBooking(req.user!, req.params.id);
    if (!['CONFIRMED', 'CANCELLED', 'REFUNDED'].includes(b.status)) throw badRequest('NO_TICKET', 'This booking has no ticket');
    const pdf = await renderTicketPdf(await loadTicketData(b.id));
    res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="ShowPass-${b.reference}.pdf"`)
      .set('Cache-Control', 'private, no-store')
      .send(pdf);
  }),
);
