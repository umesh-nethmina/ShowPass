import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { clearSettingsCache } from '../src/modules/settings/settings.service.js';

export const app = createApp();
const HEADER = { 'X-Requested-With': 'ShowPass' };

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function resetDb() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.bookingSeat.deleteMany(),
    prisma.bookingItem.deleteMany(),
    prisma.showSeat.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.show.deleteMany(),
    prisma.priceRule.deleteMany(),
    prisma.seat.deleteMany(),
    prisma.screen.deleteMany(),
    prisma.review.deleteMany(),
    prisma.watchlistItem.deleteMany(),
    prisma.verificationCode.deleteMany(),
    prisma.user.deleteMany(),
    prisma.cinema.deleteMany(),
    prisma.movie.deleteMany(),
    prisma.promoCode.deleteMany(),
    prisma.concession.deleteMany(),
    prisma.setting.deleteMany(),
  ]);
  clearSettingsCache();
}

/** An authenticated supertest agent (cookie jar) with the CSRF header pre-set. */
export function agent() {
  const a = request.agent(app);
  return {
    raw: a,
    get: (url: string) => a.get(url).set(HEADER),
    post: (url: string, body?: object) => a.post(url).set(HEADER).send(body ?? {}),
    put: (url: string, body?: object) => a.put(url).set(HEADER).send(body ?? {}),
    patch: (url: string, body?: object) => a.patch(url).set(HEADER).send(body ?? {}),
    delete: (url: string) => a.delete(url).set(HEADER),
  };
}
export type Agent = ReturnType<typeof agent>;

export async function createUser(opts: { role?: Role; verified?: boolean; cinemaId?: string | null } = {}) {
  const id = uniq();
  const password = 'Passw0rd!';
  const user = await prisma.user.create({
    data: {
      name: `User ${id}`,
      email: `u${id}@test.local`,
      phone: `+9477${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      passwordHash: await bcrypt.hash(password, 4),
      role: opts.role ?? 'CUSTOMER',
      cinemaId: opts.cinemaId ?? null,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
  return { user, password };
}

export async function loginAs(opts: Parameters<typeof createUser>[0] = {}) {
  const { user, password } = await createUser(opts);
  const a = agent();
  const res = await a.post('/api/auth/login', { identifier: user.email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, agent: a };
}

/** A cinema with one 2×5 screen (row A standard, row B premium), price rules, a movie and a show tomorrow. */
export async function createFixture(opts: { startsInMinutes?: number } = {}) {
  const cinema = await prisma.cinema.create({ data: { name: `Cinema ${uniq()}`, address: '1 Test St', city: 'Colombo', contact: '0111234567' } });
  const seats = [];
  for (const [r, row] of ['A', 'B'].entries()) {
    for (let c = 0; c < 5; c++) seats.push({ gridRow: r, gridCol: c, rowLabel: row, seatNumber: c + 1, category: r === 0 ? 'STANDARD' : 'PREMIUM' } as const);
  }
  const screen = await prisma.screen.create({
    data: { cinemaId: cinema.id, name: 'Screen 1', format: 'TWO_D', gridRows: 2, gridCols: 5, seats: { create: seats } },
    include: { seats: { orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }] } },
  });
  await prisma.priceRule.createMany({
    data: [
      { cinemaId: cinema.id, category: 'STANDARD', price: 1000, daysOfWeek: [] },
      { cinemaId: cinema.id, category: 'PREMIUM', price: 1500, daysOfWeek: [] },
    ],
  });
  const movie = await prisma.movie.create({
    data: {
      title: 'Test Movie',
      slug: `test-movie-${uniq()}`,
      synopsis: 'A test.',
      durationMin: 120,
      language: 'English',
      genres: ['Drama'],
      cast: ['A. Actor'],
      ageRating: 'PG',
      releaseDate: new Date(),
      posterUrl: 'https://example.com/p.jpg',
      status: 'NOW_SHOWING',
    },
  });
  const start = new Date(Date.now() + (opts.startsInMinutes ?? 24 * 60) * 60_000);
  const show = await prisma.show.create({
    data: { movieId: movie.id, screenId: screen.id, startTime: start, endTime: new Date(start.getTime() + 135 * 60_000), language: 'English' },
  });
  await prisma.showSeat.createMany({
    data: screen.seats.map((s) => ({ showId: show.id, seatId: s.id, price: s.category === 'STANDARD' ? 1000 : 1500 })),
  });
  return { cinema, screen, seats: screen.seats, movie, show };
}

/** Holds seats, pays through the mock gateway and returns the confirmed booking. */
export async function bookAndPay(a: Agent, showId: string, seatIds: string[]) {
  const hold = await a.post(`/api/shows/${showId}/holds`, { seatIds });
  if (hold.status !== 201) throw new Error(`hold failed: ${JSON.stringify(hold.body)}`);
  const pay = await a.post(`/api/bookings/${hold.body.booking.id}/pay`);
  const done = await a.post(`/api/payments/mock/${pay.body.paymentId}/complete`, { outcome: 'SUCCESS' });
  if (done.body.status !== 'SUCCESS') throw new Error(`payment failed: ${JSON.stringify(done.body)}`);
  return (await a.get(`/api/bookings/${hold.body.booking.id}`)).body.booking;
}
