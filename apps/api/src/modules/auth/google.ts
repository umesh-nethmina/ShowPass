import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

let client: OAuth2Client | null = null;

/** Wrapped in an object so tests can replace the network call. */
export const googleVerifier = {
  async verify(idToken: string): Promise<GoogleIdentity> {
    client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('Google token has no subject or email');
    return { sub: p.sub, email: p.email, emailVerified: Boolean(p.email_verified), name: p.name ?? '' };
  },
};

/**
 * FR-1.6: sign in with a Google ID token (from Google Identity Services on the web).
 * Finds the account by Google ID, links an existing customer account with the same verified email,
 * or creates a new customer account (email already verified by Google).
 */
export async function signInWithGoogle(credential: string) {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError(404, 'GOOGLE_DISABLED', 'Google sign-in is not enabled');
  let g: GoogleIdentity;
  try {
    g = await googleVerifier.verify(credential);
  } catch {
    throw unauthorized('Google sign-in failed. Please try again.');
  }
  if (!g.emailVerified) throw unauthorized('Your Google email address is not verified');
  const email = g.email.toLowerCase();

  let user = await prisma.user.findUnique({ where: { googleId: g.sub } });
  let created = false;
  if (!user) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'CUSTOMER') throw unauthorized('Staff accounts must sign in with email and password');
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { googleId: g.sub, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
      await audit({ userId: user.id, action: 'auth.google.link', entity: 'User', entityId: user.id });
    } else {
      user = await prisma.user.create({
        data: { name: g.name.trim() || email.split('@')[0], email, googleId: g.sub, emailVerifiedAt: new Date() },
      });
      created = true;
      await audit({ userId: user.id, action: 'auth.google.register', entity: 'User', entityId: user.id });
    }
  }
  if (!user.isActive) throw unauthorized('This account is disabled');
  return { user, created };
}
