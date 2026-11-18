import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://showpass:showpass@localhost:5450/showpass_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      JWT_SECRET: 'test-jwt-secret-0123456789',
      QR_SECRET: 'test-qr-secret',
      PAYMENT_GATEWAY: 'mock',
      MOCK_GATEWAY_SECRET: 'test-mock-secret',
      APP_TIMEZONE: 'Asia/Colombo',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
