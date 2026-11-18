import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { dec, toCents } from '../../lib/money.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/auth.js';
import { assertCinemaAccess, logAdmin, scopedCinemaId } from './scope.js';

/** Cinemas, screens with seat layouts (FR-9.2) and price rules (FR-9.4). */
export const venuesRouter = Router();

const cinemaSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(2).max(300),
  city: z.string().trim().min(2).max(100),
  contact: z.string().trim().min(5).max(100),
  isActive: z.boolean().default(true),
});

venuesRouter.get(
  '/cinemas',
  h(async (req, res) => {
    const cinemaId = scopedCinemaId(req.user!);
    const cinemas = await prisma.cinema.findMany({
      where: cinemaId ? { id: cinemaId } : {},
      orderBy: { name: 'asc' },
      include: { screens: { orderBy: { name: 'asc' }, include: { _count: { select: { seats: { where: { isActive: true } } } } } } },
    });
    res.json({ cinemas });
  }),
);

venuesRouter.post(
  '/cinemas',
  requireRole('SUPER_ADMIN'),
  validate(cinemaSchema),
  h(async (req, res) => {
    const cinema = await prisma.cinema.create({ data: req.body });
    await logAdmin(req, 'cinema.create', 'Cinema', cinema.id, { name: cinema.name });
    res.status(201).json({ cinema });
  }),
);

venuesRouter.patch(
  '/cinemas/:id',
  validate(cinemaSchema.partial()),
  h(async (req, res) => {
    assertCinemaAccess(req.user!, req.params.id);
    const cinema = await prisma.cinema.update({ where: { id: req.params.id }, data: req.body });
    await logAdmin(req, 'cinema.update', 'Cinema', cinema.id);
    res.json({ cinema });
  }),
);

/* ---------- screens & seat layout ---------- */

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const layoutSeat = z.object({
  gridRow: z.number().int().min(0).max(59),
  gridCol: z.number().int().min(0).max(79),
  rowLabel: z.string().trim().min(1).max(3),
  seatNumber: z.number().int().min(1).max(200),
  category: z.enum(['STANDARD', 'PREMIUM', 'RECLINER']),
});

const screenSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    format: z.enum(['TWO_D', 'THREE_D', 'IMAX']),
    gridRows: z.number().int().min(1).max(60),
    gridCols: z.number().int().min(1).max(80),
    seats: z.array(layoutSeat).min(1).max(2000),
  })
  .superRefine((s, ctx) => {
    const pos = new Set<string>();
    const lbl = new Set<string>();
    for (const seat of s.seats) {
      if (seat.gridRow >= s.gridRows || seat.gridCol >= s.gridCols) {
        ctx.addIssue({ code: 'custom', message: `Seat ${seat.rowLabel}${seat.seatNumber} is outside the grid`, path: ['seats'] });
      }
      const p = `${seat.gridRow}:${seat.gridCol}`;
      const l = `${seat.rowLabel}${seat.seatNumber}`;
      if (pos.has(p)) ctx.addIssue({ code: 'custom', message: `Two seats share position ${p}`, path: ['seats'] });
      if (lbl.has(l)) ctx.addIssue({ code: 'custom', message: `Seat label ${l} is used twice`, path: ['seats'] });
      pos.add(p);
      lbl.add(l);
    }
  });

venuesRouter.get(
  '/screens/:id',
  h(async (req, res) => {
    const screen = await prisma.screen.findUnique({
      where: { id: req.params.id },
      include: { seats: { where: { isActive: true }, orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }] } },
    });
    if (!screen) throw notFound('Screen');
    assertCinemaAccess(req.user!, screen.cinemaId);
    res.json({ screen, rowLabels: ROW_LABELS });
  }),
);

venuesRouter.post(
  '/cinemas/:cinemaId/screens',
  validate(screenSchema),
  h(async (req, res) => {
    assertCinemaAccess(req.user!, req.params.cinemaId);
    const { seats, ...data } = req.body as z.infer<typeof screenSchema>;
    const screen = await prisma.screen.create({
      data: { ...data, cinemaId: req.params.cinemaId, seats: { create: seats } },
      include: { seats: true },
    });
    await logAdmin(req, 'screen.create', 'Screen', screen.id, { seats: seats.length });
    res.status(201).json({ screen });
  }),
);

/**
 * Replace a screen's layout. Blocked while future shows exist (their seat maps would no longer match).
 * Seats with booking history are deactivated instead of deleted.
 */
