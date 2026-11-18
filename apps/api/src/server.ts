import http from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { initSocket } from './realtime/socket.js';
import { startJobs } from './jobs/scheduler.js';

const app = createApp();
const server = http.createServer(app);
initSocket(server);
const stopJobs = startJobs();

server.listen(env.PORT, () => logger.info(`ShowPass API listening on http://localhost:${env.PORT}`));

const shutdown = async () => {
  logger.info('shutting down');
  stopJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
