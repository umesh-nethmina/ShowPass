import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env, isProd } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const COOKIE_NAME = 'sp_session';
const CUSTOMER_TTL_SEC = 60 * 60 * 24 * 7;
/** NFR-9: staff sessions expire after 30 minutes of inactivity (sliding). */
const STAFF_TTL_SEC = 60 * 30;

export const STAFF_ROLES: Role[] = ['TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN'];
export const ADMIN_ROLES: Role[] = ['CINEMA_ADMIN', 'SUPER_ADMIN'];

export interface AuthUser {
  id: string;
  role: Role;
  cinemaId: string | null;
  name: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: string;
  role: Role;
}

export function setSessionCookie(res: Response, user: { id: string; role: Role }) {
  const ttl = STAFF_ROLES.includes(user.role) ? STAFF_TTL_SEC : CUSTOMER_TTL_SEC;
  const token = jwt.sign({ sub: user.id, role: user.role } satisfies TokenPayload, env.JWT_SECRET, { expiresIn: ttl });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: ttl * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        cinemaId: true,
        name: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        isActive: true,
      },
    });
    if (user?.isActive) {
      const { isActive: _ignored, ...rest } = user;
      req.user = rest;
      // sliding expiry for staff sessions
      if (STAFF_ROLES.includes(user.role)) setSessionCookie(res, user);
    } else {
      clearSessionCookie(res);
    }
  } catch {
    clearSessionCookie(res);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const isVerified = (u: AuthUser) => Boolean(u.emailVerifiedAt || u.phoneVerifiedAt);
