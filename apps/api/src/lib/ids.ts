import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human friendly booking reference, e.g. SP-7K3F9QXA */
export function bookingReference() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `SP-${out}`;
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export function otpCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
