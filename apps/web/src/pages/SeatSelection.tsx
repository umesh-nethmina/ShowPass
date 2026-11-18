import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useShowSeats, type SeatChange } from '../lib/socket';
import type { Booking, SeatCategory, SeatMap, SeatMapSeat } from '../lib/types';
import { CATEGORY_LABEL, FORMAT_LABEL, dateTime, money } from '../lib/format';
import { Alert, Spinner } from '../components/ui';

const CAT_STYLE: Record<SeatCategory, string> = {
  STANDARD: 'border-seat-standard text-seat-standard hover:bg-seat-standard/20',
  PREMIUM: 'border-seat-premium text-seat-premium hover:bg-seat-premium/20',
  RECLINER: 'border-seat-recliner text-seat-recliner hover:bg-seat-recliner/20',
};
const CAT_DOT: Record<SeatCategory, string> = { STANDARD: 'border-seat-standard', PREMIUM: 'border-seat-premium', RECLINER: 'border-seat-recliner' };

export default function SeatSelection() {
  const { showId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = useMemo(() => ['show', showId], [showId]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api.get<SeatMap>(`/shows/${showId}`),
    refetchInterval: 20_000, // safety net if the live connection drops
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // our own hold request also produces live 'HELD' events

  // Pre-select seats this customer is already holding (e.g. after coming back from checkout).
  useEffect(() => {
    if (data && selected.length === 0) {
      const mine = data.seats.filter((s) => s.mine).map((s) => s.id);
      if (mine.length) setSelected(mine);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onLive = useCallback(
    (changes: SeatChange[]) => {
      qc.setQueryData<SeatMap>(key, (old) => {
        if (!old) return old;
        const map = new Map(changes.map((c) => [c.seatId, c.status]));
        return { ...old, seats: old.seats.map((s) => (map.has(s.id) ? { ...s, status: map.get(s.id)!, mine: false } : s)) };
      });
      setSelected((sel) => {
        const lost = sel.filter((id) => changes.some((c) => c.seatId === id && c.status !== 'AVAILABLE'));
        if (busyRef.current) return sel;
        if (lost.length) setNotice('Someone just took a seat you had selected. Please choose another.');
        return sel.filter((id) => !lost.includes(id));
      });
    },
    [qc, key],
  );
  useShowSeats(showId, onLive);

  const seatsById = useMemo(() => new Map(data?.seats.map((s) => [s.id, s]) ?? []), [data]);
  const rows = useMemo(() => {
    const r = new Map<number, string>();
    data?.seats.forEach((s) => r.set(s.gridRow, s.row));
    return r;
  }, [data]);

  if (isLoading) return <Spinner label="Loading seat map" />;
  if (error || !data) return <div className="container-page py-12"><Alert>{errorMessage(error) || 'Show not found'}</Alert></div>;

  const { show, rules } = data;
  const chosen = selected.map((id) => seatsById.get(id)).filter(Boolean) as SeatMapSeat[];
  const subtotal = chosen.reduce((a, s) => a + s.priceCents, 0);

  function toggle(seat: SeatMapSeat) {
    setNotice(null);
    const isSel = selected.includes(seat.id);
    if (isSel) return setSelected(selected.filter((id) => id !== seat.id));
    if (seat.status !== 'AVAILABLE' && !seat.mine) return;
    if (selected.length >= rules.maxSeats) return setNotice(`You can select up to ${rules.maxSeats} seats per booking.`);
    setSelected([...selected, seat.id]);
  }

  async function proceed() {
    if (!user) return navigate(`/login?next=${encodeURIComponent(`/shows/${showId}`)}`);
    if (!user.verified) return navigate(`/verify?next=${encodeURIComponent(`/shows/${showId}`)}`);
    setBusy(true);
    busyRef.current = true;
    setNotice(null);
    try {
      const { booking } = await api.post<{ booking: Booking }>(`/shows/${showId}/holds`, { seatIds: selected });
      navigate(`/checkout/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SEATS_UNAVAILABLE') {
        const taken = (err.details as { seatIds?: string[] })?.seatIds ?? [];
        setSelected((s) => s.filter((id) => !taken.includes(id)));
        await refetch();
      }
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  return (
    <div className="pb-32">
      <div className="border-b border-ink-700 bg-ink-850">
        <div className="container-page flex items-center gap-4 py-4">
          <img src={show.movie.posterUrl} alt="" className="hidden h-16 w-11 rounded object-cover sm:block" />
          <div className="min-w-0">
            <Link to={`/movies/${show.movie.slug}`} className="text-sm text-zinc-400 hover:text-white">
              ← Back to showtimes
            </Link>
            <h1 className="truncate text-xl font-bold">{show.movie.title}</h1>
            <p className="text-sm text-zinc-400">
              {show.cinema.name} · {show.screen.name} ({FORMAT_LABEL[show.screen.format]}) · {dateTime(show.startTime)}
            </p>
          </div>
        </div>
      </div>

      <div className="container-page py-6">
        {!show.bookingOpen && <Alert kind="warning">Online booking for this show has closed.</Alert>}
        {notice && (
          <div className="mb-4">
            <Alert kind="warning">{notice}</Alert>
          </div>
        )}

        <ul className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-300" aria-label="Seat legend">
          {data.categories.map((c) => (
            <li key={c.category} className="flex items-center gap-2">
              <span className={`h-4 w-4 rounded border-2 ${CAT_DOT[c.category]}`} aria-hidden />
              {CATEGORY_LABEL[c.category]} {money(c.priceCents, rules.currency)}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-gold-400" aria-hidden /> Selected
          </li>
          <li className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-amber-900/70" aria-hidden /> Held
          </li>
          <li className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-ink-600" aria-hidden /> Booked
          </li>
        </ul>

        <div className="overflow-x-auto pb-4">
          <div className="mx-auto w-max">
            <div className="mx-auto mb-8 w-4/5">
              <div className="h-2 rounded-t-[100%] border-t-4 border-gold-400/70 shadow-[0_-8px_24px_rgba(245,197,24,0.25)]" />
              <p className="mt-1 text-center text-xs uppercase tracking-[0.3em] text-zinc-500">Screen</p>
            </div>
            <div className="flex gap-2">
              <div className="grid gap-1.5" style={{ gridTemplateRows: `repeat(${show.screen.gridRows}, 2rem)` }} aria-hidden>
                {Array.from({ length: show.screen.gridRows }, (_, r) => (
                  <span key={r} className="flex w-5 items-center justify-center text-xs text-zinc-500">
                    {rows.get(r) ?? ''}
                  </span>
                ))}
              </div>
              <div
                role="group"
                aria-label="Seat map"
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${show.screen.gridCols}, 2rem)`, gridTemplateRows: `repeat(${show.screen.gridRows}, 2rem)` }}
              >
                {data.seats.map((s) => {
                  const isSel = selected.includes(s.id);
                  const unavailable = !isSel && s.status !== 'AVAILABLE' && !s.mine;
                  const state = isSel ? 'selected' : s.status === 'BOOKED' ? 'booked' : s.status === 'HELD' && !s.mine ? 'held' : 'available';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      style={{ gridRow: s.gridRow + 1, gridColumn: s.gridCol + 1 }}
                      disabled={unavailable || !show.bookingOpen}
                      aria-pressed={isSel}
                      aria-label={`Seat ${s.label}, ${CATEGORY_LABEL[s.category]}, ${money(s.priceCents, rules.currency)}, ${state}`}
                      onClick={() => toggle(s)}
                      className={`flex items-center justify-center rounded-t-lg rounded-b border-2 text-[10px] font-bold transition ${
                        isSel
                          ? 'border-gold-400 bg-gold-400 text-ink-950'
                          : state === 'booked'
                            ? 'cursor-not-allowed border-ink-600 bg-ink-600 text-transparent'
                            : state === 'held'
                              ? 'cursor-not-allowed border-amber-900 bg-amber-900/70 text-transparent'
                              : CAT_STYLE[s.category]
                      }`}
                    >
                      {s.number}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-500">Seat availability updates live. Selected seats are held for {rules.holdMinutes} minutes once you continue.</p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-900/95 backdrop-blur">
        <div className="container-page flex items-center justify-between gap-4 py-3">
          <div className="min-w-0" aria-live="polite">
            {chosen.length ? (
              <>
                <p className="truncate text-sm text-zinc-300">
                  {chosen.length} seat{chosen.length > 1 ? 's' : ''}: <span className="font-semibold text-white">{chosen.map((s) => s.label).join(', ')}</span>
                </p>
                <p className="text-lg font-bold">{money(subtotal, rules.currency)}</p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">Select up to {rules.maxSeats} seats</p>
            )}
          </div>
          <button className="btn-primary shrink-0" disabled={!chosen.length || busy || !show.bookingOpen} onClick={proceed}>
            {busy ? 'Holding seats…' : 'Proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}
