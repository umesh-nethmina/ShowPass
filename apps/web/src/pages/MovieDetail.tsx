import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Movie, ShowtimesResponse } from '../lib/types';
import { FORMAT_LABEL, dateLong, dayLabel, duration, time } from '../lib/format';
import { Alert, Empty, Spinner, Stars } from '../components/ui';

const AVAIL = {
  AVAILABLE: { label: 'Available', cls: 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10' },
  FILLING_FAST: { label: 'Filling fast', cls: 'border-amber-500/50 text-amber-300 hover:bg-amber-500/10' },
  SOLD_OUT: { label: 'Sold out', cls: 'border-ink-600 text-zinc-400 line-through pointer-events-none' },
};

export default function MovieDetail() {
  const { slug } = useParams();
  const movieQ = useQuery({ queryKey: ['movie', slug], queryFn: () => api.get<{ movie: Movie }>(`/movies/${slug}`) });
  const movie = movieQ.data?.movie;
  const [date, setDate] = useState<string | undefined>();
  const [cinemaId, setCinemaId] = useState('');
  const showtimes = useQuery({
    queryKey: ['showtimes', movie?.id, date, cinemaId],
    queryFn: () => api.get<ShowtimesResponse>(`/movies/${movie!.id}/showtimes${qs({ date, cinemaId })}`),
    enabled: !!movie && movie.status === 'NOW_SHOWING',
    refetchInterval: 60_000,
  });
  const [showTrailer, setShowTrailer] = useState(false);

  if (movieQ.isLoading) return <Spinner />;
  if (movieQ.error || !movie) return <div className="container-page py-12"><Alert>{errorMessage(movieQ.error) || 'Movie not found'}</Alert></div>;

  const st = showtimes.data;
  return (
    <>
      <section className="relative overflow-hidden border-b border-ink-700">
        {movie.backdropUrl && <img src={movie.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/80 to-ink-900/40" />
        <div className="container-page relative grid grid-cols-1 gap-6 py-10 sm:grid-cols-[200px_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)]">
          <img src={movie.posterUrl} alt={`${movie.title} poster`} className="mx-auto w-48 rounded-xl shadow-2xl sm:mx-0 sm:w-full" />
          <div>
            <h1 className="font-display text-5xl tracking-wide sm:text-6xl">{movie.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
              <span className="chip border-gold-400/60 text-gold-400">{movie.ageRating}</span>
              <span>{movie.language}</span>·<span>{duration(movie.durationMin)}</span>·<span>{movie.genres.join(', ')}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{movie.status === 'COMING_SOON' ? 'Releases' : 'Released'} {dateLong(movie.releaseDate)}</p>
            {movie.rating?.avg != null && (
              <p className="mt-2 flex items-center gap-2 text-sm">
                <Stars value={movie.rating.avg} /> <span className="text-zinc-400">{movie.rating.avg.toFixed(1)} from {movie.rating.count} review(s)</span>
              </p>
            )}
            <p className="mt-4 max-w-2xl leading-relaxed text-zinc-200">{movie.synopsis}</p>
            {movie.cast.length > 0 && (
              <p className="mt-3 text-sm text-zinc-400">
                <span className="font-semibold text-zinc-300">Cast:</span> {movie.cast.join(', ')}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              {movie.status === 'NOW_SHOWING' && (
                <a href="#showtimes" className="btn-primary">
                  Book tickets
                </a>
              )}
              {movie.trailerUrl && (
                <button className="btn-secondary" onClick={() => setShowTrailer((s) => !s)} aria-expanded={showTrailer}>
                  ▶ {showTrailer ? 'Hide trailer' : 'Watch trailer'}
                </button>
              )}
              {movie.status === 'COMING_SOON' && <WatchlistButton movieId={movie.id} />}
            </div>
          </div>
        </div>
        {showTrailer && movie.trailerUrl && (
          <div className="container-page relative pb-8">
            <div className="aspect-video overflow-hidden rounded-xl border border-ink-700">
              <iframe
                src={movie.trailerUrl}
                title={`${movie.title} trailer`}
                className="h-full w-full"
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        )}
      </section>

      {movie.status === 'NOW_SHOWING' && (
        <section id="showtimes" className="container-page scroll-mt-20 py-8" aria-labelledby="st-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="st-heading" className="font-display text-3xl tracking-wide">
              Showtimes
            </h2>
            <CinemaFilter value={cinemaId} onChange={setCinemaId} />
          </div>
          {showtimes.isLoading ? (
            <Spinner label="Loading showtimes" />
          ) : !st?.dates.length ? (
            <div className="mt-4">
              <Empty title="No upcoming showtimes">Check back soon.</Empty>
            </div>
          ) : (
            <>
              <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Choose a date">
                {st.dates.map((d) => {
                  const l = dayLabel(d);
                  const active = d === st.date;
                  return (
                    <button
                      key={d}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setDate(d)}
                      className={`flex min-w-[72px] flex-col items-center rounded-xl border px-3 py-2 ${active ? 'border-gold-400 bg-gold-400 text-ink-950' : 'border-ink-600 bg-ink-850 hover:border-ink-500'}`}
                    >
                      <span className="text-xs font-semibold uppercase">{l.top}</span>
                      <span className="text-sm font-bold">{l.bottom}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 space-y-4">
                {st.cinemas.length === 0 && <Empty title="No shows at this cinema on this date" />}
                {st.cinemas.map(({ cinema, shows }) => (
                  <div key={cinema.id} className="card p-4">
                    <h3 className="font-semibold">{cinema.name}</h3>
                    <p className="text-xs text-zinc-400">{cinema.address}</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {shows.map((s) => {
                        const inner = (
                          <>
                            <span className="text-base font-bold">{time(s.startTime)}</span>
                            <span className="text-[11px] text-zinc-400">
                              {s.screen.name} · {FORMAT_LABEL[s.screen.format]} · {s.language}
                            </span>
                            <span className="text-[11px]">{AVAIL[s.availability].label}</span>
                          </>
                        );
                        const cls = `flex flex-col items-center rounded-lg border px-4 py-2 text-center ${AVAIL[s.availability].cls}`;
                        return (
                          <li key={s.id}>
                            {s.availability === 'SOLD_OUT' ? (
                              <span className={cls}>
                                {inner}
                              </span>
                            ) : (
                              <Link to={`/shows/${s.id}`} className={cls}>
                                {inner}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                <span className="text-emerald-300">Available</span> · <span className="text-amber-300">Filling fast</span> · <span className="text-zinc-400">Sold out</span>
              </p>
            </>
          )}
        </section>
      )}

      <Reviews movie={movie} />
    </>
  );
}

function CinemaFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ cinemas: { id: string; name: string }[] }>('/movies/meta'), staleTime: 300_000 });
  return (
    <div className="sm:w-64">
      <label htmlFor="cinema" className="sr-only">
        Cinema
      </label>
      <select id="cinema" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All cinemas</option>
        {meta.data?.cinemas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function WatchlistButton({ movieId }: { movieId: string }) {
  const { user } = useAuth();
  const [added, setAdded] = useState(false);
  const m = useMutation({ mutationFn: () => api.post(`/movies/${movieId}/watchlist`), onSuccess: () => setAdded(true) });
  if (!user) return <Link to="/login" className="btn-secondary">Log in to get notified</Link>;
  return (
    <button className="btn-secondary" disabled={added || m.isPending} onClick={() => m.mutate()}>
      {added ? '✓ On your watchlist' : '+ Notify me when booking opens'}
    </button>
  );
}

function Reviews({ movie }: { movie: Movie }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/movies/${movie.id}/reviews`, { rating, comment: comment || undefined }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['movie', movie.slug] });
    },
  });
  if (movie.status === 'COMING_SOON') return null;
  return (
    <section className="container-page py-8" aria-labelledby="rev-heading">
      <h2 id="rev-heading" className="font-display text-3xl tracking-wide">
        Reviews
      </h2>
      {user && (
        <form
          className="card mt-4 space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <fieldset>
            <legend className="label">Your rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={rating === n} className={`text-2xl ${n <= rating ? 'text-gold-400' : 'text-zinc-400'}`}>
                  {n <= rating ? '★' : '☆'}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor="review" className="label">
            Comment (optional)
          </label>
          <textarea id="review" className="input min-h-[80px]" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          {m.error && <Alert>{errorMessage(m.error)}</Alert>}
          {m.isSuccess && <Alert kind="success">Thanks for your review!</Alert>}
          <button className="btn-primary" disabled={m.isPending}>
            Post review
          </button>
          <p className="text-xs text-zinc-400">You can review a movie after you have watched it with a ShowPass ticket.</p>
        </form>
      )}
      <ul className="mt-4 space-y-3">
        {movie.reviews.length === 0 && <li className="text-sm text-zinc-400">No reviews yet.</li>}
        {movie.reviews.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{r.user.name}</span>
              <Stars value={r.rating} />
            </div>
            {r.comment && <p className="mt-2 text-sm text-zinc-300">{r.comment}</p>}
            <p className="mt-1 text-xs text-zinc-400">{dateLong(r.createdAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
