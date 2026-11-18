import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../../lib/api';
import type { MovieStatus } from '../../lib/types';
import { dateLong, duration } from '../../lib/format';
import { Alert, Field, Select, Spinner } from '../../components/ui';
import { AdminTitle } from './AdminLayout';

interface AdminMovie {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  durationMin: number;
  language: string;
  genres: string[];
  cast: string[];
  ageRating: string;
  releaseDate: string;
  posterUrl: string;
  backdropUrl: string | null;
  trailerUrl: string | null;
  status: MovieStatus;
}

const blank = {
  title: '',
  synopsis: '',
  durationMin: '120',
  language: 'English',
  genres: '',
  cast: '',
  ageRating: 'PG',
  releaseDate: new Date().toISOString().slice(0, 10),
  posterUrl: '',
  backdropUrl: '',
  trailerUrl: '',
  status: 'COMING_SOON' as MovieStatus,
};
type Form = typeof blank;

const toForm = (m: AdminMovie): Form => ({
  ...m,
  durationMin: String(m.durationMin),
  genres: m.genres.join(', '),
  cast: m.cast.join(', '),
  releaseDate: m.releaseDate.slice(0, 10),
  backdropUrl: m.backdropUrl ?? '',
  trailerUrl: m.trailerUrl ?? '',
});

/** Converts a YouTube watch/share link into an embeddable URL. */
function embedUrl(u: string) {
  const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : u;
}

const STATUS_LABEL: Record<MovieStatus, string> = { NOW_SHOWING: 'Now showing', COMING_SOON: 'Coming soon', ARCHIVED: 'Archived' };

export default function Movies() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'movies'], queryFn: () => api.get<{ movies: AdminMovie[] }>('/admin/movies') });
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (e: { id: string | null; form: Form }) => {
      const f = e.form;
      const body = {
        ...f,
        durationMin: Number(f.durationMin),
        genres: f.genres.split(',').map((s) => s.trim()).filter(Boolean),
        cast: f.cast.split(',').map((s) => s.trim()).filter(Boolean),
        backdropUrl: f.backdropUrl || null,
        trailerUrl: f.trailerUrl ? embedUrl(f.trailerUrl) : null,
      };
      return e.id ? api.patch(`/admin/movies/${e.id}`, body) : api.post('/admin/movies', body);
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'movies'] });
    },
    onError: (err) => setFieldErrors(err instanceof ApiError ? err.fieldErrors : {}),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MovieStatus }) => api.patch(`/admin/movies/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'movies'] }),
  });

  if (isLoading) return <Spinner />;

  if (editing) {
    const f = editing.form;
    const bind = (k: keyof Form) => ({
      value: f[k],
      error: fieldErrors[k],
      onChange: (e: { target: { value: string } }) => setEditing({ ...editing, form: { ...f, [k]: e.target.value } }),
    });
    return (
      <>
        <AdminTitle>{editing.id ? 'Edit movie' : 'Add movie'}</AdminTitle>
        <form
          className="card grid gap-4 p-5 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            save.mutate(editing);
          }}
        >
          {save.error && <div className="md:col-span-2"><Alert>{errorMessage(save.error)}</Alert></div>}
          <Field label="Title" required {...bind('title')} />
          <Select label="Status" value={f.status} onChange={(e) => setEditing({ ...editing, form: { ...f, status: e.target.value as MovieStatus } })}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <div className="md:col-span-2">
            <label htmlFor="synopsis" className="label">
              Synopsis
            </label>
            <textarea id="synopsis" className="input min-h-[100px]" required value={f.synopsis} onChange={bind('synopsis').onChange} />
          </div>
          <Field label="Duration (minutes)" type="number" min={1} required {...bind('durationMin')} />
          <Field label="Language" required {...bind('language')} />
          <Field label="Genres" hint="Comma separated" {...bind('genres')} />
          <Field label="Age rating" required hint="e.g. G, PG, PG-13, R" {...bind('ageRating')} />
          <Field label="Cast" hint="Comma separated" {...bind('cast')} />
          <Field label="Release date" type="date" required {...bind('releaseDate')} />
          <Field label="Poster URL" type="url" required {...bind('posterUrl')} />
          <Field label="Backdrop URL" type="url" {...bind('backdropUrl')} />
          <Field label="Trailer URL" type="url" hint="YouTube link or embed URL" {...bind('trailerUrl')} />
          <div className="flex items-end gap-2 md:col-span-2">
            <button className="btn-primary" disabled={save.isPending}>
              Save movie
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <AdminTitle
        actions={
          <button className="btn-primary" onClick={() => setEditing({ id: null, form: blank })}>
            + Add movie
          </button>
        }
      >
        Movies
      </AdminTitle>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Movie</th>
              <th>Details</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.movies.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <img src={m.posterUrl} alt="" className="h-14 w-10 rounded object-cover" />
                    <span className="font-semibold">{m.title}</span>
                  </div>
                </td>
                <td className="text-zinc-400">
                  {m.language} · {duration(m.durationMin)} · {m.ageRating}
                  <br />
                  {dateLong(m.releaseDate)}
                </td>
                <td>
                  <select
                    aria-label={`Status of ${m.title}`}
                    className="input min-h-[36px] py-1"
                    value={m.status}
                    onChange={(e) => setStatus.mutate({ id: m.id, status: e.target.value as MovieStatus })}
                  >
                    {Object.entries(STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right">
                  <button className="btn-secondary btn-sm" onClick={() => setEditing({ id: m.id, form: toForm(m) })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
