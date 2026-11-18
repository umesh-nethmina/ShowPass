import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import type { AuthUser } from '../../middleware/auth.js';
import { dec } from '../../lib/money.js';
import { validate } from '../../middleware/validate.js';
import { assertCinemaAccess, logAdmin } from './scope.js';

/** Movies (FR-9.1), promo codes (FR-9.6) and review moderation (FR-10.2). */
export const contentRouter = Router();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const url = z.string().trim().url().max(500);
const movieSchema = z.object({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().trim().min(1).max(5000),
  durationMin: z.number().int().min(1).max(600),
  language: z.string().trim().min(1).max(50),
  genres: z.array(z.string().trim().min(1).max(40)).max(10),
  cast: z.array(z.string().trim().min(1).max(100)).max(30),
  ageRating: z.string().trim().min(1).max(10),
  releaseDate: z.coerce.date(),
  posterUrl: url,
  backdropUrl: url.nullable().optional(),
  trailerUrl: url.nullable().optional(),
  status: z.enum(['COMING_SOON', 'NOW_SHOWING', 'ARCHIVED']),
});

contentRouter.get(
  '/movies',
  h(async (_req, res) => {
    res.json({ movies: await prisma.movie.findMany({ orderBy: [{ status: 'asc' }, { releaseDate: 'desc' }] }) });
  }),
);

contentRouter.get(
  '/movies/:id',
  h(async (req, res) => {
    res.json({ movie: await prisma.movie.findUniqueOrThrow({ where: { id: req.params.id } }) });
  }),
);

contentRouter.post(
  '/movies',
  validate(movieSchema),
  h(async (req, res) => {
    let slug = slugify(req.body.title) || 'movie';
    if (await prisma.movie.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
    const movie = await prisma.movie.create({ data: { ...req.body, slug } });
    await logAdmin(req, 'movie.create', 'Movie', movie.id, { title: movie.title });
    res.status(201).json({ movie });
  }),
);

contentRouter.patch(
  '/movies/:id',
  validate(movieSchema.partial()),
  h(async (req, res) => {
    const movie = await prisma.movie.update({ where: { id: req.params.id }, data: req.body });
    await logAdmin(req, 'movie.update', 'Movie', movie.id, { fields: Object.keys(req.body) });
    res.json({ movie });
  }),
);

/* ---------- promo codes ---------- */

const promoSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3–30 letters, numbers, - or _'),
    description: z.string().trim().max(200).nullable().optional(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.number().positive(),
    maxDiscount: z.number().positive().nullable().optional(),
    minAmount: z.number().positive().nullable().optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    usageLimit: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.validTo > p.validFrom, { message: 'End date must be after start date', path: ['validTo'] })
  .refine((p) => p.type !== 'PERCENT' || p.value <= 100, { message: 'Percent cannot exceed 100', path: ['value'] });

const presentPromo = (p: Awaited<ReturnType<typeof prisma.promoCode.findFirstOrThrow>>) => ({
  ...p,
  value: Number(p.value),
  maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
  minAmount: p.minAmount != null ? Number(p.minAmount) : null,
});

const promoData = (b: z.infer<typeof promoSchema>) => ({
  ...b,
  value: dec(Math.round(b.value * 100)),
  maxDiscount: b.maxDiscount != null ? dec(Math.round(b.maxDiscount * 100)) : null,
  minAmount: b.minAmount != null ? dec(Math.round(b.minAmount * 100)) : null,
});

contentRouter.get(
  '/promo-codes',
  h(async (_req, res) => {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ promoCodes: promos.map(presentPromo) });
  }),
);

contentRouter.post(
  '/promo-codes',
  validate(promoSchema),
  h(async (req, res) => {
    const promo = await prisma.promoCode.create({ data: promoData(req.body) });
    await logAdmin(req, 'promo.create', 'PromoCode', promo.id, { code: promo.code });
    res.status(201).json({ promoCode: presentPromo(promo) });
  }),
);

contentRouter.put(
  '/promo-codes/:id',
  validate(promoSchema),
  h(async (req, res) => {
    const existing = await prisma.promoCode.findUniqueOrThrow({ where: { id: req.params.id } });
    if (req.body.usageLimit != null && req.body.usageLimit < existing.usedCount) {
      throw badRequest('INVALID', `Usage limit cannot be below times already used (${existing.usedCount})`);
    }
    const promo = await prisma.promoCode.update({ where: { id: existing.id }, data: promoData(req.body) });
    await logAdmin(req, 'promo.update', 'PromoCode', promo.id, { code: promo.code });
    res.json({ promoCode: presentPromo(promo) });
  }),
);

/* ---------- reviews ---------- */

contentRouter.get(
  '/reviews',
  h(async (_req, res) => {
    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true, email: true } }, movie: { select: { title: true } } },
    });
    res.json({ reviews });
  }),
);

contentRouter.patch(
  '/reviews/:id',
  validate(z.object({ isHidden: z.boolean() })),
  h(async (req, res) => {
    const review = await prisma.review.update({ where: { id: req.params.id }, data: { isHidden: req.body.isHidden } });
    await logAdmin(req, req.body.isHidden ? 'review.hide' : 'review.show', 'Review', review.id);
    res.json({ review });
  }),
);


/* ---------- food & drinks (FR-5.5) ---------- */

const concessionSchema = z.object({
  cinemaId: z.string().nullable(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).nullable().optional(),
  price: z.number().positive().max(100_000),
  imageUrl: z.string().trim().url().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const presentConcession = (c: { price: unknown } & Record<string, unknown>) => ({ ...c, price: Number(c.price) });

/** Cinema admins manage their own cinema's items; items sold everywhere (cinemaId null) are super-admin only. */
function assertConcessionAccess(user: AuthUser, cinemaId: string | null) {
  if (user.role === 'SUPER_ADMIN') return;
  if (cinemaId === null) throw forbidden('Only a super admin can manage items sold at every cinema');
  assertCinemaAccess(user, cinemaId);
}

contentRouter.get(
  '/concessions',
  h(async (req, res) => {
    const u = req.user!;
    const list = await prisma.concession.findMany({
      where: u.role === 'SUPER_ADMIN' ? {} : { OR: [{ cinemaId: u.cinemaId ?? '__none__' }, { cinemaId: null }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { cinema: { select: { name: true } } },
    });
    res.json({ concessions: list.map(presentConcession) });
  }),
);

contentRouter.post(
  '/concessions',
  validate(concessionSchema),
  h(async (req, res) => {
    assertConcessionAccess(req.user!, req.body.cinemaId);
    const c = await prisma.concession.create({ data: { ...req.body, price: dec(Math.round(req.body.price * 100)) } });
    await logAdmin(req, 'concession.create', 'Concession', c.id, { name: c.name });
    res.status(201).json({ concession: presentConcession(c) });
  }),
);

contentRouter.put(
  '/concessions/:id',
  validate(concessionSchema),
  h(async (req, res) => {
    const existing = await prisma.concession.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Item');
    assertConcessionAccess(req.user!, existing.cinemaId);
    assertConcessionAccess(req.user!, req.body.cinemaId);
    const c = await prisma.concession.update({ where: { id: existing.id }, data: { ...req.body, price: dec(Math.round(req.body.price * 100)) } });
    await logAdmin(req, 'concession.update', 'Concession', c.id, { name: c.name });
    res.json({ concession: presentConcession(c) });
  }),
);