venuesRouter.put(
  '/screens/:id',
  validate(screenSchema),
  h(async (req, res) => {
    const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, include: { seats: true } });
    if (!screen) throw notFound('Screen');
    assertCinemaAccess(req.user!, screen.cinemaId);
    const body = req.body as z.infer<typeof screenSchema>;

    const futureShows = await prisma.show.count({ where: { screenId: screen.id, status: 'SCHEDULED', endTime: { gt: new Date() } } });
    const layoutChanged =
      body.gridRows !== screen.gridRows ||
      body.gridCols !== screen.gridCols ||
      JSON.stringify(body.seats.map((s) => [s.gridRow, s.gridCol, s.rowLabel, s.seatNumber, s.category]).sort()) !==
        JSON.stringify(screen.seats.filter((s) => s.isActive).map((s) => [s.gridRow, s.gridCol, s.rowLabel, s.seatNumber, s.category]).sort());
    if (layoutChanged && futureShows > 0) {
      throw badRequest('SCREEN_IN_USE', `This screen has ${futureShows} upcoming show(s). Cancel or finish them before changing the seat layout.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.screen.update({ where: { id: screen.id }, data: { name: body.name, format: body.format, gridRows: body.gridRows, gridCols: body.gridCols } });
      if (!layoutChanged) return;
      const used = new Set(
        (await tx.showSeat.findMany({ where: { seat: { screenId: screen.id } }, select: { seatId: true }, distinct: ['seatId'] })).map((s) => s.seatId),
      );
      // Remove unused seats; retire used ones (moved off-grid with a unique label so new seats can reuse the spot).
      await tx.seat.deleteMany({ where: { screenId: screen.id, id: { notIn: [...used] } } });
      let n = 0;
      for (const id of used) {
        n += 1;
        await tx.seat.update({ where: { id }, data: { isActive: false, gridRow: -n, gridCol: -n, rowLabel: `~${id.slice(-6)}` } });
      }
      await tx.seat.createMany({ data: body.seats.map((s) => ({ ...s, screenId: screen.id })) });
    });
    await logAdmin(req, 'screen.update', 'Screen', screen.id, { layoutChanged, seats: body.seats.length });
    res.json({ screen: await prisma.screen.findUnique({ where: { id: screen.id }, include: { seats: { where: { isActive: true } } } }) });
  }),
);

/* ---------- price rules ---------- */

const priceRuleSchema = z
  .object({
    category: z.enum(['STANDARD', 'PREMIUM', 'RECLINER']),
    price: z.number().min(0).max(1_000_000),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startMinute: z.number().int().min(0).max(1440).nullable().optional(),
    endMinute: z.number().int().min(0).max(1440).nullable().optional(),
    priority: z.number().int().min(0).max(100).default(0),
  })
  .refine((r) => r.startMinute == null || r.endMinute == null || r.endMinute > r.startMinute, {
    message: 'End time must be after start time',
    path: ['endMinute'],
  });

const presentRule = (r: { price: unknown } & Record<string, unknown>) => ({ ...r, priceCents: toCents(r.price as number), price: undefined });

venuesRouter.get(
  '/cinemas/:cinemaId/price-rules',
  h(async (req, res) => {
    assertCinemaAccess(req.user!, req.params.cinemaId);
    const rules = await prisma.priceRule.findMany({ where: { cinemaId: req.params.cinemaId }, orderBy: [{ category: 'asc' }, { priority: 'desc' }] });
    res.json({ priceRules: rules.map(presentRule) });
  }),
);

venuesRouter.post(
  '/cinemas/:cinemaId/price-rules',
  validate(priceRuleSchema),
  h(async (req, res) => {
    assertCinemaAccess(req.user!, req.params.cinemaId);
    const { price, ...rest } = req.body as z.infer<typeof priceRuleSchema>;
    const rule = await prisma.priceRule.create({ data: { ...rest, price: dec(Math.round(price * 100)), cinemaId: req.params.cinemaId } });
    await logAdmin(req, 'price.create', 'PriceRule', rule.id, { category: rule.category, price });
    res.status(201).json({ priceRule: presentRule(rule) });
  }),
);

venuesRouter.delete(
  '/price-rules/:id',
  h(async (req, res) => {
    const rule = await prisma.priceRule.findUnique({ where: { id: req.params.id } });
    if (!rule) throw notFound('Price rule');
    assertCinemaAccess(req.user!, rule.cinemaId);
    await prisma.priceRule.delete({ where: { id: rule.id } });
    await logAdmin(req, 'price.delete', 'PriceRule', rule.id);
    res.status(204).end();
  }),
);
