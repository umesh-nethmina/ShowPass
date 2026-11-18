import { describe, expect, it } from 'vitest';
import { availabilityLabel, computeTotals, promoDiscount, refundPercent, resolvePrice, type RuleLike } from '../src/modules/pricing/pricing.js';
import { payhereCheckoutHash, payhereNotifySig } from '../src/modules/payments/payhere.gateway.js';
import { overlaps } from '../src/modules/admin/shows.service.js';
import { normalizePhone } from '../src/modules/auth/auth.schemas.js';

const rule = (p: Partial<RuleLike>): RuleLike => ({ category: 'STANDARD', priceCents: 100000, daysOfWeek: [], startMinute: null, endMinute: null, priority: 0, ...p });

describe('resolvePrice (FR-9.4)', () => {
  const rules = [rule({}), rule({ priceCents: 150000, daysOfWeek: [0, 6], startMinute: 17 * 60, priority: 1 }), rule({ category: 'PREMIUM', priceCents: 200000 })];
  it('uses the base price on a weekday', () => {
    expect(resolvePrice(rules, 'STANDARD', new Date(2026, 10, 18, 20, 0))).toBe(100000); // Wednesday
  });
  it('uses the weekend evening price when it applies', () => {
    expect(resolvePrice(rules, 'STANDARD', new Date(2026, 10, 21, 20, 0))).toBe(150000); // Saturday 8pm
    expect(resolvePrice(rules, 'STANDARD', new Date(2026, 10, 21, 10, 0))).toBe(100000); // Saturday morning
  });
  it('returns null when no rule matches', () => {
    expect(resolvePrice(rules, 'RECLINER', new Date())).toBeNull();
  });
  it('prefers a more specific rule at equal priority', () => {
    const r = [rule({}), rule({ priceCents: 90000, daysOfWeek: [3] })];
    expect(resolvePrice(r, 'STANDARD', new Date(2026, 10, 18, 12, 0))).toBe(90000);
  });
});

describe('totals, promos and refunds (FR-5.1, FR-5.4, FR-7.2)', () => {
  it('computes fees, tax and discount', () => {
    const t = computeTotals([100000, 150000], { convenienceFeePerTicket: 50, taxPercent: 10 }, 20000);
    expect(t).toEqual({ subtotal: 250000, convenienceFee: 10000, discount: 20000, tax: 24000, total: 264000 });
  });
  it('caps percent promos and respects minimum spend', () => {
    expect(promoDiscount({ type: 'PERCENT', valueCents: 1000, maxDiscountCents: 50000, minAmountCents: null }, 1_000_000)).toBe(50000);
    expect(promoDiscount({ type: 'FIXED', valueCents: 30000, maxDiscountCents: null, minAmountCents: 200000 }, 150000)).toBe(0);
    expect(promoDiscount({ type: 'FIXED', valueCents: 30000, maxDiscountCents: null, minAmountCents: null }, 20000)).toBe(20000);
  });
  it('picks the right refund tier', () => {
    const policy = [{ minHoursBefore: 2, percent: 50 }, { minHoursBefore: 24, percent: 100 }];
    expect(refundPercent(policy, 30)).toBe(100);
    expect(refundPercent(policy, 5)).toBe(50);
    expect(refundPercent(policy, 1)).toBe(0);
  });
  it('labels availability (FR-3.2)', () => {
    expect(availabilityLabel(0, 100, 0.3)).toBe('SOLD_OUT');
    expect(availabilityLabel(20, 100, 0.3)).toBe('FILLING_FAST');
    expect(availabilityLabel(80, 100, 0.3)).toBe('AVAILABLE');
  });
});

describe('misc helpers', () => {
  it('detects overlapping intervals', () => {
    const d = (h: number) => new Date(2026, 0, 1, h);
    expect(overlaps(d(10), d(12), d(11), d(13))).toBe(true);
    expect(overlaps(d(10), d(12), d(12), d(14))).toBe(false);
  });
  it('normalises Sri Lankan mobile numbers', () => {
    expect(normalizePhone('077 123 4567')).toBe('+94771234567');
    expect(normalizePhone('94771234567')).toBe('+94771234567');
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
    expect(normalizePhone('12345')).toBeNull();
  });
  it('builds PayHere hashes deterministically', () => {
    const a = payhereCheckoutHash('1211149', 'ORDER1', 100000, 'LKR', 'secret');
    expect(a).toMatch(/^[0-9A-F]{32}$/);
    expect(payhereNotifySig('1211149', 'ORDER1', '1000.00', 'LKR', '2', 'secret')).toMatch(/^[0-9A-F]{32}$/);
  });
});
