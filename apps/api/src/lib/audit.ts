import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from './prisma.js';
import { logger } from './logger.js';

/** NFR-17: log bookings, payments, refunds and admin actions with timestamp and user. */
export async function audit(
  entry: { userId?: string | null; action: string; entity: string; entityId?: string | null; meta?: Prisma.InputJsonValue },
  tx: Tx = prisma,
) {
  try {
    await tx.auditLog.create({ data: { ...entry, userId: entry.userId ?? null } });
  } catch (err) {
    logger.error({ err, entry }, 'failed to write audit log');
  }
}
