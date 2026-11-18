import type { ScreenFormat, SeatCategory } from './types';

export const money = (cents: number, currency = 'LKR') =>
  `${currency} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const FORMAT_LABEL: Record<ScreenFormat, string> = { TWO_D: '2D', THREE_D: '3D', IMAX: 'IMAX' };
export const CATEGORY_LABEL: Record<SeatCategory, string> = { STANDARD: 'Standard', PREMIUM: 'Premium', RECLINER: 'Recliner' };

export const duration = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const dateTime = (iso: string) => `${dateLong(iso)} · ${time(iso)}`;

/** Label for a YYYY-MM-DD key relative to today. */
export function dayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
  return {
    top: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : weekday,
    bottom: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  };
}

export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
