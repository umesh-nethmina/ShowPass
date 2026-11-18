import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { sentEmails } from '../src/modules/notifications/email.js';
import { createFixture, loginAs, resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  sentEmails.length = 0;
});

async function setup() {
  const f = await createFixture();
  const other = await createFixture();
  const combo = await prisma.concession.create({ data: { name: 'Popcorn combo', price: 1500 } }); // every cinema
  const local = await prisma.concession.create({ data: { name: 'Local snack', price: 400, cinemaId: f.cinema.id } });
  const elsewhere = await prisma.concession.create({ data: { name: 'Other cinema snack', price: 300, cinemaId: other.cinema.id } });
  await prisma.concession.create({ data: { name: 'Retired item', price: 100, isActive: false } });
  return { f, combo, local, elsewhere };
}

describe('food & drinks (FR-5.5)', () => {
  it('adds combos to a booking, keeps the promo on tickets only, and shows them on the ticket', async () => {
    const { f, combo, local } = await setup();
    await prisma.promoCode.create({ data: { code: 'HALF', type: 'PERCENT', value: 50, validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 86_400_000) } });
    const { agent: a, user } = await loginAs();
    const hold = await a.post(`/api/shows/${f.show.id}/holds`, { seatIds: [f.seats[0].id] });
    const id = hold.body.booking.id;

    const menu = await a.get(`/api/bookings/${id}/concessions`);
    expect(menu.body.concessions.map((c: { name: string }) => c.name).sort()).toEqual(['Local snack', 'Popcorn combo']);

    const withFood = await a.put(`/api/bookings/${id}/items`, { items: [{ concessionId: combo.id, quantity: 2 }, { concessionId: local.id, quantity: 1 }] });
    expect(withFood.status).toBe(200);
    expect(withFood.body.booking.itemsCents).toBe(340000);
    expect(withFood.body.booking.totalCents).toBe(100000 + 340000);

    const promo = await a.post(`/api/bookings/${id}/promo`, { code: 'HALF' });
    expect(promo.body.booking.discountCents).toBe(50000); // 50% of the 1,000 ticket, not of the food
    expect(promo.body.booking.totalCents).toBe(50000 + 340000);

    // Changing quantities keeps the promo; quantity 0 removes a line
    const changed = await a.put(`/api/bookings/${id}/items`, { items: [{ concessionId: combo.id, quantity: 1 }, { concessionId: local.id, quantity: 0 }] });
    expect(changed.body.booking.items).toEqual([{ concessionId: combo.id, name: 'Popcorn combo', unitPriceCents: 150000, quantity: 1 }]);
    expect(changed.body.booking.totalCents).toBe(50000 + 150000);

    const pay = await a.post(`/api/bookings/${id}/pay`);
    expect((await a.post(`/api/payments/mock/${pay.body.paymentId}/complete`, { outcome: 'SUCCESS' })).body.status).toBe('SUCCESS');
    const booking = (await a.get(`/api/bookings/${id}`)).body.booking;
    expect(booking.status).toBe('CONFIRMED');
    await new Promise((r) => setTimeout(r, 300));
    expect(sentEmails.find((m) => m.to === user.email && m.subject.includes(booking.reference))?.text).toBeDefined();
    expect(sentEmails.find((m) => m.to === user.email && m.subject.includes(booking.reference))?.html).toContain('1× Popcorn combo');

    const { agent: checker } = await loginAs({ role: 'TICKET_CHECKER', cinemaId: f.cinema.id });
    const scan = await checker.post('/api/checker/scan', { code: `SHOWPASS:${booking.qrToken}` });
    expect(scan.body.booking.items).toEqual(['1× Popcorn combo']);

    // Items cannot change after payment
    expect((await a.put(`/api/bookings/${id}/items`, { items: [] })).status).toBe(400);
  });

  it('rejects items from another cinema, inactive items and silly quantities', async () => {
    const { f, combo, elsewhere } = await setup();
    const { agent: a } = await loginAs();
    const hold = await a.post(`/api/shows/${f.show.id}/holds`, { seatIds: [f.seats[0].id] });
    const id = hold.body.booking.id;
    const retired = await prisma.concession.findFirstOrThrow({ where: { isActive: false } });
    expect((await a.put(`/api/bookings/${id}/items`, { items: [{ concessionId: elsewhere.id, quantity: 1 }] })).body.error.code).toBe('ITEM_UNAVAILABLE');
    expect((await a.put(`/api/bookings/${id}/items`, { items: [{ concessionId: retired.id, quantity: 1 }] })).body.error.code).toBe('ITEM_UNAVAILABLE');
    expect((await a.put(`/api/bookings/${id}/items`, { items: [{ concessionId: combo.id, quantity: 11 }] })).body.error.code).toBe('TOO_MANY_ITEMS');
  });

  it('lets cinema admins manage only their own items', async () => {
    const { f } = await setup();
    const { agent: manager } = await loginAs({ role: 'CINEMA_ADMIN', cinemaId: f.cinema.id });
    const global = await manager.post('/api/admin/concessions', { cinemaId: null, name: 'Global thing', price: 500 });
    expect(global.status).toBe(403);
    const own = await manager.post('/api/admin/concessions', { cinemaId: f.cinema.id, name: 'Our samosa', price: 300 });
    expect(own.status).toBe(201);
    const list = await manager.get('/api/admin/concessions');
    expect(list.body.concessions.map((c: { name: string }) => c.name)).not.toContain('Other cinema snack');

    const { agent: admin } = await loginAs({ role: 'SUPER_ADMIN' });
    expect((await admin.post('/api/admin/concessions', { cinemaId: null, name: 'Global thing', price: 500 })).status).toBe(201);
  });
});
