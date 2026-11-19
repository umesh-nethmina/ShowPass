import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, firstShow, loginUi } from './helpers';

/** NFR-14: automated WCAG 2.1 AA checks on the main customer pages (axe-core). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: import('@playwright/test').Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
  test.info().annotations.push({ type: `axe ${name}`, description: summary.join('\n') || 'no violations' });
  expect(summary, `WCAG 2.1 AA violations on ${name}`).toEqual([]);
}

test('home, movie, seat map, login and register meet WCAG 2.1 AA', async ({ page, request }) => {
  const { movie, showId } = await firstShow(request);
  for (const [name, path] of [
    ['home', '/'],
    ['movie', `/movies/${movie.slug}`],
    ['seat map', `/shows/${showId}`],
    ['login', '/login'],
    ['register', '/register'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalScroll(page);
    await audit(page, name);
  }
});

test('checkout and my bookings meet WCAG 2.1 AA', async ({ page, request }) => {
  const { showId } = await firstShow(request);
  await page.goto('/login');
  await loginUi(page, 'customer');
  await page.goto(`/shows/${showId}`);
  await page.getByRole('button', { name: /^Row .*, seat \d+, .*, available$/ }).last().click();
  await page.getByRole('button', { name: 'Proceed' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalScroll(page);
  await audit(page, 'checkout');
  await page.goto('/bookings');
  await page.waitForLoadState('networkidle');
  await audit(page, 'my bookings');
});
