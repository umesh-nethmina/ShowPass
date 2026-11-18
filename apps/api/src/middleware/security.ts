import type { NextFunction, Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis.js';
import { AppError } from '../lib/errors.js';
import { isTest } from '../config/env.js';

/**
 * CSRF defence: state-changing requests must carry a custom header. Browsers will not send
 * custom headers cross-origin without a CORS preflight, which our CORS policy only allows for WEB_ORIGIN.
 * Gateway webhooks are exempt (they are verified by signature instead).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safe || req.path.startsWith('/api/payments/webhook')) return next();
  if (req.get('X-Requested-With') !== 'ShowPass') {
    return next(new AppError(403, 'CSRF', 'Missing request header'));
  }
  next();
}

function limiter(prefix: string, windowMs: number, limit: number) {
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.')),
  };
  if (redis) {
    const client = redis;
    opts.store = new RedisStore({
      prefix: `rl:${prefix}:`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)) as any,
    });
  }
  return rateLimit(opts);
}

/** NFR-8: rate limit login and OTP endpoints */
export const loginLimiter = limiter('login', 15 * 60 * 1000, 10);
export const otpLimiter = limiter('otp', 15 * 60 * 1000, 5);
export const apiLimiter = limiter('api', 60 * 1000, 300);
