import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import { api, errorMessage } from '../lib/api';
import { time } from '../lib/format';

type Result = 'VALID' | 'ALREADY_USED' | 'CANCELLED' | 'WRONG_SHOW' | 'NOT_FOUND' | 'NOT_PAID' | 'WRONG_CINEMA';
interface ScanResponse {
  result: Result;
  message: string;
  booking: { reference: string; customer: string; movie: string; screen: string; startTime: string; seats: string[]; items?: string[]; checkedInAt: string | null } | null;
}

const STYLE: Record<Result, { bg: string; title: string }> = {
  VALID: { bg: 'bg-emerald-600', title: 'VALID' },
  ALREADY_USED: { bg: 'bg-red-600', title: 'ALREADY USED' },
  CANCELLED: { bg: 'bg-red-600', title: 'CANCELLED' },
  WRONG_SHOW: { bg: 'bg-amber-600', title: 'WRONG SHOW' },
  WRONG_CINEMA: { bg: 'bg-amber-600', title: 'WRONG CINEMA' },
  NOT_FOUND: { bg: 'bg-red-600', title: 'NOT FOUND' },
  NOT_PAID: { bg: 'bg-red-600', title: 'NOT PAID' },
};

/** FR-8.1 / FR-8.2: mobile QR scanner for entrance staff. */
export default function Checker() {
  const shows = useQuery({ queryKey: ['checker-shows'], queryFn: () => api.get<{ shows: { id: string; startTime: string; movie: string; screen: string; cinema: string }[] }>('/checker/shows') });
  const [showId, setShowId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [res, setRes] = useState<ScanResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scanner = useRef<Html5Qrcode | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const showRef = useRef(showId);
  showRef.current = showId;

  async function check(code: string) {
    // Ignore the same code being read repeatedly by the camera within 3 seconds.
    if (lastCode.current && lastCode.current.code === code && Date.now() - lastCode.current.at < 3000) return;
    lastCode.current = { code, at: Date.now() };
    try {
      setErr(null);
      const r = await api.post<ScanResponse>('/checker/scan', { code, showId: showRef.current || undefined });
      setRes(r);
      navigator.vibrate?.(r.result === 'VALID' ? 80 : [80, 60, 80]);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function start() {
    setErr(null);
    try {
      scanner.current = new Html5Qrcode('qr-reader');
      await scanner.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => void check(text), () => {});
      setScanning(true);
    } catch (e) {
      setErr(`Could not start the camera: ${errorMessage(e)}. You can type the booking ID instead.`);
    }
  }

  async function stop() {
    await scanner.current?.stop().catch(() => {});
    scanner.current?.clear();
    scanner.current = null;
    setScanning(false);
  }

  useEffect(() => () => void scanner.current?.stop().catch(() => {}), []);

  return (
    <div className="container-page max-w-md py-6">
      <h1 className="font-display text-4xl tracking-wide">Scan tickets</h1>
      <label htmlFor="show" className="label mt-4">
        Show being admitted
      </label>
      <select id="show" className="input" value={showId} onChange={(e) => setShowId(e.target.value)}>
        <option value="">Any show today</option>
        {shows.data?.shows.map((s) => (
          <option key={s.id} value={s.id}>
            {time(s.startTime)} · {s.movie} · {s.screen}
          </option>
        ))}
      </select>

      <div id="qr-reader" className="mt-4 overflow-hidden rounded-xl bg-black" />
      <div className="mt-3">
        {scanning ? (
          <button className="btn-secondary w-full" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={start}>
            Start camera
          </button>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            lastCode.current = null;
            void check(manual.trim());
          }
        }}
      >
        <label htmlFor="manual" className="sr-only">
          Booking ID
        </label>
        <input id="manual" className="input" placeholder="Or enter booking ID (SP-…)" value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" />
        <button className="btn-secondary">Check</button>
      </form>

      {err && <p className="mt-3 text-sm text-red-400" role="alert">{err}</p>}

      {res && (
        <div className={`mt-4 rounded-2xl p-5 text-white ${STYLE[res.result].bg}`} role="status" aria-live="assertive">
          <p className="font-display text-5xl tracking-wide">{STYLE[res.result].title}</p>
          <p className="text-lg font-semibold">{res.message}</p>
          {res.booking && (
            <div className="mt-3 space-y-0.5 text-sm text-white/90">
              <p className="font-semibold">{res.booking.movie}</p>
              <p>
                {time(res.booking.startTime)} · {res.booking.screen}
              </p>
              <p className="text-xl font-bold">Seats {res.booking.seats.join(', ')}</p>
              {!!res.booking.items?.length && <p>Food & drinks: {res.booking.items.join(', ')}</p>}
              <p>
                {res.booking.reference} · {res.booking.customer}
              </p>
              {res.result === 'ALREADY_USED' && res.booking.checkedInAt && <p>First scanned at {time(res.booking.checkedInAt)}</p>}
            </div>
          )}
          <button className="mt-4 rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold" onClick={() => setRes(null)}>
            Next ticket
          </button>
        </div>
      )}
    </div>
  );
}
