import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { getQuery, validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as catalogue from './catalogue.service.js';
import { createHold } from '../bookings/booking.service.js';
import { presentBooking } from '../bookings/booking.present.js';

export const catalogueRouter = Router();

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listQuery = z.object({
  status: z.enum(['NOW_SHOWING', 'COMING_SOON']).optional(),
  q: z.string().trim().max(100).optional(),
  genre: z.string().max(50).optional(),
  language: z.string().max(50).optional(),
  format: z.enum(['TWO_D', 'THREE_D', 'IMAX']).optional(),
  date: dateKey.optional(),
});

catalogueRouter.get(
  '/movies',
  validate(listQuery, 'query'),
  h(async (req, res) => {
    res.json({ movies: await catalogue.listMovies(getQuery(req, listQuery)) });
  }),
);

catalogueRouter.get(
  '/movies/meta',
  h(async (_req, res) => {
    res.json(await catalogue.catalogueMeta());
  }),
);

catalogueRouter.get(
  '/movies/:slug',
  h(async (req, res) => {
    res.json({ movie: await catalogue.getMovie(req.params.slug) });
  }),
);

const showtimesQuery = z.object({ date: dateKey.optional(), cinemaId: z.string().max(40).optional() });

catalogueRouter.get(
  '/movies/:id/showtimes',
  validate(showtimesQuery, 'query'),
  h(async (req, res) => {
    const q = getQuery(req, showtimesQuery);
    res.json(await catalogue.movieShowtimes(req.params.id, q.date, q.cinemaId));
  }),
);

catalogueRouter.get(
  '/shows/:id',
  h(async (req, res) => {
    res.json(await catalogue.showSeatMap(req.params.id, req.user?.id));
  }),
);

catalogueRouter.post(
  '/shows/:id/holds',
  requireAuth,
  validate(z.object({ seatIds: z.array(z.string().min(1).max(40)).min(1).max(50) })),
  h(async (req, res) => {
    const booking = await createHold(req.user!, req.params.id, req.body.seatIds);
    res.status(201).json({ booking: await presentBooking(booking) });
  }),
);

/** FR-10.1: customers who attended a show can rate and review the movie. */
catalogueRouter.post(
  '/movies/:id/reviews',
  requireAuth,
  validate(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })),
  h(async (req, res) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } });
    if (!movie) throw notFound('Movie');
    const attended = await prisma.booking.findFirst({
      where: {
        userId: req.user!.id,
        show: { movieId: movie.id, startTime: { lt: new Date() } },
        OR: [{ checkedInAt: { not: null } }, { status: 'CONFIRMED' }],
      },
    });
    if (!attended) throw forbidden('You can review a movie after attending a show');
    if (req.body.comment && /<[^>]+>/.test(req.body.comment)) throw badRequest('INVALID', 'HTML is not allowed in reviews');
    const review = await prisma.review.upsert({
      where: { userId_movieId: { userId: req.user!.id, movieId: movie.id } },
      create: { userId: req.user!.id, movieId: movie.id, rating: req.body.rating, comment: req.body.comment },
      update: { rating: req.body.rating, comment: req.body.comment },
    });
    res.status(201).json({ review });
  }),
);

/** FR-2.5 (low priority): watchlist for upcoming movies. */
catalogueRouter.post(
  '/movies/:id/watchlist',
  requireAuth,
  h(async (req, res) => {
    await prisma.watchlistItem.upsert({
      where: { userId_movieId: { userId: req.user!.id, movieId: req.params.id } },
      create: { userId: req.user!.id, movieId: req.params.id },
      update: {},
    });
    res.status(204).end();
  }),
);

catalogueRouter.delete(
  '/movies/:id/watchlist',
  requireAuth,
  h(async (req, res) => {
    await prisma.watchlistItem.deleteMany({ where: { userId: req.user!.id, movieId: req.params.id } });
    res.status(204).end();
  }),
);
