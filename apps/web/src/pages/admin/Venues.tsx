import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ScreenFormat, SeatCategory } from '../../lib/types';
import { CATEGORY_LABEL, FORMAT_LABEL, money } from '../../lib/format';
import { Alert, Field, Select, Spinner } from '../../components/ui';
import { AdminTitle, useCinemas } from './AdminLayout';

/* ---------------- cinemas ---------------- */

export function Cinemas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useCinemas();
  const [form, setForm] = useState<{ name: string; address: string; city: string; contact: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api.post('/admin/cinemas', form),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ['admin', 'cinemas'] });
    },
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <AdminTitle
        actions={
          user?.role === 'SUPER_ADMIN' && !form && (
            <button className="btn-primary" onClick={() => setForm({ name: '', address: '', city: '', contact: '' })}>
              + Add cinema
            </button>
          )
        }
      >
        Cinemas & screens
      </AdminTitle>
      {form && (
        <form
          className="card mb-6 grid gap-4 p-5 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {create.error && <div className="md:col-span-2"><Alert>{errorMessage(create.error)}</Alert></div>}
          {(['name', 'address', 'city', 'contact'] as const).map((k) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)} required value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          ))}
          <div className="flex gap-2 md:col-span-2">
            <button className="btn-primary" disabled={create.isPending}>
              Save cinema
            </button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="space-y-4">
        {data?.cinemas.map((c) => (
          <section key={c.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <p className="text-sm text-zinc-400">
                  {c.address} · {c.contact}
                </p>
              </div>
              <Link to={`/admin/cinemas/${c.id}/screens/new`} className="btn-secondary btn-sm">
                + Add screen
              </Link>
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {c.screens.map((s) => (
                <li key={s.id}>
                  <Link to={`/admin/screens/${s.id}`} className="block rounded-lg border border-ink-600 p-3 hover:border-gold-400">
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-zinc-400">
                      {FORMAT_LABEL[s.format]} · {s._count.seats} seats · edit layout →
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/* ---------------- seat layout editor ---------------- */

type Tool = SeatCategory | 'ERASE';
const TOOL_STYLE: Record<Tool, string> = {
  STANDARD: 'border-seat-standard bg-seat-standard/30',
  PREMIUM: 'border-seat-premium bg-seat-premium/30',
  RECLINER: 'border-seat-recliner bg-seat-recliner/30',
  ERASE: 'border-ink-600 bg-transparent',
};

interface LayoutSeat {
  gridRow: number;
  gridCol: number;
  rowLabel: string;
  seatNumber: number;
  category: SeatCategory;
}

/** Rows that contain seats are lettered A, B, C… from the screen; seats are numbered left to right. */
function labelSeats(cells: Map<string, SeatCategory>, rows: number, cols: number): LayoutSeat[] {
  const out: LayoutSeat[] = [];
  let rowIdx = 0;
  for (let r = 0; r < rows; r++) {
    const rowSeats: LayoutSeat[] = [];
    for (let c = 0; c < cols; c++) {
      const cat = cells.get(`${r}:${c}`);
      if (cat) rowSeats.push({ gridRow: r, gridCol: c, rowLabel: '', seatNumber: rowSeats.length + 1, category: cat });
    }
    if (!rowSeats.length) continue;
    const label = rowIdx < 26 ? String.fromCharCode(65 + rowIdx) : `A${String.fromCharCode(65 + rowIdx - 26)}`;
    rowIdx++;
    rowSeats.forEach((s) => (s.rowLabel = label));
    out.push(...rowSeats);
  }
  return out;
}

export function ScreenEditor() {
  const { screenId, cinemaId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = !screenId;
  const existing = useQuery({
    queryKey: ['admin', 'screen', screenId],
    queryFn: () => api.get<{ screen: { id: string; cinemaId: string; name: string; format: ScreenFormat; gridRows: number; gridCols: number; seats: LayoutSeat[] } }>(`/admin/screens/${screenId}`),
    enabled: !isNew,
  });
  const [name, setName] = useState('');
  const [format, setFormat] = useState<ScreenFormat>('TWO_D');
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(14);
  const [cells, setCells] = useState<Map<string, SeatCategory>>(new Map());
  const [tool, setTool] = useState<Tool>('STANDARD');
  const [painting, setPainting] = useState(false);

  useEffect(() => {
    const s = existing.data?.screen;
    if (!s) return;
    setName(s.name);
    setFormat(s.format);
    setRows(s.gridRows);
    setCols(s.gridCols);
    setCells(new Map(s.seats.map((x) => [`${x.gridRow}:${x.gridCol}`, x.category])));
  }, [existing.data]);

  const seats = useMemo(() => labelSeats(cells, rows, cols), [cells, rows, cols]);
  const byPos = useMemo(() => new Map(seats.map((s) => [`${s.gridRow}:${s.gridCol}`, s])), [seats]);

  const paint = (key: string) =>
    setCells((prev) => {
      const next = new Map(prev);
      if (tool === 'ERASE') next.delete(key);
      else next.set(key, tool);
      return next;
    });

  const fillAll = () => {
    const next = new Map<string, SeatCategory>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (tool !== 'ERASE') next.set(`${r}:${c}`, tool);
    setCells(next);
  };
  const fillRow = (r: number) =>
    setCells((prev) => {
      const next = new Map(prev);
      for (let c = 0; c < cols; c++) {
        if (tool === 'ERASE') next.delete(`${r}:${c}`);
        else next.set(`${r}:${c}`, tool);
      }
      return next;
    });
  const clearCol = (c: number) =>
    setCells((prev) => {
      const next = new Map(prev);
      for (let r = 0; r < rows; r++) next.delete(`${r}:${c}`);
      return next;
    });

  const save = useMutation({
    mutationFn: () => {
      const body = { name, format, gridRows: rows, gridCols: cols, seats: seats.filter((s) => s.gridRow < rows && s.gridCol < cols) };
      return isNew ? api.post(`/admin/cinemas/${cinemaId}/screens`, body) : api.put(`/admin/screens/${screenId}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      navigate('/admin/cinemas');
    },
  });

  if (!isNew && existing.isLoading) return <Spinner />;
  const counts = seats.reduce<Record<string, number>>((a, s) => ((a[s.category] = (a[s.category] ?? 0) + 1), a), {});

  return (
    <>
      <AdminTitle>{isNew ? 'New screen' : `Edit ${name}`}</AdminTitle>
      <div className="card grid gap-4 p-5 sm:grid-cols-4">
        <Field label="Screen name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as ScreenFormat)}>
          {(['TWO_D', 'THREE_D', 'IMAX'] as const).map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </Select>
        <Field label="Grid rows" type="number" min={1} max={60} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
        <Field label="Grid columns" type="number" min={1} max={80} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(80, Number(e.target.value) || 1)))} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Paint tool">
        {(['STANDARD', 'PREMIUM', 'RECLINER', 'ERASE'] as Tool[]).map((t) => (
          <button key={t} role="radio" aria-checked={tool === t} onClick={() => setTool(t)} className={`btn-sm btn rounded-lg border-2 ${TOOL_STYLE[t]} ${tool === t ? 'ring-2 ring-gold-400' : ''}`}>
            {t === 'ERASE' ? 'Aisle / no seat' : CATEGORY_LABEL[t]}
          </button>
        ))}
        <button className="btn-ghost btn-sm" onClick={fillAll}>
          Fill all with tool
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-400">Click or drag across cells to paint seats. Click a row letter to fill the row; click a column number to turn it into an aisle. Seats are labelled automatically.</p>

      <div className="card mt-4 overflow-x-auto p-4" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
        <div className="mx-auto mb-4 w-2/3 border-t-4 border-gold-400/60 pt-1 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-400">Screen</div>
        <div className="mx-auto w-max select-none">
          <div className="flex gap-1 pl-7">
            {Array.from({ length: cols }, (_, c) => (
              <button key={c} className="w-6 text-[9px] text-zinc-400 hover:text-red-400" title="Make this column an aisle" onClick={() => clearCol(c)}>
                {c + 1}
              </button>
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => {
            const label = seats.find((s) => s.gridRow === r)?.rowLabel ?? '';
            return (
              <div key={r} className="mt-1 flex items-center gap-1">
                <button className="w-6 text-xs text-zinc-400 hover:text-gold-400" title="Fill this row" onClick={() => fillRow(r)}>
                  {label || '·'}
                </button>
                {Array.from({ length: cols }, (_, c) => {
                  const key = `${r}:${c}`;
                  const seat = byPos.get(key);
                  return (
                    <div
                      key={c}
                      role="button"
                      tabIndex={0}
                      aria-label={seat ? `Row ${seat.rowLabel}, seat ${seat.seatNumber}, ${CATEGORY_LABEL[seat.category]}` : `Empty cell, row ${r + 1}, column ${c + 1}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setPainting(true);
                        paint(key);
                      }}
                      onPointerEnter={() => painting && paint(key)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && paint(key)}
                      className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded border text-[9px] ${seat ? TOOL_STYLE[seat.category] : 'border-dashed border-ink-600'}`}
                    >
                      {seat?.seatNumber}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {seats.length} seats ·{' '}
          {Object.entries(counts)
            .map(([k, v]) => `${v} ${CATEGORY_LABEL[k as SeatCategory].toLowerCase()}`)
            .join(', ')}
        </p>
        <div className="flex gap-2">
          <Link to="/admin/cinemas" className="btn-ghost">
            Cancel
          </Link>
          <button className="btn-primary" disabled={!name || !seats.length || save.isPending} onClick={() => save.mutate()}>
            Save layout
          </button>
        </div>
      </div>
      {save.error && <div className="mt-3"><Alert>{errorMessage(save.error)}</Alert></div>}
    </>
  );
}

/* ---------------- pricing ---------------- */

interface PriceRule {
  id: string;
  category: SeatCategory;
  priceCents: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  priority: number;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (m: number | null) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const toMin = (s: string) => {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export function Pricing() {
  const cinemas = useCinemas();
  const qc = useQueryClient();
  const [cinemaId, setCinemaId] = useState('');
  const cid = cinemaId || cinemas.data?.cinemas[0]?.id || '';
  const rules = useQuery({
    queryKey: ['admin', 'price-rules', cid],
    queryFn: () => api.get<{ priceRules: PriceRule[] }>(`/admin/cinemas/${cid}/price-rules`),
    enabled: !!cid,
  });
  const [form, setForm] = useState({ category: 'STANDARD' as SeatCategory, price: '', days: [] as number[], start: '', end: '', priority: '0' });
  const add = useMutation({
    mutationFn: () =>
      api.post(`/admin/cinemas/${cid}/price-rules`, {
        category: form.category,
        price: Number(form.price),
        daysOfWeek: form.days,
        startMinute: toMin(form.start),
        endMinute: toMin(form.end),
        priority: Number(form.priority),
      }),
    onSuccess: () => {
      setForm({ ...form, price: '' });
      qc.invalidateQueries({ queryKey: ['admin', 'price-rules', cid] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/price-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'price-rules', cid] }),
  });

  return (
    <>
      <AdminTitle>Pricing</AdminTitle>
      <div className="mb-4 max-w-xs">
        <Select label="Cinema" value={cid} onChange={(e) => setCinemaId(e.target.value)}>
          {cinemas.data?.cinemas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <Alert kind="info">Each new show takes the most specific matching price for each seat category. Prices of shows already scheduled do not change.</Alert>
      <div className="card mt-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Price</th>
              <th>Days</th>
              <th>Time</th>
              <th>Priority</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.data?.priceRules.map((r) => (
              <tr key={r.id}>
                <td>{CATEGORY_LABEL[r.category]}</td>
                <td className="tabular-nums">{money(r.priceCents)}</td>
                <td>{r.daysOfWeek.length ? r.daysOfWeek.map((d) => DAYS[d]).join(', ') : 'Every day'}</td>
                <td>{r.startMinute == null && r.endMinute == null ? 'All day' : `${hhmm(r.startMinute) || '00:00'}–${hhmm(r.endMinute) || '24:00'}`}</td>
                <td>{r.priority}</td>
                <td className="text-right">
                  <button className="btn-ghost btn-sm text-red-400" onClick={() => del.mutate(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="card mt-4 grid gap-4 p-5 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 className="font-semibold sm:col-span-3">Add price rule</h2>
        {add.error && <div className="sm:col-span-3"><Alert>{errorMessage(add.error)}</Alert></div>}
        <Select label="Seat category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SeatCategory })}>
          {(['STANDARD', 'PREMIUM', 'RECLINER'] as const).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Field label="Price (LKR)" type="number" min={0} step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <Field label="Priority" type="number" min={0} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} hint="Higher wins" />
        <fieldset className="sm:col-span-3">
          <legend className="label">Days (none = every day)</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="chip cursor-pointer gap-1.5">
                <input type="checkbox" checked={form.days.includes(i)} onChange={(e) => setForm({ ...form, days: e.target.checked ? [...form.days, i] : form.days.filter((x) => x !== i) })} />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="From time (optional)" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <Field label="Until time (optional)" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <div className="flex items-end">
          <button className="btn-primary" disabled={add.isPending || !form.price}>
            Add rule
          </button>
        </div>
      </form>
    </>
  );
}
