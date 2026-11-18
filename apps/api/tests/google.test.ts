import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

type Helpers = typeof import('./helpers.js');
let h: Helpers;
let google: typeof import('../src/modules/auth/google.js');
let prisma: typeof import('../src/lib/prisma.js')['prisma'];
let sentSms: typeof import('../src/modules/notifications/sms.js')['sentSms'];

beforeAll(async () => {
  h = await import('./helpers.js');
  google = await import('../src/modules/auth/google.js');
  prisma = (await import('../src/lib/prisma.js')).prisma;
  sentSms = (await import('../src/modules/notifications/sms.js')).sentSms;
});
beforeEach(async () => {
  await h.resetDb();
  sentSms.length = 0;
});
afterEach(() => vi.restoreAllMocks());

const identity = (over: Partial<{ sub: string; email: string; emailVerified: boolean; name: string }> = {}) => ({
  sub: 'google-sub-1',
  email: 'kamal@gmail.com',
  emailVerified: true,
  name: 'Kamal Silva',
  ...over,
});
const TOKEN = 'x'.repeat(40);

describe('Google sign-in (FR-1.6)', () => {
  it('exposes the client ID and creates a verified customer on first sign-in', async () => {
    const a = h.agent();
    expect((await a.get('/api/auth/config')).body.googleClientId).toBe(process.env.GOOGLE_CLIENT_ID);

    vi.spyOn(google.googleVerifier, 'verify').mockResolvedValue(identity());
    const first = await a.post('/api/auth/google', { credential: TOKEN });
    expect(first.status).toBe(201);
    expect(first.body.user).toMatchObject({ email: 'kamal@gmail.com', verified: true, phone: null, role: 'CUSTOMER' });
    const me = await a.get('/api/auth/me');
    expect(me.body.user.hasPassword).toBe(false);

    const again = await h.agent().post('/api/auth/google', { credential: TOKEN });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it('links an existing customer account with the same email, but never a staff account', async () => {
    const { user } = await h.createUser({ verified: false });
    vi.spyOn(google.googleVerifier, 'verify').mockResolvedValue(identity({ email: user.email }));
    const res = await h.agent().post('/api/auth/google', { credential: TOKEN });
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.emailVerified).toBe(true);

    const { user: staff } = await h.createUser({ role: 'SUPER_ADMIN' });
    vi.spyOn(google.googleVerifier, 'verify').mockResolvedValue(identity({ sub: 'other', email: staff.email }));
    expect((await h.agent().post('/api/auth/google', { credential: TOKEN })).status).toBe(401);
  });

  it('rejects invalid tokens and unverified Google emails', async () => {
    vi.spyOn(google.googleVerifier, 'verify').mockRejectedValue(new Error('bad token'));
    expect((await h.agent().post('/api/auth/google', { credential: TOKEN })).status).toBe(401);
    vi.spyOn(google.googleVerifier, 'verify').mockResolvedValue(identity({ emailVerified: false }));
    expect((await h.agent().post('/api/auth/google', { credential: TOKEN })).status).toBe(401);
  });

  it('lets a Google-only customer book without a phone (no SMS) and set a password later', async () => {
    vi.spyOn(google.googleVerifier, 'verify').mockResolvedValue(identity());
    const a = h.agent();
    await a.post('/api/auth/google', { credential: TOKEN });
    const f = await h.createFixture();
    const booking = await h.bookAndPay(a, f.show.id, [f.seats[0].id]);
    expect(booking.status).toBe('CONFIRMED');
    expect(sentSms).toHaveLength(0);

    const sms = await a.post('/api/auth/verify/request', { channel: 'sms' });
    expect(sms.body.error.code).toBe('NO_PHONE');

    const pwLogin = await h.agent().post('/api/auth/login', { identifier: 'kamal@gmail.com', password: 'whatever1' });
    expect(pwLogin.body.error.message).toMatch(/Google/);
    expect((await a.post('/api/auth/password/change', { newPassword: 'newpass123' })).status).toBe(204);
    expect((await h.agent().post('/api/auth/login', { identifier: 'kamal@gmail.com', password: 'newpass123' })).status).toBe(200);
    // Once a password exists, changing it requires the current one.
    expect((await a.post('/api/auth/password/change', { newPassword: 'another123' })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.google.register' } })).toBe(1);
  });
});
