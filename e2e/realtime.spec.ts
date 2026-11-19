import { expect, test } from '@playwright/test';
import { apiLogin, apiPost, firstShow } from './helpers';

/** FR-4.7 / NFR-2: another customer's hold shows up on an open seat map within 2 seconds, without reloading. */
test('seat map updates live when someone else holds seats', async ({ page, playwright, baseURL }) => {
  const other = await playwright.request.newContext({ baseURL });
  const { showId, map } = await firstShow(other);
  const seat = map.seats.find((s: { status: string }) => s.status === 'AVAILABLE');

  await page.goto(`/shows/${showId}`);
  const button = page.getByRole('button', { name: new RegExp(`^Row ${seat.row}, seat ${seat.number},.*, available$`) });
  await expect(button).toBeEnabled();
  // Give the socket a moment to join the show room.
  await page.waitForTimeout(500);

  await apiLogin(other, 'customer');
  const started = Date.now();
  const res = await apiPost(other, `/api/shows/${showId}/holds`, { seatIds: [seat.id] });
  expect(res.status()).toBe(201);

  await expect(page.getByRole('button', { name: new RegExp(`^Row ${seat.row}, seat ${seat.number},.*, held$`) })).toBeDisabled({ timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(2_000);

  // Releasing frees it again, live.
  const booking = await res.json();
  await other.delete(`/api/bookings/${booking.booking.id}/hold`, { headers: { 'X-Requested-With': 'ShowPass' } });
  await expect(button).toBeEnabled({ timeout: 2_000 });
  await other.dispose();
});
