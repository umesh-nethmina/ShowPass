import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { AuthProvider, RequireAuth } from './lib/auth';
import { Layout } from './components/Layout';
import Home from './pages/Home';
import MovieDetail from './pages/MovieDetail';
import SeatSelection from './pages/SeatSelection';
import Checkout from './pages/Checkout';
import { MockGateway, PaymentResult } from './pages/Payment';
import { BookingDetail, MyBookings } from './pages/Bookings';
import { ForgotPassword, Login, Profile, Register, Verify } from './pages/Auth';
import { Spinner } from './components/ui';

// Staff-only screens are split out so customers never download them (NFR-1).
const Checker = lazy(() => import('./pages/Checker'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Movies = lazy(() => import('./pages/admin/Movies'));
const Shows = lazy(() => import('./pages/admin/Shows'));
const named = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
  lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })));
const Cinemas = named(() => import('./pages/admin/Venues'), 'Cinemas');
const Pricing = named(() => import('./pages/admin/Venues'), 'Pricing');
const ScreenEditor = named(() => import('./pages/admin/Venues'), 'ScreenEditor');
const AdminBookings = named(() => import('./pages/admin/Commerce'), 'AdminBookings');
const PromoCodes = named(() => import('./pages/admin/Commerce'), 'PromoCodes');
const Reports = named(() => import('./pages/admin/Commerce'), 'Reports');
const AuditLog = named(() => import('./pages/admin/People'), 'AuditLog');
const Reviews = named(() => import('./pages/admin/People'), 'Reviews');
const SettingsPage = named(() => import('./pages/admin/People'), 'SettingsPage');
const Staff = named(() => import('./pages/admin/People'), 'Staff');
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const STAFF = ['TICKET_CHECKER', 'CINEMA_ADMIN', 'SUPER_ADMIN'] as const;
const ADMINS = ['CINEMA_ADMIN', 'SUPER_ADMIN'] as const;

function NotFound() {
  return (
    <div className="container-page py-20 text-center">
      <h1 className="font-display text-6xl">404</h1>
      <p className="mt-2 text-zinc-400">This page doesn't exist.</p>
      <Link to="/" className="btn-primary mt-6">
        Back to movies
      </Link>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/mock-gateway/:paymentId" element={<RequireAuth><MockGateway /></RequireAuth>} />
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="movies/:slug" element={<MovieDetail />} />
              <Route path="shows/:showId" element={<SeatSelection />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="verify" element={<Verify />} />
              <Route path="checkout/:bookingId" element={<RequireAuth><Checkout /></RequireAuth>} />
              <Route path="payment/result" element={<RequireAuth><PaymentResult /></RequireAuth>} />
              <Route path="bookings" element={<RequireAuth><MyBookings /></RequireAuth>} />
              <Route path="bookings/:id" element={<RequireAuth><BookingDetail /></RequireAuth>} />
              <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
              <Route path="checker" element={<RequireAuth roles={[...STAFF]}><Checker /></RequireAuth>} />
              <Route path="admin" element={<RequireAuth roles={[...ADMINS]}><AdminLayout /></RequireAuth>}>
                <Route index element={<Dashboard />} />
                <Route path="movies" element={<Movies />} />
                <Route path="cinemas" element={<Cinemas />} />
                <Route path="cinemas/:cinemaId/screens/new" element={<ScreenEditor />} />
                <Route path="screens/:screenId" element={<ScreenEditor />} />
                <Route path="shows" element={<Shows />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="promo-codes" element={<PromoCodes />} />
                <Route path="bookings" element={<AdminBookings />} />
                <Route path="reports" element={<Reports />} />
                <Route path="reviews" element={<Reviews />} />
                <Route path="staff" element={<RequireAuth roles={['SUPER_ADMIN']}><Staff /></RequireAuth>} />
                <Route path="settings" element={<RequireAuth roles={['SUPER_ADMIN']}><SettingsPage /></RequireAuth>} />
                <Route path="audit" element={<RequireAuth roles={['SUPER_ADMIN']}><AuditLog /></RequireAuth>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
