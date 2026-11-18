import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export type SeatState = 'AVAILABLE' | 'HELD' | 'BOOKED';
export interface SeatChange {
  seatId: string;
  status: SeatState;
}

let io: Server | null = null;

/**
 * FR-4.7 / NFR-2: clients join `show:<id>` and receive `seats:update` events.
 * Socket.IO negotiates WebSocket and falls back to HTTP long-polling (SRS §4.4).
 * With Redis configured, events are fanned out through Redis pub/sub so that clients connected
 * to any API instance receive them (needed when running more than one instance).
 */
export function initSocket(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.WEB_ORIGIN, credentials: true }, path: '/socket.io' });
  if (redis) {
    io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));
    logger.info('socket.io using redis adapter');
  }
  io.on('connection', (socket) => {
    socket.on('show:join', (showId: unknown) => {
      if (typeof showId === 'string' && showId.length < 64) socket.join(`show:${showId}`);
    });
    socket.on('show:leave', (showId: unknown) => {
      if (typeof showId === 'string') socket.leave(`show:${showId}`);
    });
  });
  logger.info('socket.io ready');
  return io;
}

export function emitSeatChanges(showId: string, changes: SeatChange[]) {
  if (!io || !changes.length) return;
  io.to(`show:${showId}`).emit('seats:update', { showId, changes });
}
