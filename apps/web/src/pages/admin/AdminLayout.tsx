import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';

const LINKS: { to: string; label: string; superOnly?: boolean }[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/movies', label: 'Movies' },
  { to: '/admin/cinemas', label: 'Cinemas & screens' },
  { to: '/admin/shows', label: 'Showtimes' },
  { to: '/admin/pricing', label: 'Pricing' },
  { to: '/admin/promo-codes', label: 'Promo codes' },
  { to: '/admin/food', label: 'Food & drinks' },
  { to: '/admin/bookings', label: 'Bookings' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/reviews', label: 'Reviews' },
  { to: '/admin/staff', label: 'Staff', superOnly: true },
  { to: '/admin/settings', label: 'Settings', superOnly: true },
  { to: '/admin/audit', label: 'Audit log', superOnly: true },
];

export default function AdminLayout() {
  const { user } = useAuth();
  const links = LINKS.filter((l) => !l.superOnly || user?.role === 'SUPER_ADMIN');
  return (
    <div className="container-page grid gap-6 py-6 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Admin" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/admin'}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-gold-400 text-ink-950' : 'text-zinc-300 hover:bg-ink-800 hover:text-white'}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export interface AdminCinema {
  id: string;
  name: string;
  address: string;
  city: string;
  contact: string;
  isActive: boolean;
  screens: { id: string; name: string; format: 'TWO_D' | 'THREE_D' | 'IMAX'; gridRows: number; gridCols: number; _count: { seats: number } }[];
}

export function useCinemas() {
  return useQuery({ queryKey: ['admin', 'cinemas'], queryFn: () => api.get<{ cinemas: AdminCinema[] }>('/admin/cinemas') });
}

export function AdminTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-4xl tracking-wide">{children}</h1>
      {actions}
    </div>
  );
}
