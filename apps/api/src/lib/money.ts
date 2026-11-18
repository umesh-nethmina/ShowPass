import { Prisma } from '@prisma/client';

/** All money is handled in integer cents internally to avoid float drift. */
export const toCents = (v: Prisma.Decimal | number | string) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
export const dec = (c: number) => new Prisma.Decimal(fromCents(c));
