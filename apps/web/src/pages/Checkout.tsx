import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { Booking, CheckoutAction } from '../lib/types';
import { CATEGORY_LABEL, FORMAT_LABEL, dateTime, money } from '../lib/format';
import { mmss, useCountdown } from '../lib/useCountdown';
import { Alert, Spinner } from '../components/ui';

/** Sends the browser to the payment gateway: a plain redirect, or an auto-submitted POST form (PayHere). */
export function goToGateway(checkout: CheckoutAction, navigate: (to: string) => void) {
  if (checkout.type === 'redirect') {
    if (/^https?:\/\//.test(checkout.url) && !checkout.url.startsWith(window.location.origin)) window.location.assign(checkout.url);
    else navigate(checkout.url.replace(window.location.origin, ''));
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = checkout.action;
  for (const [k, v] of Object.entries(checkout.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export default function Checkout() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ['booking', bookingId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<{ booking: Booking }>(`/bookings/${bookingId}`) });
  const booking = data?.booking;
  const left = useCountdown(booking?.holdExpiresAt);
  const [code, setCode] = useState('');

  const promo = useMutation({
    mutationFn: (c: string | null) => api.post<{ booking: Booking }>(`/bookings/${bookingId}/promo`, { code: c }),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const pay = useMutation({
    mutationFn: () => api.post<{ paymentId: string; checkout: CheckoutAction }>(`/bookings/${bookingId}/pay`),
    onSuccess: (d) => goToGateway(d.checkout, navigate),
  });
  const abandon = useMutation({
    mutationFn: () => api.delete(`/bookings/${bookingId}/hold`),
    onSuccess: () => navigate(`/shows/${booking!.show.id}`),
  });

  if (isLoading) return <Spinner />;
  if (error || !booking) return <div className="container-page py-12"><Alert>{errorMessage(error) || 'Booking not found'}</Alert></div>;

  if (booking.status === 'CONFIRMED') {
    return (
      <div className="container-page max-w-lg py-12">
        <Alert kind="success">This booking is already paid.</Alert>
        <Link to={`/bookings/${booking.id}`} className="btn-primary mt-4">
          View ticket
        </Link>
      </div>
    );
  }

  const expired = booking.status !== 'PENDING' || left === 0;
  const urgent = left < 120;

  return (
    <div className="container-page max-w-3xl py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl tracking-wide">Checkout</h1>
        {!expired && (
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${urgent ? 'border-red-500/50 bg-red-500/10 text-red-300' : 'border-gold-400/40 bg-gold-400/10 text-gold-300'}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>
            Seats held for <span className="tabular-nums">{mmss(left)}</span>
          </div>
        )}
      </div>

      {expired && (
        <div className="mt-4 space-y-3">
          <Alert kind="warning">Your seat hold has expired, so the seats were released. Please choose your seats again.</Alert>
          <Link to={`/shows/${booking.show.id}`} className="btn-primary">
            Back to seat map
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="card p-5" aria-labelledby="sum-heading">
          <h2 id="sum-heading" className="sr-only">
            Booking summary
          </h2>
          <div className="flex gap-4">
            <img src={booking.show.movie.posterUrl} alt="" className="h-28 w-20 rounded object-cover" />
            <div>
              <p className="text-lg font-bold">{booking.show.movie.title}</p>
              <p className="text-sm text-zinc-400">
                {booking.show.movie.ageRating} · {FORMAT_LABEL[booking.show.screen.format]} · {booking.show.language}
              </p>
              <p className="mt-2 text-sm">{booking.show.cinema.name}</p>
              <p className="text-sm text-zinc-400">{booking.show.screen.name}</p>
              <p className="text-sm font-semibold text-gold-400">{dateTime(booking.show.startTime)}</p>
            </div>
          </div>
          <table className="mt-5 w-full text-sm">
            <caption className="sr-only">Tickets</caption>
            <tbody>
              {booking.seats.map((s) => (
                <tr key={s.seatId} className="border-b border-ink-700/60">
                  <td className="py-2">
                    Seat <span className="font-semibold">{s.label}</span> <span className="text-zinc-400">· {CATEGORY_LABEL[s.category]}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(s.priceCents, booking.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="space-y-4">
          <form
            className="card space-y-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) promo.mutate(code.trim());
            }}
          >
            <label htmlFor="promo" className="label">
              Promo code
            </label>
            {booking.promoCode ? (
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
                <span className="font-semibold text-emerald-300">{booking.promoCode} applied</span>
                <button type="button" className="text-xs text-zinc-300 underline" onClick={() => promo.mutate(null)} disabled={expired}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input id="promo" className="input uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WELCOME10" disabled={expired} autoComplete="off" />
                <button className="btn-secondary" disabled={expired || promo.isPending || !code.trim()}>
                  Apply
                </button>
              </div>
            )}
            {promo.error && <p className="text-xs text-red-400">{errorMessage(promo.error)}</p>}
          </form>

          <div className="card p-4">
            <dl className="space-y-1.5 text-sm">
              <Row label="Tickets" value={money(booking.subtotalCents, booking.currency)} />
              {booking.convenienceFeeCents > 0 && <Row label="Convenience fee" value={money(booking.convenienceFeeCents, booking.currency)} />}
              {booking.taxCents > 0 && <Row label="Taxes" value={money(booking.taxCents, booking.currency)} />}
              {booking.discountCents > 0 && <Row label="Discount" value={`− ${money(booking.discountCents, booking.currency)}`} accent />}
              <div className="flex justify-between border-t border-ink-600 pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(booking.totalCents, booking.currency)}</dd>
              </div>
            </dl>
            {pay.error && (
              <div className="mt-3">
                <Alert>{errorMessage(pay.error)}</Alert>
              </div>
            )}
            <button className="btn-primary mt-4 w-full" disabled={expired || pay.isPending} onClick={() => pay.mutate()}>
              {pay.isPending ? 'Redirecting to payment…' : `Pay ${money(booking.totalCents, booking.currency)}`}
            </button>
            <button className="btn-ghost mt-2 w-full" disabled={expired || abandon.isPending} onClick={() => abandon.mutate()}>
              Change seats
            </button>
            <p className="mt-3 text-center text-xs text-zinc-500">You will pay on our secure payment partner's page. Card and local payment methods accepted.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${accent ? 'text-emerald-300' : ''}`}>
      <dt className={accent ? '' : 'text-zinc-400'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
