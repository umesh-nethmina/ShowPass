import { execSync } from 'node:child_process';

/** Recreates the test database schema once per test run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://showpass:showpass@localhost:5450/showpass_test?schema=public';
  execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
