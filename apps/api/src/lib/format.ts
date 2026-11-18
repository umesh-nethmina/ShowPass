export function formatMoney(cents: number, currency = 'LKR') {
  return `${currency} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatShowTime(d: Date) {
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export const seatLabel = (s: { rowLabel: string; seatNumber: number }) => `${s.rowLabel}${s.seatNumber}`;

/** Local calendar date (YYYY-MM-DD) in the app time zone. */
export function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** [start, end) of a local calendar day given YYYY-MM-DD. */
export function dayRange(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}
