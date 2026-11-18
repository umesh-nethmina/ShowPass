import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import type { Role, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User | null }>('/auth/me'),
    staleTime: 60_000,
  });
  const setUser = (user: User | null) => qc.setQueryData(['me'], { user });
  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    setUser(null);
  };
  return <AuthContext.Provider value={{ user: data?.user ?? null, loading: isLoading, setUser, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const isStaff = (u: User | null) => !!u && u.role !== 'CUSTOMER';
export const isAdmin = (u: User | null) => !!u && (u.role === 'CINEMA_ADMIN' || u.role === 'SUPER_ADMIN');

/** Redirects to login (remembering where to come back) unless signed in with one of the roles. */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="container-page py-20 text-center text-zinc-400">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
