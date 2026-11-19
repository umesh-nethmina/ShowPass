import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { BookingStatus, MovieSummary } from '../lib/types';
import { duration } from '../lib/format';

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} {...props} />
      {(error || hint) && (
        <p id={`${id}-msg`} className={`mt-1 text-xs ${error ? 'text-red-400' : 'text-zinc-400'}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input" {...props}>
        {children}
      </select>
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500/40 bg-red-500/10 text-red-200',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-gold-400" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-zinc-400">{children}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  CONFIRMED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/30',
  EXPIRED: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  CANCELLED: 'bg-red-500/15 text-red-300 border-red-500/30',
  REFUNDED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  return (
    <span className={`text-gold-400 ${size === 'lg' ? 'text-xl' : 'text-sm'}`} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {'★'.repeat(Math.round(value))}
      <span className="text-zinc-400">{'☆'.repeat(5 - Math.round(value))}</span>
    </span>
  );
}

export function MovieCard({ movie }: { movie: MovieSummary }) {
  const [broken, setBroken] = useState(false);
  return (
    <Link to={`/movies/${movie.slug}`} className="group block focus-visible:rounded-xl">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-800">
        {broken ? (
          <div className="flex h-full w-full items-end bg-gradient-to-br from-ink-700 to-ink-900 p-3" aria-hidden>
            <span className="font-display text-2xl leading-none tracking-wide text-zinc-300">{movie.title}</span>
          </div>
        ) : (
          <img src={movie.posterUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        )}
        <span className="absolute left-2 top-2 rounded bg-ink-950/80 px-1.5 py-0.5 text-[11px] font-bold">{movie.ageRating}</span>
        {movie.rating?.avg != null && (
          <span className="absolute right-2 top-2 rounded bg-ink-950/80 px-1.5 py-0.5 text-[11px] font-bold text-gold-400">★ {movie.rating.avg.toFixed(1)}</span>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 font-semibold leading-snug group-hover:text-gold-400">{movie.title}</h3>
      <p className="text-xs text-zinc-400">
        {movie.language} · {duration(movie.durationMin)}
      </p>
      <p className="text-xs text-zinc-400">{movie.genres.join(', ')}</p>
    </Link>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-4xl tracking-wide sm:text-5xl">{children}</h1>
      {sub && <p className="mt-1 text-zinc-400">{sub}</p>}
    </div>
  );
}
