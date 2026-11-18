import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Role } from '../../lib/types';
import { dateLong, dateTime } from '../../lib/format';
import { Alert, Empty, Field, Select, Spinner, Stars } from '../../components/ui';
import { AdminTitle, useCinemas } from './AdminLayout';

const ROLE_LABEL: Record<Role, string> = { CUSTOMER: 'Customer', TICKET_CHECKER: 'Ticket checker', CINEMA_ADMIN: 'Cinema admin', SUPER_ADMIN: 'Super admin' };

/* ---------------- staff (FR-9.8) ---------------- */

interface StaffUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  cinema: { id: string; name: string } | null;
}

export function Staff() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const cinemas = useCinemas();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => api.get<{ staff: StaffUser[] }>('/admin/staff') });
  const [form, setForm] = useState<{ name: string; email: string; phone: string; password: string; role: Role; cinemaId: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api.post('/admin/staff', { ...form, cinemaId: form!.cinemaId || null }),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; isActive?: boolean; role?: Role; cinemaId?: string | null }) => api.patch(`/admin/staff/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'staff'] }),
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <AdminTitle
        actions={
          !form && (
            <button className="btn-primary" onClick={() => setForm({ name: '', email: '', phone: '', password: '', role: 'TICKET_CHECKER', cinemaId: cinemas.data?.cinemas[0]?.id ?? '' })}>
              + Add staff
            </button>
          )
        }
      >
        Staff
      </AdminTitle>
      {form && (
        <form
          className="card mb-6 grid gap-4 p-5 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {create.error && <div className="md:col-span-3"><Alert>{errorMessage(create.error)}</Alert></div>}
          <Field label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field label="Mobile" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Field label="Temporary password" type="text" required hint="Ask them to change it after first login" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(['TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          {form.role !== 'SUPER_ADMIN' && (
            <Select label="Cinema" value={form.cinemaId} onChange={(e) => setForm({ ...form, cinemaId: e.target.value })}>
              {cinemas.data?.cinemas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <div className="flex gap-2 md:col-span-3">
            <button className="btn-primary" disabled={create.isPending}>
              Create account
            </button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {update.error && <div className="mb-3"><Alert>{errorMessage(update.error)}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Cinema</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.staff.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <br />
                  <span className="text-xs text-zinc-500">{s.email}</span>
                </td>
                <td>{ROLE_LABEL[s.role]}</td>
                <td>{s.cinema?.name ?? '—'}</td>
                <td>{s.isActive ? <span className="text-emerald-400">Active</span> : <span className="text-zinc-500">Disabled</span>}</td>
                <td className="text-right">
                  {s.id !== user?.id && (
                    <button className="btn-ghost btn-sm" onClick={() => update.mutate({ id: s.id, isActive: !s.isActive })}>
                      {s.isActive ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- reviews (FR-10.2) ---------------- */

export function Reviews() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reviews'],
    queryFn: () => api.get<{ reviews: { id: string; rating: number; comment: string | null; isHidden: boolean; createdAt: string; user: { name: string; email: string }; movie: { title: string } }[] }>('/admin/reviews'),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isHidden }: { id: string; isHidden: boolean }) => api.patch(`/admin/reviews/${id}`, { isHidden }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <AdminTitle>Reviews</AdminTitle>
      {!data?.reviews.length ? (
        <Empty title="No reviews yet" />
      ) : (
        <ul className="space-y-2">
          {data.reviews.map((r) => (
            <li key={r.id} className={`card p-4 ${r.isHidden ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-semibold">{r.movie.title}</span> <Stars value={r.rating} />
                </p>
                <button className="btn-secondary btn-sm" onClick={() => toggle.mutate({ id: r.id, isHidden: !r.isHidden })}>
                  {r.isHidden ? 'Show' : 'Hide'}
                </button>
              </div>
              {r.comment && <p className="mt-2 text-sm text-zinc-300">{r.comment}</p>}
              <p className="mt-1 text-xs text-zinc-500">
                {r.user.name} ({r.user.email}) · {dateLong(r.createdAt)} {r.isHidden && '· hidden'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- settings ---------------- */

interface Settings {
  currency: string;
  holdMinutes: number;
  maxSeatsPerBooking: number;
  bookingCutoffMinutes: number;
  cancelCutoffMinutes: number;
  convenienceFeePerTicket: number;
  taxPercent: number;
  refundPolicy: { minHoursBefore: number; percent: number }[];
  fillingFastThreshold: number;
  showtimeDaysAhead: number;
}

const NUMERIC: { key: keyof Settings; label: string; hint?: string; step?: string }[] = [
  { key: 'holdMinutes', label: 'Seat hold (minutes)' },
  { key: 'maxSeatsPerBooking', label: 'Max seats per booking' },
  { key: 'bookingCutoffMinutes', label: 'Online booking closes (minutes before show)' },
  { key: 'cancelCutoffMinutes', label: 'Cancellation cut-off (minutes before show)' },
  { key: 'convenienceFeePerTicket', label: 'Convenience fee per ticket', step: '0.01' },
  { key: 'taxPercent', label: 'Tax %', step: '0.01' },
  { key: 'fillingFastThreshold', label: '"Filling fast" below this share free', hint: '0.3 = 30% of seats left', step: '0.05' },
  { key: 'showtimeDaysAhead', label: 'Days of showtimes shown' },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: Settings }>('/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: Settings }>('/admin/settings', s),
    onSuccess: (d) => qc.setQueryData(['admin', 'settings'], d),
  });
  if (isLoading || !s) return <Spinner />;
  return (
    <>
      <AdminTitle>Settings</AdminTitle>
      <form
        className="card grid gap-4 p-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.error && <div className="md:col-span-2"><Alert>{errorMessage(save.error)}</Alert></div>}
        {save.isSuccess && <div className="md:col-span-2"><Alert kind="success">Settings saved.</Alert></div>}
        <Field label="Currency code" maxLength={3} value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })} />
        {NUMERIC.map((n) => (
          <Field key={n.key} label={n.label} hint={n.hint} type="number" step={n.step ?? '1'} min={0} value={s[n.key] as number} onChange={(e) => setS({ ...s, [n.key]: Number(e.target.value) })} />
        ))}
        <fieldset className="md:col-span-2">
          <legend className="label">Refund policy</legend>
          <div className="space-y-2">
            {s.refundPolicy.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span>At least</span>
                <input aria-label="Hours before show" type="number" min={0} className="input w-24" value={t.minHoursBefore} onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, minHoursBefore: Number(e.target.value) } : x)) })} />
                <span>hours before the show →</span>
                <input aria-label="Refund percent" type="number" min={0} max={100} className="input w-24" value={t.percent} onChange={(e) => setS({ ...s, refundPolicy: s.refundPolicy.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)) })} />
                <span>% refund</span>
                <button type="button" className="btn-ghost btn-sm text-red-400" onClick={() => setS({ ...s, refundPolicy: s.refundPolicy.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setS({ ...s, refundPolicy: [...s.refundPolicy, { minHoursBefore: 0, percent: 0 }] })}>
              + Add tier
            </button>
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <button className="btn-primary" disabled={save.isPending}>
            Save settings
          </button>
        </div>
      </form>
    </>
  );
}

/* ---------------- audit log (NFR-17) ---------------- */

export function AuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<{ logs: { id: string; action: string; entity: string; entityId: string | null; createdAt: string; user: { name: string; email: string } | null; meta: unknown }[] }>('/admin/audit'),
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <AdminTitle>Audit log</AdminTitle>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-xs">{dateTime(l.createdAt)}</td>
                <td className="text-xs">{l.user ? `${l.user.name} (${l.user.email})` : 'System'}</td>
                <td className="font-mono text-xs">{l.action}</td>
                <td className="font-mono text-xs text-zinc-500">
                  {l.entity} {l.entityId?.slice(-8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
