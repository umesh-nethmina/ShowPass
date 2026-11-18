import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { validate } from '../../middleware/validate.js';
import { requireRole, type AuthUser } from '../../middleware/auth.js';
import { dayRange, localDateKey } from '../../lib/format.js';

export const checkerRouter = Router();
checkerRouter.use(requireRole('TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN'));

const cinemaScope = (u: AuthUser) => (u.role === 'SUPER_ADMIN' ? {} : { screen: { cinemaId: u.cinemaId ?? '__none__' } });

/** Today's shows at the checker's cinema, to pick which show is being admitted. */
checkerRouter.get(
  '/shows',
  h(async (req, res) => {
    const { start, end } = dayRange(localDateKey(new Date()));
    const shows = await prisma.show.findMany({
      where: { status: 'SCHEDULED', startTime: { gte: start, lt: end }, ...cinemaScope(req.user!) },
      orderBy: { startTime: 'asc' },
      include: { movie: { select: { title: true } }, screen: { select: { name: true, cinema: { select: { name: true } } } } },
    });
    res.json({
      shows: shows.map((s) => ({ id: s.id, startTime: s.startTime, movie: s.movie.title, screen: s.screen.name, cinema: s.screen.cinema.name })),
    });
  }),
);

export type ScanResult = 'VALID' | 'ALREADY_USED' | 'CANCELLED' | 'WRONG_SHOW' | 'NOT_FOUND' | 'NOT_PAID' | 'WRONG_CINEMA';

/** FR-8.1 / FR-8.2: validate a QR code and mark the ticket used, atomically. */
checkerRouter.post(
  '/scan',
  validate(z.object({ code: z.string().trim().min(4).max(200), showId: z.string().max(40).optional() })),
  h(async (req, res) => {
    const token = req.body.code.replace(/^SHOWPASS:/, '');
    // Allow manual entry of the booking reference as a fallback when a QR will not scan.
    const booking = await prisma.booking.findFirst({
      where: token.startsWith('SP-') ? { reference: token.toUpperCase() } : { qrToken: token },
      include: {
        seats: { orderBy: { label: 'asc' } },
        items: { orderBy: { name: 'asc' } },
        user: { select: { name: true } },
        show: { include: { movie: { select: { title: true } }, screen: { select: { name: true, cinemaId: true } } } },
      },
    });

    const respond = async (result: ScanResult, message: string) => {
      await audit({ userId: req.user!.id, action: `ticket.scan.${result.toLowerCase()}`, entity: 'Booking', entityId: booking?.id ?? null, meta: { showId: req.body.showId ?? null } });
      res.json({
        result,
        message,
        booking: booking && {
          reference: booking.reference,
          customer: booking.user.name,
          movie: booking.show.movie.title,
          screen: booking.show.screen.name,
          startTime: booking.show.startTime,
          seats: booking.seats.map((s) => s.label),
          items: booking.items.map((i) => `${i.quantity}× ${i.name}`),
          checkedInAt: booking.checkedInAt,
        },
      });
    };

    if (!booking) return respond('NOT_FOUND', 'No ticket matches this code');
    const u = req.user!;
    if (u.role !== 'SUPER_ADMIN' && booking.show.screen.cinemaId !== u.cinemaId) return respond('WRONG_CINEMA', 'This ticket is for a different cinema');
    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') return respond('CANCELLED', 'This booking was cancelled');
    if (booking.status !== 'CONFIRMED') return respond('NOT_PAID', 'This booking is not paid');
    if (req.body.showId && booking.showId !== req.body.showId) return respond('WRONG_SHOW', 'This ticket is for another show');
    if (booking.checkedInAt) return respond('ALREADY_USED', 'This ticket has already been used');

    const { count } = await prisma.booking.updateMany({
      where: { id: booking.id, checkedInAt: null, status: 'CONFIRMED' },
      data: { checkedInAt: new Date(), checkedInById: u.id },
    });
    if (count === 0) return respond('ALREADY_USED', 'This ticket has already been used');
    booking.checkedInAt = new Date();
    return respond('VALID', `Admit ${booking.seats.length}`);
  }),
);
