import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

export const settingsSchema = z.object({
  currency: z.string().min(3).max(3),
  holdMinutes: z.number().int().min(1).max(60),
  maxSeatsPerBooking: z.number().int().min(1).max(50),
  /** Minutes before show start after which online booking closes (FR-3.3). */
  bookingCutoffMinutes: z.number().int().min(0).max(24 * 60),
  /** FR-7.1: customer cancellation allowed until this many minutes before the show. */
  cancelCutoffMinutes: z.number().int().min(0).max(7 * 24 * 60),
  convenienceFeePerTicket: z.number().min(0),
  taxPercent: z.number().min(0).max(100),
  /** Refund tiers, evaluated from the largest minHoursBefore down. */
  refundPolicy: z.array(z.object({ minHoursBefore: z.number().min(0), percent: z.number().min(0).max(100) })),
  /** "Filling fast" when available share drops below this fraction (FR-3.2). */
  fillingFastThreshold: z.number().min(0).max(1),
  showtimeDaysAhead: z.number().int().min(1).max(60),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  currency: 'LKR',
  holdMinutes: 10,
  maxSeatsPerBooking: 10,
  bookingCutoffMinutes: 0,
  cancelCutoffMinutes: 120,
  convenienceFeePerTicket: 0,
  taxPercent: 0,
  refundPolicy: [
    { minHoursBefore: 24, percent: 100 },
    { minHoursBefore: 2, percent: 50 },
  ],
  fillingFastThreshold: 0.3,
  showtimeDaysAhead: 7,
};

let cache: { value: Settings; at: number } | null = null;
const CACHE_MS = 30_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await prisma.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });
  await prisma.$transaction(
    Object.entries(patch).map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } }),
    ),
  );
  cache = null;
  return next;
}

export function clearSettingsCache() {
  cache = null;
}
