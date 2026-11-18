import type { PromoType, SeatCategory } from '@prisma/client';
import type { Settings } from '../settings/settings.service.js';

export interface RuleLike {
  category: SeatCategory;
  priceCents: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  priority: number;
}

/**
 * FR-9.4: pick the price for a seat category at a given local show time.
 * A rule matches if its day list is empty or contains the weekday, and the time window (if any) contains the minute.
 * Ranking: explicit priority, then specificity (day filter + time filter), so a "weekend evening" rule beats a base rule.
 */
export function resolvePrice(rules: RuleLike[], category: SeatCategory, at: Date): number | null {
  const dow = at.getDay();
  const minute = at.getHours() * 60 + at.getMinutes();
  const matches = rules.filter((r) => {
    if (r.category !== category) return false;
    if (r.daysOfWeek.length && !r.daysOfWeek.includes(dow)) return false;
    if (r.startMinute != null && minute < r.startMinute) return false;
    if (r.endMinute != null && minute >= r.endMinute) return false;
    return true;
  });
  if (!matches.length) return null;
  const score = (r: RuleLike) =>
    r.priority * 100 + (r.daysOfWeek.length ? 1 : 0) + (r.startMinute != null || r.endMinute != null ? 1 : 0);
  matches.sort((a, b) => score(b) - score(a));
  return matches[0].priceCents;
}

export interface PromoLike {
  type: PromoType;
  valueCents: number; // for PERCENT this is percent * 100
  maxDiscountCents: number | null;
  minAmountCents: number | null;
}

export function promoDiscount(promo: PromoLike, subtotalCents: number): number {
  if (promo.minAmountCents != null && subtotalCents < promo.minAmountCents) return 0;
  let d = promo.type === 'PERCENT' ? Math.round((subtotalCents * promo.valueCents) / 10000) : promo.valueCents;
  if (promo.maxDiscountCents != null) d = Math.min(d, promo.maxDiscountCents);
  return Math.max(0, Math.min(d, subtotalCents));
}

export interface Totals {
  subtotal: number;
  items: number;
  convenienceFee: number;
  tax: number;
  discount: number;
  total: number;
}

/**
 * FR-5.1: ticket subtotal, food & drinks, fees, taxes, discount and total (all cents).
 * Promo discounts apply to tickets only; tax applies to (tickets - discount + fees + food).
 */
export function computeTotals(
  seatPricesCents: number[],
  settings: Pick<Settings, 'convenienceFeePerTicket' | 'taxPercent'>,
  discountCents = 0,
  itemsCents = 0,
): Totals {
  const subtotal = seatPricesCents.reduce((a, b) => a + b, 0);
  const convenienceFee = Math.round(settings.convenienceFeePerTicket * 100) * seatPricesCents.length;
  const discount = Math.min(discountCents, subtotal);
  const taxable = subtotal - discount + convenienceFee + itemsCents;
  const tax = Math.round((taxable * settings.taxPercent) / 100);
  return { subtotal, items: itemsCents, convenienceFee, tax, discount, total: taxable + tax };
}

/** FR-7.2: refund percent for a cancellation made `hoursBefore` hours before the show. */
export function refundPercent(policy: Settings['refundPolicy'], hoursBefore: number): number {
  const tiers = [...policy].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  for (const t of tiers) if (hoursBefore >= t.minHoursBefore) return t.percent;
  return 0;
}

export function availabilityLabel(available: number, total: number, fillingFastThreshold: number) {
  if (total === 0 || available === 0) return 'SOLD_OUT' as const;
  if (available / total <= fillingFastThreshold) return 'FILLING_FAST' as const;
  return 'AVAILABLE' as const;
}
