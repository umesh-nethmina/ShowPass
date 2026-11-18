import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

// Configure credentials before the env module is loaded (each test file has its own module registry).
process.env.PAYHERE_MERCHANT_ID = '1211149';
process.env.PAYHERE_MERCHANT_SECRET = 'merchant-secret';
process.env.PAYHERE_APP_ID = 'app-id';
process.env.PAYHERE_APP_SECRET = 'app-secret';

type Mod = typeof import('../src/modules/payments/payhere.gateway.js');
let mod: Mod;
beforeAll(async () => {
  mod = await import('../src/modules/payments/payhere.gateway.js');
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PayHere gateway', () => {
  it('builds a signed checkout form', async () => {
    const gw = new mod.PayHereGateway();
    const c = await gw.createCheckout({ paymentId: 'pay_1', bookingReference: 'SP-1', amountCents: 250000, currency: 'LKR', description: 'Tickets', customer: { name: 'Nimal Perera', email: 'n@x.lk', phone: '+94771234567' } });
    expect(c.type).toBe('form');
    expect(c.fields.amount).toBe('2500.00');
    expect(c.fields.order_id).toBe('pay_1');
    expect(c.fields.hash).toBe(mod.payhereCheckoutHash('1211149', 'pay_1', 250000, 'LKR', 'merchant-secret'));
    expect(c.fields.notify_url).toMatch(/\/api\/payments\/webhook\/payhere$/);
  });

  it('verifies notify signatures', async () => {
    const gw = new mod.PayHereGateway();
    const body = { merchant_id: '1211149', order_id: 'pay_1', payment_id: '320025', payhere_amount: '2500.00', payhere_currency: 'LKR', status_code: '2', method: 'VISA' };
    const md5sig = mod.payhereNotifySig(body.merchant_id, body.order_id, body.payhere_amount, body.payhere_currency, body.status_code, 'merchant-secret');
    const ev = await gw.parseWebhook({ body: { ...body, md5sig } } as Request);
    expect(ev).toMatchObject({ paymentId: 'pay_1', outcome: 'SUCCESS', gatewayRef: '320025', amountCents: 250000, method: 'VISA' });
    await expect(gw.parseWebhook({ body: { ...body, status_code: '-2', md5sig } } as Request)).rejects.toThrow(/signature/i);
    const failSig = mod.payhereNotifySig(body.merchant_id, body.order_id, body.payhere_amount, body.payhere_currency, '-1', 'merchant-secret');
    expect((await gw.parseWebhook({ body: { ...body, status_code: '-1', md5sig: failSig } } as Request)).outcome).toBe('FAILED');
  });

  it('looks up payment status through the Merchant API', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/oauth/token')) return json({ access_token: 'tok', expires_in: 600 });
      return json({ status: 1, data: [{ payment_id: 320025, status: 'RECEIVED', amount: 2500, currency: 'LKR', method: 'VISA' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const gw = new mod.PayHereGateway();
    const ev = await gw.lookup('pay_1');
    expect(ev).toMatchObject({ outcome: 'SUCCESS', gatewayRef: '320025', amountCents: 250000 });
    expect(fetchMock.mock.calls[1][0]).toContain('/merchant/v1/payment/search?order_id=pay_1');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    await gw.lookup('pay_2');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/oauth/token'))).toHaveLength(1); // token cached
  });

  it('sends refunds through the Merchant API and surfaces rejections', async () => {
    const calls: { url: string; body?: string }[] = [];
    let reply: unknown = { status: 1, msg: 'Successfully processed', data: 'RF-99' };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string });
      return url.endsWith('/oauth/token') ? json({ access_token: 'tok' }) : json(reply);
    });
    const gw = new mod.PayHereGateway();
    expect(await gw.refund({ paymentId: 'pay_1', gatewayRef: '320025', amountCents: 125050, reason: 'Customer cancellation' })).toEqual({ refundRef: 'RF-99' });
    expect(JSON.parse(calls[1].body!)).toEqual({ payment_id: '320025', description: 'Customer cancellation', amount: 1250.5 });
    reply = { status: -1, msg: 'Refund amount exceeds' };
    await expect(gw.refund({ paymentId: 'pay_1', gatewayRef: '320025', amountCents: 1, reason: 'x' })).rejects.toThrow(/Refund amount exceeds/);
  });
});
