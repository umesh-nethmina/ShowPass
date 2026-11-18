import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { GatewayEvent, PaymentGateway } from './gateway.js';

/** Signature the mock gateway puts on its webhook calls. */
export function mockSignature(paymentId: string, outcome: string, amountCents: number) {
  return crypto.createHmac('sha256', env.MOCK_GATEWAY_SECRET).update(`${paymentId}:${outcome}:${amountCents}`).digest('hex');
}

/**
 * Development/test gateway. The checkout page lives in the web app (/mock-gateway/:paymentId)
 * and lets you choose success or failure; the API then receives a signed webhook just like a real gateway.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock';

  async createCheckout(input: { paymentId: string }) {
    return { type: 'redirect' as const, url: `${env.WEB_ORIGIN}/mock-gateway/${input.paymentId}` };
  }

  async parseWebhook(req: Request): Promise<GatewayEvent> {
    const { paymentId, outcome, amountCents, signature, method } = req.body ?? {};
    if (typeof paymentId !== 'string' || !['SUCCESS', 'FAILED'].includes(outcome) || typeof amountCents !== 'number') {
      throw new AppError(400, 'BAD_WEBHOOK', 'Malformed webhook');
    }
    const expected = mockSignature(paymentId, outcome, amountCents);
    const given = Buffer.from(String(signature ?? ''));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, Buffer.from(expected))) {
      throw new AppError(401, 'BAD_SIGNATURE', 'Invalid webhook signature');
    }
    return {
      paymentId,
      outcome,
      amountCents,
      gatewayRef: `MOCK-${paymentId}`,
      method: typeof method === 'string' ? method : 'CARD',
      reason: outcome === 'FAILED' ? 'Declined by mock gateway' : undefined,
    };
  }

  async lookup() {
    return null;
  }

  async refund(input: { paymentId: string }) {
    return { refundRef: `MOCKREF-${input.paymentId}-${Date.now()}` };
  }
}
