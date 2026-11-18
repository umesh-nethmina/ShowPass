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

  /**
   * Status lookup and refunds use PayHere's Merchant API, which needs OAuth app credentials
   * (separate from the checkout secret). Until those are configured, reconciliation relies on
   * webhooks and refunds are flagged for manual processing in the PayHere portal.
   */
  async lookup(): Promise<GatewayEvent | null> {
    return null;
  }

  async refund(input: { paymentId: string; gatewayRef: string | null; amountCents: number; reason: string }) {
    logger.warn({ ...input }, 'PayHere refund must be processed manually in the merchant portal');
    return { refundRef: `MANUAL-${input.gatewayRef ?? input.paymentId}` };
  }
}
