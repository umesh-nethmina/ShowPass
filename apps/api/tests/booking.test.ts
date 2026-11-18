import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { sentEmails, type EmailMessage } from '../src/modules/notifications/email.js';
import { sentSms } from '../src/modules/notifications/sms.js';
import { expireLapsedHolds } from '../src/modules/bookings/booking.service.js';
import { handleGatewayEvent, reconcilePayments } from '../src/modules/payments/payment.service.js';
import { agent, bookAndPay, createFixture, loginAs, resetDb } from './helpers.js';

const waitFor = async <T>(fn: () => T | undefined, ms = 3000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeEach(async () => {
  await resetDb();
  sentEmails.length = 0;
  sentSms.length = 0;
});

describe('registration and verification (FR-1.1 – FR-1.4)', () => {
  it('registers, blocks booking until verified, then verifies with the emailed code', async () => {
    const { show, seats } = await createFixture();
    const a = agent();
    const reg = await a.post('/api/auth/register', { name: 'Nimal Perera', email: 'nimal@test.local', phone: '0771234567', password: 'secret123' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.phone).toBe('+94771234567');
    expect(reg.body.user.verified).toBe(false);

    const blocked = await a.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('VERIFICATION_REQUIRED');

    const mail = await waitFor(() => sentEmails.find((m: EmailMessage) => m.to === 'nimal@test.local'));
    const code = mail.text.match(/\b(\d{6})\b/)![1];
    const wrong = await a.post('/api/auth/verify/confirm', { channel: 'email', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await a.post('/api/auth/verify/confirm', { channel: 'email', code });
    expect(ok.body.user.verified).toBe(true);

    const hold = await a.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    expect(hold.status).toBe(201);
  });

  it('rejects duplicate accounts and wrong passwords', async () => {
    const a = agent();
    await a.post('/api/auth/register', { name: 'A B', email: 'dup@test.local', phone: '0770000099', password: 'secret123' });
    const dup = await agent().post('/api/auth/register', { name: 'A B', email: 'dup@test.local', phone: '0770000098', password: 'secret123' });
    expect(dup.status).toBe(409);
    const bad = await agent().post('/api/auth/login', { identifier: 'dup@test.local', password: 'nope12345' });
    expect(bad.status).toBe(401);
    const byPhone = await agent().post('/api/auth/login', { identifier: '077 000 0099', password: 'secret123' });
    expect(byPhone.status).toBe(200);
  });

  it('resets a password with an SMS code', async () => {
    const a = agent();
    await a.post('/api/auth/register', { name: 'Reset Me', email: 'reset@test.local', phone: '0771112222', password: 'secret123' });
    await agent().post('/api/auth/password/forgot', { identifier: '0771112222' });
    const sms = await waitFor(() => sentSms.find((s) => s.to === '+94771112222' && s.text.includes('reset')));
    const code = sms.text.match(/\b(\d{6})\b/)![1];
    const r = await agent().post('/api/auth/password/reset', { identifier: '0771112222', code, password: 'newpass123' });
    expect(r.status).toBe(200);
    expect(r.body.user.phoneVerified).toBe(true);
    expect((await agent().post('/api/auth/login', { identifier: 'reset@test.local', password: 'newpass123' })).status).toBe(200);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const { app } = await import('./helpers.js');
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/auth/login').send({ identifier: 'x@y.z', password: 'whatever' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });
});

describe('seat holds (FR-4.x, NFR-4)', () => {
  it('never sells the same seat twice under concurrent requests', async () => {
    const { show, seats } = await createFixture();
    const customers = await Promise.all(Array.from({ length: 8 }, () => loginAs()));
    const results = await Promise.all(customers.map((c) => c.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id, seats[1].id] })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const held = await prisma.showSeat.findMany({ where: { showId: show.id, status: 'HELD' } });
    expect(held).toHaveLength(2);
    expect(new Set(held.map((h) => h.bookingId)).size).toBe(1);
  });

  it('rejects a partially taken selection atomically', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const b = await loginAs();
    expect((await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[1].id] })).status).toBe(201);
    const res = await b.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id, seats[1].id] });
    expect(res.status).toBe(409);
    expect(res.body.error.details.seatIds).toEqual([seats[1].id]);
    const seat0 = await prisma.showSeat.findFirstOrThrow({ where: { showId: show.id, seatId: seats[0].id } });
    expect(seat0.status).toBe('AVAILABLE');
  });

  it('enforces the max seats per booking', async () => {
    const { show, seats } = await createFixture();
    await prisma.setting.create({ data: { key: 'maxSeatsPerBooking', value: 2 } });
    const { clearSettingsCache } = await import('../src/modules/settings/settings.service.js');
    clearSettingsCache();
    const a = await loginAs();
    const res = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: seats.slice(0, 3).map((s) => s.id) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_SEATS');
  });

  it('computes the booking summary and applies a promo code', async () => {
    const { show, seats } = await createFixture();
    await prisma.promoCode.create({
      data: { code: 'TEN', type: 'PERCENT', value: 10, validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 86_400_000) },
    });
    const a = await loginAs();
    const hold = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id, seats[5].id] });
    expect(hold.body.booking.subtotalCents).toBe(250000);
    expect(hold.body.booking.seats.map((s: { label: string }) => s.label)).toEqual(['A1', 'B1']);
    const promo = await a.agent.post(`/api/bookings/${hold.body.booking.id}/promo`, { code: 'ten' });
    expect(promo.status).toBe(200);
    expect(promo.body.booking.discountCents).toBe(25000);
    expect(promo.body.booking.totalCents).toBe(225000);
    const bad = await a.agent.post(`/api/bookings/${hold.body.booking.id}/promo`, { code: 'NOPE' });
    expect(bad.body.error.code).toBe('PROMO_INVALID');
  });

  it('releases seats when a hold lapses (FR-4.6)', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const hold = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    await prisma.booking.update({ where: { id: hold.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.showSeat.updateMany({ where: { bookingId: hold.body.booking.id }, data: { heldUntil: new Date(Date.now() - 1000) } });

    // Even before the sweeper runs, another customer can take the lapsed seat.
    const b = await loginAs();
    expect((await b.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] })).status).toBe(201);
    expect(await expireLapsedHolds()).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.booking.id } })).status).toBe('EXPIRED');
    // The sweeper must not free the seat now held by the second customer.
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId: show.id, seatId: seats[0].id } })).status).toBe('HELD');

    const pay = await a.agent.post(`/api/bookings/${hold.body.booking.id}/pay`);
    expect(pay.status).toBe(400);
  });

  it('closes booking after the show cut-off (FR-3.3)', async () => {
    const { show, seats } = await createFixture({ startsInMinutes: -5 });
    const a = await loginAs();
    const res = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    expect(res.body.error.code).toBe('BOOKING_CLOSED');
  });
});

