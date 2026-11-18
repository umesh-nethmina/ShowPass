import bcrypt from 'bcryptjs';
import type { CodePurpose, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { otpCode, sha256 } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { sendEmail } from '../notifications/email.js';
import { sendSms } from '../notifications/sms.js';
import { otpEmail } from '../notifications/templates.js';
import { normalizePhone } from './auth.schemas.js';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// A real bcrypt hash of a random string, compared against when the account does not exist (keeps timing uniform).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_ROUNDS);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

type PublicFields = Pick<User, 'id' | 'name' | 'email' | 'phone' | 'role' | 'cinemaId' | 'emailVerifiedAt' | 'phoneVerifiedAt'> & { passwordHash?: string | null };

export function publicUser(u: PublicFields) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    cinemaId: u.cinemaId,
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    verified: Boolean(u.emailVerifiedAt || u.phoneVerifiedAt),
    // Only known when the full row is passed (login/me); used to show "set a password" in the profile.
    hasPassword: u.passwordHash === undefined ? undefined : Boolean(u.passwordHash),
  };
}

export async function findByIdentifier(identifier: string) {
  if (identifier.includes('@')) return prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });
  const phone = normalizePhone(identifier);
  return phone ? prisma.user.findUnique({ where: { phone } }) : null;
}

export async function register(input: { name: string; email: string; phone: string; password: string }) {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { phone: input.phone }] } });
  if (existing) {
    throw conflict(
      'ACCOUNT_EXISTS',
      existing.email === input.email ? 'An account with this email already exists' : 'An account with this mobile number already exists',
    );
  }
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, phone: input.phone, passwordHash: await hashPassword(input.password) },
  });
  // FR-1.2: send a verification code straight away. Failures are logged; the user can resend.
  issueCode(user, 'VERIFY_EMAIL').catch((err) => logger.warn({ err }, 'could not send verification email'));
  return user;
}

export async function login(identifier: string, password: string) {
  const user = await findByIdentifier(identifier);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (user && !user.passwordHash && user.googleId) throw unauthorized('This account uses Google sign-in. Continue with Google instead.');
  if (!user || !ok || !user.isActive) throw unauthorized('Incorrect email/mobile or password');
  return user;
}

/** Creates a 6-digit code, stores only its hash, and delivers it by email or SMS. */
export async function issueCode(
  user: User,
  purpose: CodePurpose,
  channel: 'email' | 'sms' = purpose === 'VERIFY_PHONE' ? 'sms' : 'email',
) {
  const code = otpCode();
  await prisma.$transaction([
    prisma.verificationCode.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.verificationCode.create({
      data: { userId: user.id, purpose, codeHash: sha256(`${user.id}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    }),
  ]);
  const kind = purpose === 'RESET_PASSWORD' ? 'reset' : 'verify';
  if (channel === 'email') {
    await sendEmail({ to: user.email, ...otpEmail(user.name, code, kind) });
  } else {
    if (!user.phone) throw badRequest('NO_PHONE', 'Add a mobile number to your profile first');
    await sendSms(user.phone, `ShowPass: your ${kind === 'reset' ? 'password reset' : 'verification'} code is ${code}. Valid for 10 minutes.`);
  }
  return code;
}

async function consumeCode(userId: string, purpose: CodePurpose, code: string) {
  const record = await prisma.verificationCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record || record.expiresAt < new Date()) throw badRequest('CODE_EXPIRED', 'This code has expired. Request a new one.');
  if (record.attempts >= OTP_MAX_ATTEMPTS) throw badRequest('CODE_LOCKED', 'Too many wrong attempts. Request a new code.');
  if (record.codeHash !== sha256(`${userId}:${code}`)) {
    await prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw badRequest('CODE_INVALID', 'That code is not correct');
  }
  await prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
}

export async function confirmVerification(userId: string, channel: 'email' | 'sms', code: string) {
  await consumeCode(userId, channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE', code);
  return prisma.user.update({
    where: { id: userId },
    data: channel === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() },
  });
}

export async function forgotPassword(identifier: string) {
  const user = await findByIdentifier(identifier);
  if (!user || !user.isActive) return; // do not reveal whether the account exists
  await issueCode(user, 'RESET_PASSWORD', identifier.includes('@') ? 'email' : 'sms');
}

export async function resetPassword(identifier: string, code: string, newPassword: string) {
  const user = await findByIdentifier(identifier);
  if (!user) throw badRequest('CODE_INVALID', 'That code is not correct');
  await consumeCode(user.id, 'RESET_PASSWORD', code);
  // Receiving the code proves control of that email/mobile, so it also counts as verification.
  const verify = identifier.includes('@')
    ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
    : { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() };
  return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), ...verify } });
}
