import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs } from '../../lib/api';
import { FORMAT_LABEL, dateLong, time, todayKey } from '../../lib/format';
import { Alert, Empty, Field, Select, Spinner } from '../../components/ui';
import { AdminTitle, useCinemas } from './AdminLayout';

interface AdminShow {
  id: string;
  startTime: string;
  endTime: string;
  language: string;
  status: 'SCHEDULED' | 'CANCELLED';
  capacity: number;
  booked: number;
  movie: { id: string; title: string; durationMin: number };
  screen: { id: string; name: string; format: 'TWO_D' | 'THREE_D' | 'IMAX'; cinema: { id: string; name: string } };
}

export default function Shows() {
  const qc = useQueryClient();
  const cinemas = useCinemas();
  const movies = useQuery({ queryKey: ['admin', 'movies'], queryFn: () => api.get<{ movies: { id: string; title: string; language: string; status: string }[] }>('/admin/movies') });
  const [cinemaId, setCinemaId] = useState('');
  const [from, setFrom] = useState(todayKey());
  const shows = useQuery({
    queryKey: ['admin', 'shows', cinemaId, from],
    queryFn: () => api.get<{ shows: AdminShow[] }>(`/admin/shows${qs({ cinemaId, from, days: 7 })}`),
  });

  const screens = useMemo(() => (cinemas.data?.cinemas ?? []).flatMap((c) => c.screens.map((s) => ({ ...s, cinemaName: c.name }))), [cinemas.data]);
  const [form, setForm] = useState({ movieId: '', screenId: '', language: '', date: todayKey(), times: '10:00, 13:30, 17:00, 20:30' });
  const [result, setResult] = useState<string | null>(null);

  const schedule = useMutation({
    mutationFn: () => {
      const startTimes = form.times
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((t) => `${form.date}T${t.padStart(5, '0')}:00`); // cinema-local time, interpreted by the API
      const movie = movies.data?.movies.find((m) => m.id === form.movieId);
      return api.post<{ shows: unknown[] }>('/admin/shows', { movieId: form.movieId, screenId: form.screenId, language: form.language || movie?.language || 'English', startTimes });
    },
    onSuccess: (d) => {
      setResult(`${d.shows.length} show(s) scheduled.`);
      qc.invalidateQueries({ queryKey: ['admin', 'shows'] });
    },
    onError: () => setResult(null),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ bookingsCancelled: number }>(`/admin/shows/${id}/cancel`),
    onSuccess: (d) => {
      setResult(`Show cancelled. ${d.bookingsCancelled} booking(s) cancelled and refunded in full.`);
      qc.invalidateQueries({ queryKey: ['admin', 'shows'] });
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, AdminShow[]>();
    for (const s of shows.data?.shows ?? []) {
      const k = dateLong(s.startTime);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [shows.data]);

  return (
    <>
      <AdminTitle>Showtimes</AdminTitle>
      <form
        className="card grid gap-4 p-5 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          schedule.mutate();
        }}
      >
        <h2 className="font-semibold md:col-span-3">Schedule shows</h2>
        <Select label="Movie" required value={form.movieId} onChange={(e) => setForm({ ...form, movieId: e.target.value })}>
          <option value="">Choose a movie…</option>
          {movies.data?.movies
            .filter((m) => m.status !== 'ARCHIVED')
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
        </Select>
        <Select label="Screen" required value={form.screenId} onChange={(e) => setForm({ ...form, screenId: e.target.value })}>
          <option value="">Choose a screen…</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.cinemaName} – {s.name} ({FORMAT_LABEL[s.format]})
            </option>
          ))}
        </Select>
        <Field label="Language" placeholder="Defaults to the movie's language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
        <Field label="Date" type="date" required value={form.date} min={todayKey()} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Field label="Start times" required hint="24-hour times, separated by commas" value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} />
        <div className="flex items-end">
          <button className="btn-primary" disabled={schedule.isPending}>
            Schedule
          </button>
        </div>
        {schedule.error && <div className="md:col-span-3"><Alert>{errorMessage(schedule.error)}</Alert></div>}
        <p className="text-xs text-zinc-500 md:col-span-3">Each show blocks the screen for the movie's running time plus 15 minutes for cleaning. Overlapping shows are rejected.</p>
      </form>

      {result && <div className="mt-4"><Alert kind="success">{result}</Alert></div>}
      {cancel.error && <div className="mt-4"><Alert>{errorMessage(cancel.error)}</Alert></div>}

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="w-56">
          <Select label="Cinema" value={cinemaId} onChange={(e) => setCinemaId(e.target.value)}>
            <option value="">All cinemas</option>
            {cinemas.data?.cinemas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Field label="Week starting" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 space-y-6">
        {shows.isLoading && <Spinner />}
        {!shows.isLoading && grouped.length === 0 && <Empty title="No shows in this week" />}
        {grouped.map(([day, list]) => (
          <section key={day}>
            <h3 className="mb-2 font-semibold text-zinc-300">{day}</h3>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Movie</th>
                    <th>Screen</th>
                    <th>Sold</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className={s.status === 'CANCELLED' ? 'opacity-50' : ''}>
                      <td className="whitespace-nowrap font-semibold">
                        {time(s.startTime)}–{time(s.endTime)}
                      </td>
                      <td>
                        {s.movie.title}
                        <span className="text-zinc-500"> · {s.language}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {s.screen.cinema.name} – {s.screen.name}
                      </td>
                      <td className="tabular-nums">
                        {s.booked}/{s.capacity}
                      </td>
                      <td className="text-right">
                        {s.status === 'CANCELLED' ? (
                          <span className="text-xs text-red-400">Cancelled</span>
                        ) : (
                          new Date(s.startTime) > new Date() && (
                            <button
                              className="btn-ghost btn-sm text-red-400"
                              disabled={cancel.isPending}
                              onClick={() => {
                                if (confirm(`Cancel ${s.movie.title} at ${time(s.startTime)}? ${s.booked} booked seat(s) will be refunded in full.`)) cancel.mutate(s.id);
                              }}
                            >
                              Cancel show
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
