import { env } from '../../config/env.js';
import type { PaymentGateway } from './gateway.js';
import { MockGateway } from './mock.gateway.js';
import { PayHereGateway } from './payhere.gateway.js';

const gateways: Record<string, PaymentGateway> = {
  mock: new MockGateway(),
  payhere: new PayHereGateway(),
};

/** Gateway used for new payments. */
export const activeGateway = () => gateways[env.PAYMENT_GATEWAY];
/** Gateway that handled an existing payment (by name stored on the Payment row). */
export const gatewayByName = (name: string) => gateways[name];
