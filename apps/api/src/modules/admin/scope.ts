import type { Request } from 'express';
import { forbidden } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import type { AuthUser } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';

/** Cinema admins are limited to their own cinema; super admins see everything. */
export function assertCinemaAccess(user: AuthUser, cinemaId: string) {
  if (user.role === 'SUPER_ADMIN') return;
  if (user.role === 'CINEMA_ADMIN' && user.cinemaId === cinemaId) return;
  throw forbidden('You can only manage your own cinema');
}

/** Restricts a cinemaId filter to what the user may see. */
export function scopedCinemaId(user: AuthUser, requested?: string): string | undefined {
  if (user.role === 'SUPER_ADMIN') return requested || undefined;
  return user.cinemaId ?? '__none__';
}

export const logAdmin = (req: Request, action: string, entity: string, entityId?: string | null, meta?: Prisma.InputJsonValue) =>
  audit({ userId: req.user!.id, action: `admin.${action}`, entity, entityId: entityId ?? null, meta });
