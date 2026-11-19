import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a real API + web dev server and an isolated, freshly seeded database
 * (showpass_e2e), so they never touch the development data.
 * Needs the dev infrastructure running: `npm run infra:up`.
 */
const API_PORT = 4100;
const WEB_PORT = 5190;
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://showpass:showpass@localhost:5450/showpass_e2e?schema=public';

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    // Use an installed browser instead of the bundled Chromium with PW_CHANNEL=msedge or PW_CHANNEL=chrome.
    channel: process.env.PW_CHANNEL || undefined,
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // NFR-13: smallest supported phone width
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, channel: process.env.PW_CHANNEL || undefined }, testMatch: /customer\.spec\.ts|a11y\.spec\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined }, testMatch: /admin\.spec\.ts|realtime\.spec\.ts/ },
  ],
  webServer: [
    {
      // Reset + seed the E2E database, then start the API (not in watch mode).
      command: 'npx prisma db push --force-reset --skip-generate --accept-data-loss && npx tsx prisma/seed.ts && npx tsx src/server.ts',
      cwd: '../apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        DATABASE_URL: DB,
        REDIS_URL: '',
        PAYMENT_GATEWAY: 'mock',
        JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef',
        QR_SECRET: 'e2e-qr-secret',
      },
    },
    {
      command: 'npx vite',
      cwd: '../apps/web',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { WEB_PORT: String(WEB_PORT), API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
