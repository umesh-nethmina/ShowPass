import { useEffect, useState } from 'react';

/** Seconds remaining until `until`, updated every second. */
export function useCountdown(until: string | Date | null | undefined) {
  const target = until ? new Date(until).getTime() : 0;
  const [left, setLeft] = useState(() => Math.max(0, Math.round((target - Date.now()) / 1000)));
  useEffect(() => {
    if (!target) return;
    const tick = () => setLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);
  return left;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
