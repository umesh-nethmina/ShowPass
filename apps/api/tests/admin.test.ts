import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { bookAndPay, createFixture, loginAs, resetDb } from './helpers.js';

beforeEach(resetDb);

const tomorrowAt = (h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
};

describe('admin access control (NFR-9)', () => {
  it('blocks customers and scopes cinema admins to their cinema', async () => {
    const f1 = await createFixture();
    const f2 = await createFixture();
    const { agent: customer } = await loginAs();
    expect((await customer.get('/api/admin/movies')).status).toBe(403);

    const { agent: manager } = await loginAs({ role: 'CINEMA_ADMIN', cinemaId: f1.cinema.id });
    const cinemas = await manager.get('/api/admin/cinemas');
    expect(cinemas.body.cinemas.map((c: { id: string }) => c.id)).toEqual([f1.cinema.id]);
    expect((await manager.get(`/api/admin/cinemas/${f2.cinema.id}/price-rules`)).status).toBe(403);
    expect((await manager.post('/api/admin/cinemas', { name: 'X', address: 'Y street', city: 'Z', contact: '0111111111' })).status).toBe(403);
  });
});

describe('scheduling (FR-9.3, FR-9.4)', () => {
  it('creates shows with frozen prices and rejects overlaps on the same screen', async () => {
    const f = await createFixture();
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    const created = await admin.post('/api/admin/shows', { movieId: f.movie.id, screenId: f.screen.id, language: 'English', startTimes: [tomorrowAt(9), tomorrowAt(14)] });
    expect(created.status).toBe(201);
    expect(created.body.shows).toHaveLength(2);
    const seats = await prisma.showSeat.findMany({ where: { showId: created.body.shows[0].id } });
    expect(seats).toHaveLength(10);
    expect(new Set(seats.map((s) => Number(s.price)))).toEqual(new Set([1000, 1500]));

    // 120 min movie + 15 min turnaround: 11:00 overlaps the 09:00 show
    const clash = await admin.post('/api/admin/shows', { movieId: f.movie.id, screenId: f.screen.id, language: 'English', startTimes: [tomorrowAt(11)] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SHOW_OVERLAP');

    const ok = await admin.post('/api/admin/shows', { movieId: f.movie.id, screenId: f.screen.id, language: 'English', startTimes: [tomorrowAt(11, 15)] });
    expect(ok.status).toBe(201);
  });

  it('refuses to schedule when a seat category has no price', async () => {
    const f = await createFixture();
    await prisma.priceRule.deleteMany({ where: { cinemaId: f.cinema.id, category: 'PREMIUM' } });
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    const res = await admin.post('/api/admin/shows', { movieId: f.movie.id, screenId: f.screen.id, language: 'English', startTimes: [tomorrowAt(9)] });
    expect(res.body.error.code).toBe('NO_PRICE');
  });

  it('cancelling a show cancels and fully refunds its bookings', async () => {
    const f = await createFixture({ startsInMinutes: 60 });
    const c = await loginAs();
    const booking = await bookAndPay(c.agent, f.show.id, [f.seats[0].id]);
    const { agent: admin } = await loginAs({ role: 'CINEMA_ADMIN', cinemaId: f.cinema.id });
    const res = await admin.post(`/api/admin/shows/${f.show.id}/cancel`);
    expect(res.body.bookingsCancelled).toBe(1);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('REFUNDED');
    expect(Number(b.refundAmount)).toBe(1000);
  });
});

describe('screens, bookings search, reports, staff', () => {
  it('blocks seat layout changes while shows are scheduled', async () => {
    const f = await createFixture();
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    const res = await admin.put(`/api/admin/screens/${f.screen.id}`, {
      name: 'Screen 1',
      format: 'TWO_D',
      gridRows: 1,
      gridCols: 2,
      seats: [
        { gridRow: 0, gridCol: 0, rowLabel: 'A', seatNumber: 1, category: 'STANDARD' },
        { gridRow: 0, gridCol: 1, rowLabel: 'A', seatNumber: 2, category: 'STANDARD' },
      ],
    });
    expect(res.body.error.code).toBe('SCREEN_IN_USE');
  });

  it('creates a screen from a layout and validates duplicates', async () => {
    const f = await createFixture();
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    const dup = await admin.post(`/api/admin/cinemas/${f.cinema.id}/screens`, {
      name: 'Screen 9', format: 'IMAX', gridRows: 1, gridCols: 2,
      seats: [
        { gridRow: 0, gridCol: 0, rowLabel: 'A', seatNumber: 1, category: 'STANDARD' },
        { gridRow: 0, gridCol: 1, rowLabel: 'A', seatNumber: 1, category: 'STANDARD' },
      ],
    });
    expect(dup.status).toBe(400);
    const ok = await admin.post(`/api/admin/cinemas/${f.cinema.id}/screens`, {
      name: 'Screen 9', format: 'IMAX', gridRows: 1, gridCols: 2,
      seats: [
        { gridRow: 0, gridCol: 0, rowLabel: 'A', seatNumber: 1, category: 'STANDARD' },
        { gridRow: 0, gridCol: 1, rowLabel: 'A', seatNumber: 2, category: 'RECLINER' },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.screen.seats).toHaveLength(2);
  });

  it('finds bookings by reference, email or phone (FR-9.5) and reports sales (FR-9.7)', async () => {
    const f = await createFixture();
    const c = await loginAs();
    const booking = await bookAndPay(c.agent, f.show.id, [f.seats[0].id, f.seats[5].id]);
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    for (const q of [booking.reference, c.user.email, c.user.phone]) {
      const r = await admin.get(`/api/admin/bookings?q=${encodeURIComponent(q)}`);
      expect(r.body.bookings.map((b: { id: string }) => b.id)).toContain(booking.id);
    }
    const d = f.show.startTime;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const report = await admin.get(`/api/admin/reports?from=${key}&to=${key}&groupBy=movie`);
    expect(report.body.totals).toMatchObject({ bookings: 1, tickets: 2, capacity: 10, grossCents: 250000, occupancyPct: 20 });
    const csv = await admin.get(`/api/admin/reports?from=${key}&to=${key}&groupBy=show&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')).toHaveLength(3);
    const pdf = await admin.get(`/api/admin/reports?from=${key}&to=${key}&format=pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('lets a super admin create staff (FR-9.8) and logs it (NFR-17)', async () => {
    const f = await createFixture();
    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    const res = await admin.post('/api/admin/staff', { name: 'Gate One', email: 'gate1@test.local', phone: '0779998888', password: 'checker123', role: 'TICKET_CHECKER', cinemaId: f.cinema.id });
    expect(res.status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'admin.staff.create' } })).toBe(1);
    const missingCinema = await admin.post('/api/admin/staff', { name: 'Gate Two', email: 'gate2@test.local', phone: '0779998887', password: 'checker123', role: 'CINEMA_ADMIN' });
    expect(missingCinema.status).toBe(400);
  });
});
