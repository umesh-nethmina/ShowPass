import { env, isTest } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const sentSms: { to: string; text: string }[] = []; // inspected by tests

/**
 * SMS provider abstraction. "console" logs the message (dev). "http" posts JSON
 * { to, message } with a bearer token, which matches most local SMS gateway APIs with a thin adapter.
 */
export async function sendSms(to: string, text: string) {
  if (isTest) {
    sentSms.push({ to, text });
    return;
  }
  if (env.SMS_PROVIDER === 'console' || !env.SMS_HTTP_URL) {
    logger.info({ to, text }, '[sms:console]');
    return;
  }
  const res = await fetch(env.SMS_HTTP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SMS_HTTP_TOKEN ?? ''}` },
    body: JSON.stringify({ to, message: text }),
  });
  if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
}
