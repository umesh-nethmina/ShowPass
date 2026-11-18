import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Booking } from '../../lib/types';
import { dateLong, dateTime, money, todayKey } from '../../lib/format';
import { Alert, Empty, Field, Select, Spinner, StatusBadge } from '../../components/ui';
import { AdminTitle, useCinemas } from './AdminLayout';

/* ---------------- promo codes (FR-9.6) ---------------- */

interface Promo {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount: number | null;
  minAmount: number | null;
  validFrom: string;
  validTo: string;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

const emptyPromo = () => ({
  code: '',
  description: '',
  type: 'PERCENT' as 'PERCENT' | 'FIXED',
  value: '',
  maxDiscount: '',
  minAmount: '',
  validFrom: todayKey(),
  validTo: '',
  usageLimit: '',
  isActive: true,
});

export function PromoCodes() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'promos'], queryFn: () => api.get<{ promoCodes: Promo[] }>('/admin/promo-codes') });
  const [edit, setEdit] = useState<{ id: string | null; f: ReturnType<typeof emptyPromo> } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const f = edit!.f;
      const num = (v: string) => (v === '' ? null : Number(v));
      const body = {
        code: f.code,
        description: f.description || null,
        type: f.type,
        value: Number(f.value),
        maxDiscount: num(f.maxDiscount),
        minAmount: num(f.minAmount),
        validFrom: `${f.validFrom}T00:00:00`, // cinema-local, interpreted by the API
        validTo: `${f.validTo}T23:59:59`,
        usageLimit: num(f.usageLimit),
        isActive: f.isActive,
      };
      return edit!.id ? api.put(`/admin/promo-codes/${edit!.id}`, body) : api.post('/admin/promo-codes', body);
    },
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['admin', 'promos'] });
    },
  });
  if (isLoading) return <Spinner />;
  const f = edit?.f;
  const set = (patch: Partial<ReturnType<typeof emptyPromo>>) => setEdit((e) => e && { ...e, f: { ...e.f, ...patch } });

  return (
    <>
      <AdminTitle actions={!edit && <button className="btn-primary" onClick={() => setEdit({ id: null, f: emptyPromo() })}>+ New promo code</button>}>Promo codes</AdminTitle>
      {edit && f && (
        <form
          className="card mb-6 grid gap-4 p-5 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {save.error && <div className="md:col-span-3"><Alert>{errorMessage(save.error)}</Alert></div>}
          <Field label="Code" required value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
          <Select label="Type" value={f.type} onChange={(e) => set({ type: e.target.value as 'PERCENT' | 'FIXED' })}>
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed amount off (LKR)</option>
          </Select>
          <Field label={f.type === 'PERCENT' ? 'Percent' : 'Amount (LKR)'} type="number" min={0} step="0.01" required value={f.value} onChange={(e) => set({ value: e.target.value })} />
          <Field label="Max discount (LKR, optional)" type="number" min={0} value={f.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} />
          <Field label="Minimum spend (LKR, optional)" type="number" min={0} value={f.minAmount} onChange={(e) => set({ minAmount: e.target.value })} />
          <Field label="Usage limit (optional)" type="number" min={1} value={f.usageLimit} onChange={(e) => set({ usageLimit: e.target.value })} />
          <Field label="Valid from" type="date" required value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
          <Field label="Valid until" type="date" required value={f.validTo} onChange={(e) => set({ validTo: e.target.value })} />
          <Field label="Description" value={f.description} onChange={(e) => set({ description: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button className="btn-primary" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data?.promoCodes.length ? (
        <Empty title="No promo codes yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Valid</th>
                <th>Used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.promoCodes.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono font-semibold">{p.code}</td>
                  <td>
                    {p.type === 'PERCENT' ? `${p.value}%` : money(p.value * 100)}
                    {p.maxDiscount != null && <span className="text-zinc-500"> (max {money(p.maxDiscount * 100)})</span>}
                    {p.minAmount != null && <span className="text-zinc-500"> · min {money(p.minAmount * 100)}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {dateLong(p.validFrom)} – {dateLong(p.validTo)}
                  </td>
                  <td>
                    {p.usedCount}
                    {p.usageLimit != null && ` / ${p.usageLimit}`}
                  </td>
                  <td>{p.isActive && new Date(p.validTo) > new Date() ? <span className="text-emerald-400">Active</span> : <span className="text-zinc-500">Inactive</span>}</td>
                  <td className="text-right">
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() =>
                        setEdit({
                          id: p.id,
                          f: {
                            code: p.code,
                            description: p.description ?? '',
                            type: p.type,
                            value: String(p.value),
                            maxDiscount: p.maxDiscount?.toString() ?? '',
                            minAmount: p.minAmount?.toString() ?? '',
                            validFrom: p.validFrom.slice(0, 10),
                            validTo: p.validTo.slice(0, 10),
                            usageLimit: p.usageLimit?.toString() ?? '',
                            isActive: p.isActive,
                          },
                        })
                      }
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- bookings (FR-9.5) ---------------- */

export function AdminBookings() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'bookings', search], queryFn: () => api.get<{ bookings: Booking[] }>(`/admin/bookings${qs({ q: search })}`) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/admin/bookings/${id}/cancel`),
    onSuccess: () => {
      setMsg('Booking cancelled and refunded in full.');
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    },
  });
  const resend = useMutation({ mutationFn: (id: string) => api.post(`/admin/bookings/${id}/resend`), onSuccess: () => setMsg('E-ticket re-sent by email and SMS.') });

  return (
    <>
      <AdminTitle>Bookings</AdminTitle>
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <label htmlFor="bq" className="sr-only">
          Search bookings
        </label>
        <input id="bq" className="input" placeholder="Booking ID, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary">Search</button>
      </form>
      {msg && <div className="mt-3"><Alert kind="success">{msg}</Alert></div>}
      {(cancel.error || resend.error) && <div className="mt-3"><Alert>{errorMessage(cancel.error ?? resend.error)}</Alert></div>}
      <div className="mt-4">
        {isLoading ? (
          <Spinner />
        ) : !data?.bookings.length ? (
          <Empty title="No bookings found" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Customer</th>
                  <th>Show</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono text-xs">
                      {b.reference}
                      <br />
                      <span className="font-sans text-zinc-500">{b.seats.map((s) => s.label).join(', ')}</span>
                    </td>
                    <td>
                      {b.customer?.name}
                      <br />
                      <span className="text-xs text-zinc-500">
                        {b.customer?.email} · {b.customer?.phone}
                      </span>
                    </td>
                    <td>
                      {b.show.movie.title}
                      <br />
                      <span className="text-xs text-zinc-500">
                        {dateTime(b.show.startTime)} · {b.show.cinema.name} {b.show.screen.name}
                      </span>
                    </td>
                    <td className="tabular-nums">{money(b.totalCents, b.currency)}</td>
                    <td>
                      <StatusBadge status={b.status} />
                      {b.checkedInAt && <p className="mt-1 text-xs text-emerald-400">Checked in</p>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {b.status === 'CONFIRMED' && (
                        <>
                          <button className="btn-ghost btn-sm" onClick={() => resend.mutate(b.id)} disabled={resend.isPending}>
                            Resend
                          </button>
                          <button
                            className="btn-ghost btn-sm text-red-400"
                            disabled={cancel.isPending}
                            onClick={() => confirm(`Cancel ${b.reference} and refund ${money(b.totalCents, b.currency)} in full?`) && cancel.mutate(b.id)}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- reports (FR-9.7) ---------------- */

interface ReportRow {
  key: string;
  label: string;
  shows: number;
  bookings: number;
  tickets: number;
  capacity: number;
  occupancyPct: number;
  grossCents: number;
  refundsCents: number;
  netCents: number;
}

export function Reports() {
  const { user } = useAuth();
  const cinemas = useCinemas();
  const monthStart = todayKey().slice(0, 8) + '01';
  const [p, setP] = useState({ from: monthStart, to: todayKey(), groupBy: 'movie', cinemaId: '' });
  const query = qs(p);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'reports', query],
    queryFn: () => api.get<{ rows: ReportRow[]; totals: Omit<ReportRow, 'key' | 'label'>; currency: string }>(`/admin/reports${query}`),
  });
  return (
    <>
      <AdminTitle
        actions={
          <div className="flex gap-2">
            <a className="btn-secondary btn-sm" href={`/api/admin/reports${qs({ ...p, format: 'csv' })}`}>
              Export CSV
            </a>
            <a className="btn-secondary btn-sm" href={`/api/admin/reports${qs({ ...p, format: 'pdf' })}`}>
              Export PDF
            </a>
          </div>
        }
      >
        Reports
      </AdminTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="From" type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
        <Field label="To" type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
        <Select label="Group by" value={p.groupBy} onChange={(e) => setP({ ...p, groupBy: e.target.value })}>
          <option value="movie">Movie</option>
          <option value="show">Show</option>
          <option value="cinema">Cinema</option>
          <option value="date">Date</option>
        </Select>
        {user?.role === 'SUPER_ADMIN' && (
          <Select label="Cinema" value={p.cinemaId} onChange={(e) => setP({ ...p, cinemaId: e.target.value })}>
            <option value="">All cinemas</option>
            {cinemas.data?.cinemas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {error && <div className="mt-4"><Alert>{errorMessage(error)}</Alert></div>}
      {isLoading ? (
        <Spinner />
      ) : (
        data && (
          <>
            <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['Net sales', money(data.totals.netCents, data.currency)],
                ['Tickets', data.totals.tickets.toLocaleString()],
                ['Bookings', data.totals.bookings.toLocaleString()],
                ['Occupancy', `${data.totals.occupancyPct}%`],
              ].map(([k, v]) => (
                <div key={k} className="card p-4">
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">{k}</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="card mt-4 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{p.groupBy[0].toUpperCase() + p.groupBy.slice(1)}</th>
                    <th className="text-right">Shows</th>
                    <th className="text-right">Tickets</th>
                    <th className="text-right">Occupancy</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Refunds</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-zinc-500">
                        No shows in this period.
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="text-right tabular-nums">{r.shows}</td>
                      <td className="text-right tabular-nums">
                        {r.tickets}/{r.capacity}
                      </td>
                      <td className="text-right tabular-nums">{r.occupancyPct}%</td>
                      <td className="text-right tabular-nums">{money(r.grossCents, data.currency)}</td>
                      <td className="text-right tabular-nums">{money(r.refundsCents, data.currency)}</td>
                      <td className="text-right font-semibold tabular-nums">{money(r.netCents, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </>
  );
}

/* ---------------- food & drinks (FR-5.5) ---------------- */

interface AdminConcession {
  id: string;
  cinemaId: string | null;
  cinema: { name: string } | null;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function Concessions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const cinemas = useCinemas();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'concessions'], queryFn: () => api.get<{ concessions: AdminConcession[] }>('/admin/concessions') });
  const isSuper = user?.role === 'SUPER_ADMIN';
  const blank = { cinemaId: isSuper ? '' : (user?.cinemaId ?? ''), name: '', description: '', price: '', isActive: true, sortOrder: '0' };
  const [edit, setEdit] = useState<{ id: string | null; f: typeof blank } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const f = edit!.f;
      const body = { cinemaId: f.cinemaId || null, name: f.name, description: f.description || null, price: Number(f.price), isActive: f.isActive, sortOrder: Number(f.sortOrder) };
      return edit!.id ? api.put(`/admin/concessions/${edit!.id}`, body) : api.post('/admin/concessions', body);
    },
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['admin', 'concessions'] });
    },
  });
  if (isLoading) return <Spinner />;
  const set = (patch: Partial<typeof blank>) => setEdit((e) => e && { ...e, f: { ...e.f, ...patch } });
  const canEdit = (c: AdminConcession) => isSuper || (c.cinemaId !== null && c.cinemaId === user?.cinemaId);
  return (
    <>
      <AdminTitle actions={!edit && <button className="btn-primary" onClick={() => setEdit({ id: null, f: blank })}>+ New item</button>}>Food & drinks</AdminTitle>
      {edit && (
        <form
          className="card mb-6 grid gap-4 p-5 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {save.error && <div className="md:col-span-3"><Alert>{errorMessage(save.error)}</Alert></div>}
          <Field label="Name" required value={edit.f.name} onChange={(e) => set({ name: e.target.value })} />
          <Field label="Price (LKR)" type="number" min={0} step="0.01" required value={edit.f.price} onChange={(e) => set({ price: e.target.value })} />
          <Select label="Sold at" value={edit.f.cinemaId} onChange={(e) => set({ cinemaId: e.target.value })} disabled={!isSuper}>
            {isSuper && <option value="">Every cinema</option>}
            {cinemas.data?.cinemas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Field label="Description" value={edit.f.description} onChange={(e) => set({ description: e.target.value })} />
          <Field label="Sort order" type="number" min={0} value={edit.f.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={edit.f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> On sale
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button className="btn-primary" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data?.concessions.length ? (
        <Empty title="No food or drinks yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Sold at</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.concessions.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="font-semibold">{c.name}</span>
                    {c.description && <span className="block text-xs text-zinc-500">{c.description}</span>}
                  </td>
                  <td className="tabular-nums">{money(c.price * 100)}</td>
                  <td>{c.cinema?.name ?? 'Every cinema'}</td>
                  <td>{c.isActive ? <span className="text-emerald-400">On sale</span> : <span className="text-zinc-500">Hidden</span>}</td>
                  <td className="text-right">
                    {canEdit(c) && (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() =>
                          setEdit({ id: c.id, f: { cinemaId: c.cinemaId ?? '', name: c.name, description: c.description ?? '', price: String(c.price), isActive: c.isActive, sortOrder: String(c.sortOrder) } })
                        }
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
