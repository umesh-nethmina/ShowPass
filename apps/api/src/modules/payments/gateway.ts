import type { Request } from 'express';

export interface CheckoutInput {
  paymentId: string;
  bookingReference: string;
  amountCents: number;
  currency: string;
  description: string;
  customer: { name: string; email: string; phone: string };
}

/** What the browser should do to start payment: follow a URL, or auto-submit a form to the gateway. */
export type CheckoutAction =
  | { type: 'redirect'; url: string }
  | { type: 'form'; action: string; fields: Record<string, string> };

/** Normalised, signature-verified result from a gateway webhook or status lookup. */
export interface GatewayEvent {
  paymentId: string;
  outcome: 'SUCCESS' | 'FAILED' | 'PENDING';
  gatewayRef?: string;
  amountCents?: number;
  currency?: string;
  method?: string;
  reason?: string;
}

export interface PaymentGateway {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutAction>;
  /** Must verify the signature and throw if it is invalid. */
  parseWebhook(req: Request): Promise<GatewayEvent>;
  /** Used by reconciliation (NFR-6). Returns null if the gateway cannot be queried. */
  lookup(paymentId: string): Promise<GatewayEvent | null>;
  refund(input: { paymentId: string; gatewayRef: string | null; amountCents: number; reason: string }): Promise<{ refundRef: string }>;
}
