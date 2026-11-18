import pino from 'pino';
import { env, isProd } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash'],
});
