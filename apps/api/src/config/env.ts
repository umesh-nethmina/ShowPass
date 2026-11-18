import 'dotenv/config';
import { z } from 'zod';

// Show times and price rules are interpreted in the cinema's local time zone.
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Colombo';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5180'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  QR_SECRET: z.string().min(8),
  PAYMENT_GATEWAY: z.enum(['mock', 'payhere']).default('mock'),
  PAYHERE_MERCHANT_ID: z.string().optional(),
  PAYHERE_MERCHANT_SECRET: z.string().optional(),
  PAYHERE_APP_ID: z.string().optional(),
  PAYHERE_APP_SECRET: z.string().optional(),
  PAYHERE_SANDBOX: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  MOCK_GATEWAY_SECRET: z.string().default('mock-secret'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('ShowPass <tickets@showpass.local>'),
  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  SMS_HTTP_URL: z.string().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
