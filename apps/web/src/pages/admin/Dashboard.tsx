import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { money, time } from '../../lib/format';
import { Empty, Spinner } from '../../components/ui';
import { AdminTitle } from './AdminLayout';

interface DashboardData {
  today: { bookings: number; tickets: number; revenueCents: number };
  upcomingShows: number;
  shows: { id: string; startTime: string; movie: string; screen: string; cinema: string; capacity: number; booked: number }[];
  currency: string;
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<DashboardData>('/admin/dashboard'), refetchInterval: 30_000 });
  if (isLoading || !data) return <Spinner />;
  const stats = [
    { label: 'Bookings today', value: data.today.bookings.toLocaleString() },
    { label: 'Tickets sold today', value: data.today.tickets.toLocaleString() },
    { label: 'Revenue today', value: money(data.today.revenueCents, data.currency) },
    { label: 'Upcoming shows', value: data.upcomingShows.toLocaleString() },
  ];
  return (
    <>
      <AdminTitle>Dashboard</AdminTitle>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-400">{s.label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Today's shows</h2>
      {data.shows.length === 0 ? (
        <Empty title="No shows scheduled today" />
      ) : (
        <ul className="space-y-2">
          {data.shows.map((s) => {
            const pct = s.capacity ? Math.round((s.booked / s.capacity) * 100) : 0;
            return (
              <li key={s.id} className="card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    <span className="font-bold">{time(s.startTime)}</span> · {s.movie}
                  </span>
                  <span className="text-zinc-400">
                    {s.cinema} · {s.screen} · {s.booked}/{s.capacity} ({pct}%)
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Occupancy">
                  <div className="h-full rounded-full bg-gold-400" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