describe('payment and tickets (FR-5.x, FR-6.x, FR-8.x)', () => {
  it('confirms only after the gateway confirms, then issues the e-ticket', async () => {
    const { show, seats, cinema } = await createFixture();
    const { agent: a, user } = await loginAs();
    const hold = await a.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.post(`/api/bookings/${hold.body.booking.id}/pay`);
    expect(pay.body.checkout.type).toBe('redirect');
    expect((await a.get(`/api/bookings/${hold.body.booking.id}`)).body.booking.status).toBe('PENDING');

    await a.post(`/api/payments/mock/${pay.body.paymentId}/complete`, { outcome: 'SUCCESS' });
    const booking = (await a.get(`/api/bookings/${hold.body.booking.id}`)).body.booking;
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.qrToken).toBeTruthy();
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId: show.id, seatId: seats[0].id } })).status).toBe('BOOKED');

    const mail = await waitFor(() => sentEmails.find((m) => m.to === user.email && m.subject.includes(booking.reference)));
    expect(mail.attachments?.[0].filename).toMatch(/\.pdf$/);
    await waitFor(() => sentSms.find((s) => s.text.includes(booking.reference)));

    const pdf = await a.get(`/api/bookings/${booking.id}/ticket.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    // Idempotent webhook replay
    const again = await handleGatewayEvent({ paymentId: pay.body.paymentId, outcome: 'SUCCESS', amountCents: 100000 });
    expect(again.status).toBe('SUCCESS');

    // Ticket validation at the gate
    const { agent: checker } = await loginAs({ role: 'TICKET_CHECKER', cinemaId: cinema.id });
    const first = await checker.post('/api/checker/scan', { code: `SHOWPASS:${booking.qrToken}`, showId: show.id });
    expect(first.body.result).toBe('VALID');
    const second = await checker.post('/api/checker/scan', { code: `SHOWPASS:${booking.qrToken}`, showId: show.id });
    expect(second.body.result).toBe('ALREADY_USED');
    const unknown = await checker.post('/api/checker/scan', { code: 'SHOWPASS:nope-nope' });
    expect(unknown.body.result).toBe('NOT_FOUND');
  });

  it('rejects a forged webhook', async () => {
    const res = await agent().post('/api/payments/webhook/mock', { paymentId: 'x', outcome: 'SUCCESS', amountCents: 1, signature: 'bad' });
    expect(res.status).toBe(401);
  });

  it('accepts gateway webhooks without the browser CSRF header', async () => {
    const { app } = await import('./helpers.js');
    const { default: request } = await import('supertest');
    const { mockSignature } = await import('../src/modules/payments/mock.gateway.js');
    const { show, seats } = await createFixture();
    const { agent: a } = await loginAs();
    const hold = await a.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.post(`/api/bookings/${hold.body.booking.id}/pay`);
    const body = { paymentId: pay.body.paymentId, outcome: 'SUCCESS', amountCents: 100000, signature: mockSignature(pay.body.paymentId, 'SUCCESS', 100000) };
    const res = await request(app).post('/api/payments/webhook/mock').send(body);
    expect(res.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.booking.id } })).status).toBe('CONFIRMED');
  });

  it('releases seats when payment fails (FR-5.6)', async () => {
    const { show, seats } = await createFixture();
    const { agent: a } = await loginAs();
    const hold = await a.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.post(`/api/bookings/${hold.body.booking.id}/pay`);
    await a.post(`/api/payments/mock/${pay.body.paymentId}/complete`, { outcome: 'FAILED' });
    expect((await a.get(`/api/bookings/${hold.body.booking.id}`)).body.booking.status).toBe('FAILED');
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId: show.id, seatId: seats[0].id } })).status).toBe('AVAILABLE');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } })).status).toBe('FAILED');
  });

  it('refunds a late payment whose seats were resold (NFR-6)', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const hold = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.agent.post(`/api/bookings/${hold.body.booking.id}/pay`);
    await prisma.showSeat.updateMany({ where: { bookingId: hold.body.booking.id }, data: { heldUntil: new Date(Date.now() - 1000) } });
    await prisma.booking.update({ where: { id: hold.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const b = await loginAs();
    await bookAndPay(b.agent, show.id, [seats[0].id]);

    const r = await handleGatewayEvent({ paymentId: pay.body.paymentId, outcome: 'SUCCESS', amountCents: 100000, gatewayRef: 'G1' });
    expect(r.status).toBe('REFUNDED');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    expect(payment.status).toBe('REFUNDED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.booking.id } })).status).toBe('FAILED');
  });

  it('confirms a late payment if the seats are still free', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const hold = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.agent.post(`/api/bookings/${hold.body.booking.id}/pay`);
    await prisma.booking.update({ where: { id: hold.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await expireLapsedHolds();
    const r = await handleGatewayEvent({ paymentId: pay.body.paymentId, outcome: 'SUCCESS', amountCents: 100000 });
    expect(r.status).toBe('SUCCESS');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.booking.id } })).status).toBe('CONFIRMED');
  });

  it('records abandoned payments during reconciliation', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const hold = await a.agent.post(`/api/shows/${show.id}/holds`, { seatIds: [seats[0].id] });
    const pay = await a.agent.post(`/api/bookings/${hold.body.booking.id}/pay`);
    await prisma.payment.update({ where: { id: pay.body.paymentId }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    await reconcilePayments();
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    expect(p.status).toBe('FAILED');
    expect(p.failReason).toMatch(/Abandoned/);
  });
});

describe('cancellation (FR-7.x)', () => {
  it('refunds by policy and frees the seats immediately', async () => {
    const { show, seats } = await createFixture({ startsInMinutes: 10 * 60 }); // 10h before → 50%
    const a = await loginAs();
    const booking = await bookAndPay(a.agent, show.id, [seats[0].id]);
    expect(booking.cancellation).toMatchObject({ allowed: true, refundPercent: 50, refundCents: 50000 });
    const res = await a.agent.post(`/api/bookings/${booking.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('REFUNDED');
    expect(res.body.booking.refundCents).toBe(50000);
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId: show.id, seatId: seats[0].id } })).status).toBe('AVAILABLE');

    const again = await a.agent.post(`/api/bookings/${booking.id}/cancel`);
    expect(again.status).toBe(400);
  });

  it('blocks cancellation inside the cut-off', async () => {
    const { show, seats } = await createFixture({ startsInMinutes: 60 });
    const a = await loginAs();
    const booking = await bookAndPay(a.agent, show.id, [seats[0].id]);
    const res = await a.agent.post(`/api/bookings/${booking.id}/cancel`);
    expect(res.body.error.code).toBe('CANCEL_NOT_ALLOWED');
  });

  it('does not let one customer see or cancel another customer\'s booking', async () => {
    const { show, seats } = await createFixture();
    const a = await loginAs();
    const booking = await bookAndPay(a.agent, show.id, [seats[0].id]);
    const b = await loginAs();
    expect((await b.agent.get(`/api/bookings/${booking.id}`)).status).toBe(403);
    expect((await b.agent.post(`/api/bookings/${booking.id}/cancel`)).status).toBe(403);
  });
});
