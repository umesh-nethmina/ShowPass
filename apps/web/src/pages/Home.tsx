import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { MovieSummary } from '../lib/types';
import { FORMAT_LABEL, duration } from '../lib/format';
import { Empty, MovieCard, Spinner } from '../components/ui';

interface Meta {
  genres: string[];
  languages: string[];
  formats: ('TWO_D' | 'THREE_D' | 'IMAX')[];
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') === 'COMING_SOON' ? 'COMING_SOON' : 'NOW_SHOWING';
  const filters = { q: params.get('q') ?? '', genre: params.get('genre') ?? '', language: params.get('language') ?? '', format: params.get('format') ?? '', date: params.get('date') ?? '' };
  const [search, setSearch] = useState(filters.q);

  // Debounce the title search into the URL (FR-2.3)
  useEffect(() => {
    const t = setTimeout(() => update('q', search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(key: string, value: string) {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value) n.set(key, value);
        else n.delete(key);
        return n;
      },
      { replace: true },
    );
  }

  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/movies/meta'), staleTime: 300_000 });
  const movies = useQuery({
    queryKey: ['movies', status, filters],
    queryFn: () => api.get<{ movies: MovieSummary[] }>(`/movies${qs({ status, ...filters })}`),
  });
  const featured = useQuery({
    queryKey: ['movies', 'featured'],
    queryFn: () => api.get<{ movies: MovieSummary[] }>('/movies?status=NOW_SHOWING'),
    staleTime: 300_000,
  });
  const hero = featured.data?.movies[0];
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      {hero && (
        <section className="relative overflow-hidden border-b border-ink-700">
          <img src={hero.backdropUrl ?? hero.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/70 to-transparent" />
          <div className="container-page relative py-16 sm:py-24">
            <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">Now showing</p>
            <h1 className="mt-2 max-w-2xl font-display text-5xl tracking-wide sm:text-7xl">{hero.title}</h1>
            <p className="mt-2 text-zinc-300">
              {hero.ageRating} · {hero.language} · {duration(hero.durationMin)} · {hero.genres.join(', ')}
            </p>
            <Link to={`/movies/${hero.slug}`} className="btn-primary mt-6">
              Book tickets
            </Link>
          </div>
        </section>
      )}

      <section className="container-page py-8" aria-labelledby="movies-heading">
        <h2 id="movies-heading" className="sr-only">
          Movies
        </h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div role="tablist" aria-label="Movie lists" className="inline-flex rounded-xl border border-ink-700 bg-ink-850 p-1">
            {(['NOW_SHOWING', 'COMING_SOON'] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={status === s}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${status === s ? 'bg-gold-400 text-ink-950' : 'text-zinc-300 hover:text-white'}`}
                onClick={() => update('status', s === 'NOW_SHOWING' ? '' : s)}
              >
                {s === 'NOW_SHOWING' ? 'Now Showing' : 'Coming Soon'}
              </button>
            ))}
          </div>
          <div className="w-full lg:max-w-xs">
            <label htmlFor="search" className="sr-only">
              Search movies by title
            </label>
            <input id="search" type="search" className="input" placeholder="Search movies…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <FilterSelect label="Genre" value={filters.genre} onChange={(v) => update('genre', v)} options={(meta.data?.genres ?? []).map((g) => [g, g])} />
          <FilterSelect label="Language" value={filters.language} onChange={(v) => update('language', v)} options={(meta.data?.languages ?? []).map((l) => [l, l])} />
          <FilterSelect label="Format" value={filters.format} onChange={(v) => update('format', v)} options={(meta.data?.formats ?? []).map((f) => [f, FORMAT_LABEL[f]])} />
          <div>
            <label htmlFor="f-date" className="sr-only">
              Date
            </label>
            <input id="f-date" type="date" className="input" value={filters.date} onChange={(e) => update('date', e.target.value)} />
          </div>
        </div>
        {hasFilters && (
          <button className="btn-ghost btn-sm mt-2" onClick={() => { setSearch(''); setParams(status === 'COMING_SOON' ? { status } : {}); }}>
            Clear filters
          </button>
        )}

        <div className="mt-6">
          {movies.isLoading ? (
            <Spinner label="Loading movies" />
          ) : !movies.data?.movies.length ? (
            <Empty title="No movies found">Try a different search or clear the filters.</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {movies.data.movies.map((m) => (
                <li key={m.id}>
                  <MovieCard movie={m} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="sr-only" htmlFor={`f-${label}`}>
        {label}
      </label>
      <select id={`f-${label}`} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All {label.toLowerCase()}s</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
