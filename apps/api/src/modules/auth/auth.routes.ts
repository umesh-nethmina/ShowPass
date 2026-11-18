import { Router } from 'express';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../../middleware/auth.js';
import { loginLimiter, otpLimiter } from '../../middleware/security.js';
import * as schemas from './auth.schemas.js';
import * as auth from './auth.service.js';
import { env } from '../../config/env.js';
import { signInWithGoogle } from './google.js';
import { z } from 'zod';

export const authRouter = Router();

authRouter.post(
  '/register',
  loginLimiter,
  validate(schemas.registerSchema),
  h(async (req, res) => {
    const user = await auth.register(req.body);
    setSessionCookie(res, user);
    res.status(201).json({ user: auth.publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate(schemas.loginSchema),
  h(async (req, res) => {
    const user = await auth.login(req.body.identifier, req.body.password);
    setSessionCookie(res, user);
    res.json({ user: auth.publicUser(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get(
  '/me',
  h(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id }, select: { passwordHash: true } });
    res.json({ user: auth.publicUser({ ...req.user, passwordHash: row.passwordHash }) });
  }),
);

/** Public auth configuration for the web app (which sign-in options to show). */
authRouter.get('/config', (_req, res) => {
  res.json({ googleClientId: env.GOOGLE_CLIENT_ID || null });
});

authRouter.post(
  '/google',
  loginLimiter,
  validate(z.object({ credential: z.string().min(20).max(4096) })),
  h(async (req, res) => {
    const { user, created } = await signInWithGoogle(req.body.credential);
    setSessionCookie(res, user);
    res.status(created ? 201 : 200).json({ user: auth.publicUser(user), created });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate(schemas.updateMeSchema),
  h(async (req, res) => {
    const { name, phone } = req.body as { name?: string; phone?: string };
    const data: { name?: string; phone?: string; phoneVerifiedAt?: null } = {};
    if (name) data.name = name;
    if (phone && phone !== req.user!.phone) {
      const taken = await prisma.user.findUnique({ where: { phone } });
      if (taken) throw conflict('ACCOUNT_EXISTS', 'This mobile number is used by another account');
      data.phone = phone;
      data.phoneVerifiedAt = null;
    }
    const user = await prisma.user.update({ where: { id: req.user!.id }, data });
    res.json({ user: auth.publicUser(user) });
  }),
);

authRouter.post(
  '/password/change',
  requireAuth,
  validate(schemas.changePasswordSchema),
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    // Google-only accounts have no password yet and may set one without a current password.
    if (user.passwordHash && !(await auth.verifyPassword(req.body.currentPassword ?? '', user.passwordHash))) {
      throw unauthorized('Current password is incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await auth.hashPassword(req.body.newPassword) } });
    res.status(204).end();
  }),
);

authRouter.post(
  '/verify/request',
  requireAuth,
  otpLimiter,
  validate(schemas.verifyRequestSchema),
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const channel = req.body.channel as 'email' | 'sms';
    if ((channel === 'email' && user.emailVerifiedAt) || (channel === 'sms' && user.phoneVerifiedAt)) {
      throw badRequest('ALREADY_VERIFIED', 'Already verified');
    }
    await auth.issueCode(user, channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE', channel);
    res.status(202).json({ sent: true });
  }),
);

authRouter.post(
  '/verify/confirm',
  requireAuth,
  otpLimiter,
  validate(schemas.verifyConfirmSchema),
  h(async (req, res) => {
    const user = await auth.confirmVerification(req.user!.id, req.body.channel, req.body.code);
    res.json({ user: auth.publicUser(user) });
  }),
);

authRouter.post(
  '/password/forgot',
  otpLimiter,
  validate(schemas.forgotSchema),
  h(async (req, res) => {
    await auth.forgotPassword(req.body.identifier);
    res.status(202).json({ sent: true });
  }),
);

authRouter.post(
  '/password/reset',
  otpLimiter,
  validate(schemas.resetSchema),
  h(async (req, res) => {
    const user = await auth.resetPassword(req.body.identifier, req.body.code, req.body.password);
    setSessionCookie(res, user);
    res.json({ user: auth.publicUser(user) });
  }),
);
