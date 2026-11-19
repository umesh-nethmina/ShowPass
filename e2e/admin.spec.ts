import { expect, test } from '@playwright/test';
import { SHOTS, loginUi } from './helpers';

const PAGES: [string, string][] = [
  ['/admin', 'Dashboard'],
  ['/admin/movies', 'Movies'],
  ['/admin/cinemas', 'Cinemas & screens'],
  ['/admin/shows', 'Showtimes'],
  ['/admin/pricing', 'Pricing'],
  ['/admin/promo-codes', 'Promo codes'],
  ['/admin/food', 'Food & drinks'],
  ['/admin/bookings', 'Bookings'],
  ['/admin/reports', 'Reports'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/staff', 'Staff'],
  ['/admin/settings', 'Settings'],
  ['/admin/audit', 'Audit log'],
];

test('super admin can open every admin page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await loginUi(page, 'admin');
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/admin${path.replace(/\//g, '-')}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('seat layout editor paints seats and labels them', async ({ page }) => {
  await page.goto('/login');
  await loginUi(page, 'admin');
  await page.goto('/admin/cinemas');
  await page.getByRole('link', { name: '+ Add screen' }).first().click();
  await page.getByLabel('Screen name').fill('E2E Hall');
  await page.getByLabel('Grid rows').fill('3');
  await page.getByLabel('Grid columns').fill('6');
  await page.getByRole('radio', { name: 'Premium' }).click();
  await page.getByRole('button', { name: 'Fill all with tool' }).click();
  await page.getByTitle('Make this column an aisle').nth(2).click();
  await expect(page.getByText(/^15 seats/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Row A, seat 5, Premium' })).toBeVisible(); // numbering skips the aisle
  await page.screenshot({ path: `${SHOTS}/admin-layout-editor.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page).toHaveURL(/\/admin\/cinemas$/);
  await expect(page.getByText('E2E Hall')).toBeVisible();
});

test('checker scanner page loads for staff', async ({ page }) => {
  await page.goto('/login');
  await loginUi(page, 'checker');
  await expect(page).toHaveURL(/\/checker$/);
  await expect(page.getByRole('heading', { name: 'Scan tickets' })).toBeVisible();
  await page.getByPlaceholder(/booking ID/).fill('SP-NOTREAL');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'NOT FOUND' })).toBeVisible();
});
