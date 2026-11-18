import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const getSocket = () => (socket ??= io({ path: '/socket.io', withCredentials: true }));

export interface SeatChange {
  seatId: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED';
}

/** Subscribes to live seat changes for a show (FR-4.7). Socket.IO falls back to long-polling automatically. */
export function useShowSeats(showId: string | undefined, onChange: (changes: SeatChange[]) => void) {
  useEffect(() => {
    if (!showId) return;
    const s = getSocket();
    const join = () => s.emit('show:join', showId);
    const handler = (msg: { showId: string; changes: SeatChange[] }) => {
      if (msg.showId === showId) onChange(msg.changes);
    };
    join();
    s.on('connect', join); // re-join after reconnects
    s.on('seats:update', handler);
    return () => {
      s.emit('show:leave', showId);
      s.off('connect', join);
      s.off('seats:update', handler);
    };
  }, [showId, onChange]);
}
