import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ACCOUNTS = {
  customer: { email: 'customer@showpass.local', password: 'Customer@1234' },
  admin: { email: 'admin@showpass.local', password: 'Admin@1234' },
  checker: { email: 'checker@showpass.local', password: 'Checker@1234' },
};

export const SHOTS = 'test-results/screens';

export async function loginUi(page: Page, who: keyof typeof ACCOUNTS) {
  await page.getByLabel('Email or mobile number').fill(ACCOUNTS[who].email);
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS[who].password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  // Wait until the session exists (the login page redirects away) before navigating elsewhere.
  await expect(page).not.toHaveURL(/\/login/);
}

const H = { 'X-Requested-With': 'ShowPass' };

export async function apiLogin(request: APIRequestContext, who: keyof typeof ACCOUNTS) {
  const res = await request.post('/api/auth/login', { headers: H, data: { identifier: ACCOUNTS[who].email, password: ACCOUNTS[who].password } });
  expect(res.ok()).toBeTruthy();
}

export const apiPost = (request: APIRequestContext, url: string, data: unknown) => request.post(url, { headers: H, data });

/** First bookable show of the first now-showing movie, with its seat map. */
export async function firstShow(request: APIRequestContext) {
  const movies = await (await request.get('/api/movies?status=NOW_SHOWING')).json();
  for (const m of movies.movies) {
    const st = await (await request.get(`/api/movies/${m.id}/showtimes`)).json();
    const show = st.cinemas?.[0]?.shows?.[0];
    if (show) {
      const map = await (await request.get(`/api/shows/${show.id}`)).json();
      return { movie: m, showId: show.id as string, map };
    }
  }
  throw new Error('no bookable show in seed data');
}

/** Fails the test if the page scrolls horizontally (NFR-13 at 360 px). */
export async function expectNoHorizontalScroll(page: Page) {
  const { overflow, culprits } = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const culprits = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // ignore content inside intentionally scrollable containers
        for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return false;
        return r.width > 0 && r.right > w + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className?.toString() ?? '').split(' ').slice(0, 4).join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { overflow: document.documentElement.scrollWidth - w, culprits };
  });
  expect(overflow, `page should not scroll horizontally; widest elements: ${culprits.join(' | ')}`).toBeLessThanOrEqual(0);
}
