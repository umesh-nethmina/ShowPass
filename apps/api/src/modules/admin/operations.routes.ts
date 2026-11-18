import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toCents } from '../../lib/money.js';
import { dayRange, localDateKey } from '../../lib/format.js';
import { logger } from '../../lib/logger.js';
import { getQuery, validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/auth.js';
import { emitSeatChanges } from '../../realtime/socket.js';
import { normalizePhone, emailSchema, passwordSchema, phoneSchema } from '../auth/auth.schemas.js';
import { hashPassword, publicUser } from '../auth/auth.service.js';
import { bookingInclude, cancelBooking, releasePending } from '../bookings/booking.service.js';
import { presentBooking } from '../bookings/booking.present.js';
import { sendTicketNotifications } from '../tickets/ticket.notify.js';
import { getSettings, settingsSchema, updateSettings } from '../settings/settings.service.js';
import { assertCinemaAccess, logAdmin, scopedCinemaId } from './scope.js';
import { scheduleShows } from './shows.service.js';

/** Showtimes (FR-9.3), bookings (FR-9.5), staff (FR-9.8), settings and dashboard. */
export const operationsRouter = Router();

/* ---------- dashboard ---------- */

operationsRouter.get(
  '/dashboard',
  h(async (req, res) => {
    const cinemaId = scopedCinemaId(req.user!, req.query.cinemaId as string | undefined);
    const showScope: Prisma.ShowWhereInput = cinemaId ? { screen: { cinemaId } } : {};
    const { start, end } = dayRange(localDateKey(new Date()));
    const [todaysBookings, todaysShows, upcoming] = await Promise.all([
      prisma.booking.findMany({
        where: { status: 'CONFIRMED', confirmedAt: { gte: start, lt: end }, show: showScope },
        select: { total: true, _count: { select: { seats: true } } },
      }),
      prisma.show.findMany({
        where: { status: 'SCHEDULED', startTime: { gte: start, lt: end }, ...showScope },
        orderBy: { startTime: 'asc' },
        include: {
          movie: { select: { title: true } },
          screen: { select: { name: true, cinema: { select: { name: true } } } },
          _count: { select: { showSeats: true } },
        },
      }),
      prisma.show.count({ where: { status: 'SCHEDULED', startTime: { gte: new Date() }, ...showScope } }),
    ]);
    const booked = await prisma.showSeat.groupBy({
      by: ['showId'],
      where: { showId: { in: todaysShows.map((s) => s.id) }, status: 'BOOKED' },
      _count: true,
    });
    const bookedMap = new Map(booked.map((b) => [b.showId, b._count]));
    res.json({
      today: {
        bookings: todaysBookings.length,
        tickets: todaysBookings.reduce((a, b) => a + b._count.seats, 0),
        revenueCents: todaysBookings.reduce((a, b) => a + toCents(b.total), 0),
      },
      upcomingShows: upcoming,
      shows: todaysShows.map((s) => ({
        id: s.id,
        startTime: s.startTime,
        movie: s.movie.title,
        screen: s.screen.name,
        cinema: s.screen.cinema.name,
        capacity: s._count.showSeats,
        booked: bookedMap.get(s.id) ?? 0,
      })),
      currency: (await getSettings()).currency,
    });
  }),
);

/* ---------- shows ---------- */

const showsQuery = z.object({ cinemaId: z.string().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.coerce.number().int().min(1).max(31).default(7) });

operationsRouter.get(
  '/shows',
  validate(showsQuery, 'query'),
  h(async (req, res) => {
    const q = getQuery(req, showsQuery);
    const cinemaId = scopedCinemaId(req.user!, q.cinemaId);
    const { start } = dayRange(q.from ?? localDateKey(new Date()));
    const end = new Date(start);
    end.setDate(end.getDate() + q.days);
    const shows = await prisma.show.findMany({
      where: { startTime: { gte: start, lt: end }, ...(cinemaId ? { screen: { cinemaId } } : {}) },
      orderBy: { startTime: 'asc' },
      include: {
        movie: { select: { id: true, title: true, durationMin: true } },
        screen: { select: { id: true, name: true, format: true, cinema: { select: { id: true, name: true } } } },
        _count: { select: { showSeats: true } },
      },
    });
    const booked = await prisma.showSeat.groupBy({ by: ['showId'], where: { showId: { in: shows.map((s) => s.id) }, status: 'BOOKED' }, _count: true });
    const bookedMap = new Map(booked.map((b) => [b.showId, b._count]));
    res.json({ shows: shows.map((s) => ({ ...s, capacity: s._count.showSeats, booked: bookedMap.get(s.id) ?? 0 })) });
  }),
);

operationsRouter.post(
  '/shows',
  validate(
    z.object({
      movieId: z.string(),
      screenId: z.string(),
      language: z.string().trim().min(1).max(50),
      startTimes: z.array(z.coerce.date()).min(1).max(50),
    }),
  ),
  h(async (req, res) => {
    const shows = await scheduleShows(req.user!, req.body);
    await logAdmin(req, 'show.create', 'Show', null, { ids: shows.map((s) => s.id) });
    res.status(201).json({ shows });
  }),
);

/** Cancel a show: every confirmed booking is cancelled with a full refund and open holds are released. */
operationsRouter.post(
  '/shows/:id/cancel',
  h(async (req, res) => {
    const show = await prisma.show.findUnique({ where: { id: req.params.id }, include: { screen: true } });
    if (!show) throw notFound('Show');
    assertCinemaAccess(req.user!, show.screen.cinemaId);
    if (show.status === 'CANCELLED') throw badRequest('ALREADY_CANCELLED', 'This show is already cancelled');
    await prisma.show.update({ where: { id: show.id }, data: { status: 'CANCELLED' } });
    const pending = await prisma.booking.findMany({ where: { showId: show.id, status: 'PENDING' }, select: { id: true } });
    for (const p of pending) {
      const r = await releasePending(p.id, 'EXPIRED');
      if (r.showId) emitSeatChanges(r.showId, r.seatIds.map((seatId) => ({ seatId, status: 'AVAILABLE' as const })));
    }
    const confirmed = await prisma.booking.findMany({ where: { showId: show.id, status: 'CONFIRMED' }, select: { id: true } });
    let refunded = 0;
    for (const b of confirmed) {
      try {
        await cancelBooking(req.user!, b.id, { byStaff: true });
        refunded++;
      } catch (err) {
        logger.error({ err, bookingId: b.id }, 'failed to cancel booking for cancelled show');
      }
    }
    await logAdmin(req, 'show.cancel', 'Show', show.id, { bookingsCancelled: refunded });
    res.json({ cancelled: true, bookingsCancelled: refunded, bookingsTotal: confirmed.length });
  }),
);

/* ---------- bookings ---------- */

operationsRouter.get(
  '/bookings',
  validate(z.object({ q: z.string().trim().max(100).optional(), status: z.string().optional() }), 'query'),
  h(async (req, res) => {
    const { q, status } = getQuery(req, z.object({ q: z.string().optional(), status: z.string().optional() }));
    const cinemaId = scopedCinemaId(req.user!);
    const where: Prisma.BookingWhereInput = { ...(cinemaId ? { show: { screen: { cinemaId } } } : {}) };
    if (status) where.status = status as Prisma.BookingWhereInput['status'];
    if (q) {
      const phone = normalizePhone(q);
      where.OR = [
        { reference: { equals: q.toUpperCase() } },
        { reference: { contains: q.toUpperCase() } },
        { user: { email: { contains: q.toLowerCase() } } },
        ...(phone ? [{ user: { phone } }] : []),
      ];
    }
    const list = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { ...bookingInclude, user: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.json({ bookings: await Promise.all(list.map(async (b) => ({ ...(await presentBooking(b)), customer: b.user }))) });
  }),
);

operationsRouter.post(
  '/bookings/:id/cancel',
  h(async (req, res) => {
    const b = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { show: { include: { screen: true } } } });
    if (!b) throw notFound('Booking');
    assertCinemaAccess(req.user!, b.show.screen.cinemaId);
    const booking = await cancelBooking(req.user!, b.id, { byStaff: true });
    res.json({ booking: await presentBooking(booking) });
  }),
);

