import { Redis } from 'ioredis';
import { env, isTest } from '../config/env.js';
import { logger } from './logger.js';

/** Optional Redis connection. The app works without it (in-memory rate limiting, single-node sockets). */
export const redis: Redis | null =
  env.REDIS_URL && !isTest ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }) : null;

redis?.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
