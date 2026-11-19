import { expect, test } from '@playwright/test';
import { SHOTS, expectNoHorizontalScroll, loginUi } from './helpers';

/**
 * SRS 7.1 main use case on a 360 px phone: browse → showtime → seats → login → checkout with food and promo
 * → pay → e-ticket. NFR-12: the booking itself (movie, showtime, seats, pay, gateway) is 5 steps.
 */
test('customer books tickets with food and a promo code on a phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Now Showing' })).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

  // Search narrows the list (FR-2.3)
  await page.getByLabel('Search movies by title').fill('monsoon');
  await expect(page.locator('main a[href^="/movies/"] h3')).toHaveText(['The Last Monsoon']);
  await page.getByLabel('Search movies by title').fill('');

  // Step 1: movie
  await page.locator('main li a[href^="/movies/"]').first().click();
  await expect(page.getByRole('heading', { name: 'Showtimes' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/02-movie.png`, fullPage: true });

  // Step 2: showtime
  await page.locator('a[href^="/shows/"]').first().click();
  await expect(page.getByRole('group', { name: 'Seat map' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/03-seats.png`, fullPage: true });

  // Step 3: seats (guest is sent to log in, then back to the seat map)
  const available = page.getByRole('button', { name: /^Row .*, seat \d+, .*, available$/ });
  await available.nth(0).click();
  await available.nth(1).click(); // nth re-evaluates; the first is now "selected"
  await expect(page.getByText(/2 seats:/)).toBeVisible();
  await page.getByRole('button', { name: 'Proceed' }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await loginUi(page, 'customer');
  await expect(page.getByRole('group', { name: 'Seat map' })).toBeVisible();
  await available.nth(0).click();
  await available.nth(1).click();
  await page.getByRole('button', { name: 'Proceed' }).click();

  // Checkout: hold countdown, food, promo
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByRole('timer')).toContainText(/Seats held for \d+:\d\d/);
  await page.getByRole('button', { name: 'Add one Classic popcorn combo' }).click();
  await expect(page.getByText('Food & drinks', { exact: true })).toBeVisible();
  await page.getByLabel('Promo code').fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('WELCOME10 applied')).toBeVisible();
  await expect(page.getByText('Discount')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/04-checkout.png`, fullPage: true });

  // Step 4: pay → Step 5: gateway
  await page.getByRole('button', { name: /^Pay LKR/ }).click();
  await expect(page).toHaveURL(/\/mock-gateway\//);
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByRole('heading', { name: "You're booked!" })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/05-result.png`, fullPage: true });
  await page.getByRole('link', { name: 'View e-ticket' }).click();
  await expect(page.getByRole('img', { name: /QR code for booking SP-/ })).toBeVisible();
  await expect(page.getByText('1× Classic popcorn combo')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/06-ticket.png`, fullPage: true });

  // The PDF download works (FR-6.3)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^ShowPass-SP-.*\.pdf$/);

  // My bookings lists it as upcoming
  await page.getByRole('link', { name: '← My bookings' }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
});

test('declined payment releases the seats and lets the customer try again', async ({ page }) => {
  await page.goto('/login');
  await loginUi(page, 'customer');
  await page.locator('main li a[href^="/movies/"]').nth(1).click();
  await page.locator('a[href^="/shows/"]').first().click();
  await page.getByRole('button', { name: /^Row .*, seat \d+, .*, available$/ }).first().click();
  await page.getByRole('button', { name: 'Proceed' }).click();
  await page.getByRole('button', { name: /^Pay LKR/ }).click();
  await page.getByRole('button', { name: 'Simulate a declined card' }).click();
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/seats have been released/)).toBeVisible();
});
