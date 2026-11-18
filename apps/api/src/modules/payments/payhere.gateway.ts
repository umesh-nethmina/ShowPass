import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { CheckoutInput, GatewayEvent, PaymentGateway } from './gateway.js';

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
const amountStr = (cents: number) => (cents / 100).toFixed(2);

/** PayHere checkout hash: MD5(merchant_id + order_id + amount + currency + MD5(secret)), upper-case hex. */
export function payhereCheckoutHash(merchantId: string, orderId: string, amountCents: number, currency: string, secret: string) {
  return md5(merchantId + orderId + amountStr(amountCents) + currency + md5(secret));
}

/** PayHere notify signature: MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + MD5(secret)). */
export function payhereNotifySig(
  merchantId: string,
  orderId: string,
  amount: string,
  currency: string,
  statusCode: string,
  secret: string,
) {
  return md5(merchantId + orderId + amount + currency + statusCode + md5(secret));
}

/**
 * PayHere hosted checkout (https://support.payhere.lk/api-&-mobile-sdk/checkout-api).
 * order_id is our Payment.id. The notify_url receives a form-encoded server-to-server callback.
 * status_code: 2 = success, 0 = pending, -1 = cancelled, -2 = failed, -3 = charged back.
 */
export class PayHereGateway implements PaymentGateway {
  readonly name = 'payhere';
  private base = env.PAYHERE_SANDBOX ? 'https://sandbox.payhere.lk' : 'https://www.payhere.lk';

  private creds() {
    if (!env.PAYHERE_MERCHANT_ID || !env.PAYHERE_MERCHANT_SECRET) throw new Error('PayHere credentials are not configured');
    return { merchantId: env.PAYHERE_MERCHANT_ID, secret: env.PAYHERE_MERCHANT_SECRET };
  }

  async createCheckout(input: CheckoutInput) {
    const { merchantId, secret } = this.creds();
    const [first, ...rest] = input.customer.name.split(' ');
    return {
      type: 'form' as const,
      action: `${this.base}/pay/checkout`,
      fields: {
        merchant_id: merchantId,
        return_url: `${env.WEB_ORIGIN}/payment/result?payment=${input.paymentId}`,
        cancel_url: `${env.WEB_ORIGIN}/payment/result?payment=${input.paymentId}&cancelled=1`,
        notify_url: `${env.PUBLIC_API_URL}/api/payments/webhook/payhere`,
        order_id: input.paymentId,
        items: input.description,
        currency: input.currency,
        amount: amountStr(input.amountCents),
        first_name: first ?? '',
        last_name: rest.join(' ') || '-',
        email: input.customer.email,
        phone: input.customer.phone,
        address: '-',
        city: 'Colombo',
        country: 'Sri Lanka',
        custom_1: input.bookingReference,
        hash: payhereCheckoutHash(merchantId, input.paymentId, input.amountCents, input.currency, secret),
      },
    };
  }

  async parseWebhook(req: Request): Promise<GatewayEvent> {
    const { merchantId, secret } = this.creds();
    const b = req.body ?? {};
    const expected = payhereNotifySig(b.merchant_id, b.order_id, b.payhere_amount, b.payhere_currency, b.status_code, secret);
    if (b.merchant_id !== merchantId || typeof b.md5sig !== 'string' || b.md5sig.toUpperCase() !== expected) {
      throw new AppError(401, 'BAD_SIGNATURE', 'Invalid PayHere signature');
    }
    const code = String(b.status_code);
    return {
      paymentId: b.order_id,
      outcome: code === '2' ? 'SUCCESS' : code === '0' ? 'PENDING' : 'FAILED',
      gatewayRef: b.payment_id,
      amountCents: Math.round(Number(b.payhere_amount) * 100),
      currency: b.payhere_currency,
      method: b.method,
      reason: code === '-1' ? 'Cancelled by customer' : code === '-3' ? 'Charged back' : b.status_message,
    };
  }

  /* ---------- Merchant API (status lookup + refunds) ----------
   * Uses PayHere's Merchant API with OAuth client credentials (App ID / App Secret created in the
   * PayHere portal under Integrations → API Keys, separate from the checkout merchant secret).
   * Without those credentials, lookups return null (reconciliation relies on webhooks) and refunds are
   * recorded as MANUAL-… so staff can process them in the merchant portal.
   */
  private token: { value: string; expiresAt: number } | null = null;

  private hasApiCreds() {
    return Boolean(env.PAYHERE_APP_ID && env.PAYHERE_APP_SECRET);
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${env.PAYHERE_APP_ID}:${env.PAYHERE_APP_SECRET}`).toString('base64');
    const res = await fetch(`${this.base}/merchant/v1/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayHere OAuth failed with ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}/merchant/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) throw new Error(`PayHere API ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  /** Looks up a payment by our order_id (= Payment.id). Null when unknown or not configured. */
  async lookup(paymentId: string): Promise<GatewayEvent | null> {
    if (!this.hasApiCreds()) return null;
    const r = await this.api<{ status: number; data?: { payment_id: number | string; status: string; amount: number; currency: string; method?: string }[] }>(
      `/payment/search?order_id=${encodeURIComponent(paymentId)}`,
    );
    const p = r.status === 1 ? r.data?.[0] : undefined;
    if (!p) return null;
    const s = p.status.toUpperCase();
    const outcome: GatewayEvent['outcome'] = s === 'RECEIVED' || s.startsWith('REFUND') ? 'SUCCESS' : s === 'FAILED' || s === 'CHARGEBACKED' || s === 'CANCELLED' ? 'FAILED' : 'PENDING';
    return { paymentId, outcome, gatewayRef: String(p.payment_id), amountCents: Math.round(Number(p.amount) * 100), currency: p.currency, method: p.method };
  }

  async refund(input: { paymentId: string; gatewayRef: string | null; amountCents: number; reason: string }) {
    if (!this.hasApiCreds() || !input.gatewayRef) {
      logger.warn({ ...input }, 'PayHere API credentials missing: refund must be processed manually in the merchant portal');
      return { refundRef: `MANUAL-${input.gatewayRef ?? input.paymentId}` };
    }
    const r = await this.api<{ status: number; msg?: string; data?: unknown }>('/payment/refund', {
      method: 'POST',
      body: JSON.stringify({ payment_id: input.gatewayRef, description: input.reason, amount: Number((input.amountCents / 100).toFixed(2)) }),
    });
    if (r.status !== 1) throw new Error(`PayHere refund rejected: ${r.msg ?? 'unknown error'}`);
    return { refundRef: String(r.data ?? input.gatewayRef) };
  }
}
