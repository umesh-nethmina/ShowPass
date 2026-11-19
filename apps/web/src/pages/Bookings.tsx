import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { Booking } from '../lib/types';
import { FORMAT_LABEL, dateTime, money } from '../lib/format';
import { Alert, Empty, PageTitle, Spinner, StatusBadge } from '../components/ui';

export function MyBookings() {
  const { data, isLoading, error } = useQuery({ queryKey: ['bookings'], queryFn: () => api.get<{ bookings: Booking[] }>('/bookings') });
  if (isLoading) return <Spinner />;
  if (error) return <div className="container-page py-12"><Alert>{errorMessage(error)}</Alert></div>;
  const now = Date.now();
  const list = data?.bookings ?? [];
  const upcoming = list.filter((b) => b.status === 'CONFIRMED' && new Date(b.show.startTime).getTime() > now - 3 * 3600_000).reverse();
  const past = list.filter((b) => !upcoming.includes(b));
  return (
    <div className="container-page py-8">
      <PageTitle>My bookings</PageTitle>
      {list.length === 0 && (
        <Empty title="No bookings yet">
          <Link to="/" className="btn-primary mt-4">
            Browse movies
          </Link>
        </Empty>
      )}
      {upcoming.length > 0 && <BookingList title="Upcoming" bookings={upcoming} />}
      {past.length > 0 && <BookingList title="Past and cancelled" bookings={past} />}
    </div>
  );
}

function BookingList({ title, bookings }: { title: string; bookings: Booking[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-zinc-300">{title}</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {bookings.map((b) => (
          <li key={b.id}>
            <Link to={`/bookings/${b.id}`} className="card flex gap-4 p-4 hover:border-ink-500">
              <img src={b.show.movie.posterUrl} alt="" className="h-24 w-16 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-semibold">{b.show.movie.title}</p>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-sm text-gold-400">{dateTime(b.show.startTime)}</p>
                <p className="text-sm text-zinc-400">
                  {b.show.cinema.name} · {b.show.screen.name}
                </p>
                <p className="text-sm text-zinc-400">Seats {b.seats.map((s) => s.label).join(', ')}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['booking', id], queryFn: () => api.get<{ booking: Booking }>(`/bookings/${id}`) });
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api.post<{ booking: Booking }>(`/bookings/${id}/cancel`),
    onSuccess: (d) => {
      qc.setQueryData(['booking', id], d);
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setConfirming(false);
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <div className="container-page py-12"><Alert>{errorMessage(error)}</Alert></div>;
  const b = data.booking;
  const c = b.cancellation;

  return (
    <div className="container-page max-w-xl py-8">
      <Link to="/bookings" className="text-sm text-zinc-400 hover:text-white">
        ← My bookings
      </Link>
      <article className="mt-3 overflow-hidden rounded-2xl border border-ink-700 bg-ink-800" aria-label="E-ticket">
        <div className="flex items-center justify-between bg-ink-950 px-5 py-3">
          <span className="font-display text-xl tracking-wider">
            Show<span className="text-gold-400">Pass</span>
          </span>
          <StatusBadge status={b.status} />
        </div>
        <div className="p-5">
          <h1 className="text-2xl font-bold">{b.show.movie.title}</h1>
          <p className="text-sm text-zinc-400">
            {b.show.movie.ageRating} · {FORMAT_LABEL[b.show.screen.format]} · {b.show.language}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Info label="Date & time" value={dateTime(b.show.startTime)} wide />
            <Info label="Cinema" value={b.show.cinema.name} />
            <Info label="Screen" value={b.show.screen.name} />
            <Info label="Seats" value={b.seats.map((s) => s.label).join(', ')} />
            {b.items.length > 0 && <Info label="Food & drinks" value={b.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')} wide />}
            <Info label="Booking ID" value={b.reference} />
            <Info label="Total paid" value={money(b.totalCents, b.currency)} />
            {b.refundCents != null && <Info label="Refund" value={money(b.refundCents, b.currency)} />}
          </dl>
        </div>
        {b.status === 'CONFIRMED' && b.qrToken && (
          <div className="border-t border-dashed border-ink-600 bg-white p-6 text-center">
            <img src={`/api/bookings/${b.id}/qr.svg`} alt={`QR code for booking ${b.reference}`} className="mx-auto h-56 w-56" />
            <p className="mt-2 text-sm text-zinc-700">{b.checkedInAt ? 'This ticket has been used.' : 'Show this code at the entrance. Valid for one entry.'}</p>
          </div>
        )}
      </article>

      <div className="mt-4 flex flex-wrap gap-2">
        {b.status !== 'PENDING' && (
          <a href={`/api/bookings/${b.id}/ticket.pdf`} className="btn-primary" download>
            Download PDF
          </a>
        )}
        <a href={`https://maps.google.com/?q=${encodeURIComponent(b.show.cinema.address)}`} target="_blank" rel="noreferrer" className="btn-secondary">
          Directions
        </a>
      </div>

      {b.status === 'CONFIRMED' && (
        <section className="card mt-6 p-4" aria-labelledby="cancel-heading">
          <h2 id="cancel-heading" className="font-semibold">
            Cancel booking
          </h2>
          {c.allowed ? (
            <>
              <p className="mt-1 text-sm text-zinc-400">
                You can cancel up to {Math.round(c.cutoffMinutes / 60)} hours before the show. Refund now: <span className="font-semibold text-white">{money(c.refundCents, b.currency)}</span> ({c.refundPercent}%).
              </p>
              {cancel.error && <div className="mt-2"><Alert>{errorMessage(cancel.error)}</Alert></div>}
              {confirming ? (
                <div className="mt-3 flex gap-2">
                  <button className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    {cancel.isPending ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                  <button className="btn-ghost" onClick={() => setConfirming(false)}>
                    Keep booking
                  </button>
                </div>
              ) : (
                <button className="btn-secondary mt-3" onClick={() => setConfirming(true)}>
                  Cancel booking
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">This booking can no longer be cancelled online. Bookings can be cancelled up to {Math.round(c.cutoffMinutes / 60)} hours before the show.</p>
          )}
        </section>
      )}
      {(b.status === 'CANCELLED' || b.status === 'REFUNDED') && (
        <div className="mt-4">
          <Alert kind="info">
            This booking was cancelled{b.refundCents ? ` and ${money(b.refundCents, b.currency)} ${b.status === 'REFUNDED' ? 'has been refunded' : 'will be refunded'}` : ''}. Refunds can take 5–7 working days to appear.
          </Alert>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