operationsRouter.post(
  '/bookings/:id/resend',
  h(async (req, res) => {
    const b = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { show: { include: { screen: true } } } });
    if (!b) throw notFound('Booking');
    assertCinemaAccess(req.user!, b.show.screen.cinemaId);
    if (b.status !== 'CONFIRMED') throw badRequest('NOT_CONFIRMED', 'Only confirmed bookings have tickets');
    await sendTicketNotifications(b.id);
    await logAdmin(req, 'booking.resend', 'Booking', b.id);
    res.json({ sent: true });
  }),
);

/* ---------- staff (super admin) ---------- */

const staffRoles = z.enum(['TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN']);

operationsRouter.get(
  '/staff',
  requireRole('SUPER_ADMIN'),
  h(async (_req, res) => {
    const staff = await prisma.user.findMany({
      where: { role: { not: 'CUSTOMER' } },
      orderBy: { name: 'asc' },
      include: { cinema: { select: { id: true, name: true } } },
    });
    res.json({ staff: staff.map((u) => ({ ...publicUser(u), isActive: u.isActive, cinema: u.cinema, createdAt: u.createdAt })) });
  }),
);

operationsRouter.post(
  '/staff',
  requireRole('SUPER_ADMIN'),
  validate(
    z
      .object({ name: z.string().trim().min(2).max(100), email: emailSchema, phone: phoneSchema, password: passwordSchema, role: staffRoles, cinemaId: z.string().nullable().optional() })
      .refine((s) => s.role === 'SUPER_ADMIN' || s.cinemaId, { message: 'Choose a cinema for this role', path: ['cinemaId'] }),
  ),
  h(async (req, res) => {
    const { password, ...data } = req.body;
    const user = await prisma.user.create({
      data: { ...data, cinemaId: data.role === 'SUPER_ADMIN' ? null : data.cinemaId, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    });
    await logAdmin(req, 'staff.create', 'User', user.id, { role: user.role });
    res.status(201).json({ user: publicUser(user) });
  }),
);

operationsRouter.patch(
  '/staff/:id',
  requireRole('SUPER_ADMIN'),
  validate(z.object({ role: z.enum(['CUSTOMER', 'TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN']).optional(), cinemaId: z.string().nullable().optional(), isActive: z.boolean().optional() })),
  h(async (req, res) => {
    if (req.params.id === req.user!.id && (req.body.isActive === false || (req.body.role && req.body.role !== 'SUPER_ADMIN'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot remove your own super admin access');
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: req.body });
    await logAdmin(req, 'staff.update', 'User', user.id, req.body);
    res.json({ user: publicUser(user) });
  }),
);

/* ---------- settings (super admin) ---------- */

operationsRouter.get(
  '/settings',
  h(async (_req, res) => {
    res.json({ settings: await getSettings() });
  }),
);

operationsRouter.put(
  '/settings',
  requireRole('SUPER_ADMIN'),
  validate(settingsSchema.partial()),
  h(async (req, res) => {
    const settings = await updateSettings(req.body);
    await logAdmin(req, 'settings.update', 'Setting', null, req.body);
    res.json({ settings });
  }),
);

/* ---------- audit log (super admin) ---------- */

operationsRouter.get(
  '/audit',
  requireRole('SUPER_ADMIN'),
  h(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { user: { select: { name: true, email: true } } } });
    res.json({ logs });
  }),
);
