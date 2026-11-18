import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { money } from '../lib/format';
import { Alert, Spinner } from '../components/ui';

interface PaymentStatus {
  payment: { id: string; status: 'INITIATED' | 'SUCCESS' | 'FAILED' | 'REFUNDED'; amountCents: number; currency: string; failReason: string | null; gateway: string };
  booking: { id: string; status: string; reference: string };
}

/** Development stand-in for a hosted payment page. Sends a signed webhook via the API. */
export function MockGateway() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const { data, error } = useQuery({ queryKey: ['payment', paymentId], queryFn: () => api.get<PaymentStatus>(`/payments/${paymentId}`) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function complete(outcome: 'SUCCESS' | 'FAILED') {
    setBusy(true);
    try {
      await api.post(`/payments/mock/${paymentId}/complete`, { outcome });
      navigate(`/payment/result?payment=${paymentId}`, { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Test payment gateway</p>
        <h1 className="mt-1 text-2xl font-bold">Pay ShowPass</h1>
        {error && <p className="mt-4 text-red-600">{errorMessage(error)}</p>}
        {data && (
          <>
            <p className="mt-4 text-3xl font-bold tabular-nums">{money(data.payment.amountCents, data.payment.currency)}</p>
            <p className="text-sm text-zinc-500">Booking {data.booking.reference}</p>
            <div className="mt-6 space-y-2 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600">
              <p>Card 4242 4242 4242 4242 · 12/30 · 123</p>
              <p className="text-xs">No real money is charged. This page only exists in development.</p>
            </div>
            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
            <button className="mt-6 w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50" disabled={busy || data.payment.status !== 'INITIATED'} onClick={() => complete('SUCCESS')}>
              Pay now
            </button>
            <button className="mt-2 w-full rounded-lg border border-zinc-300 py-3 font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50" disabled={busy || data.payment.status !== 'INITIATED'} onClick={() => complete('FAILED')}>
              Simulate a declined card
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Where the gateway sends the customer back. Polls until the webhook has been processed. */
export function PaymentResult() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment');
  const cancelled = params.get('cancelled') === '1';
  const [timedOut, setTimedOut] = useState(false);
  const [released, setReleased] = useState(false);
  const { data, error } = useQuery({
    queryKey: ['payment', paymentId, 'result'],
    queryFn: () => api.get<PaymentStatus>(`/payments/${paymentId}`),
    enabled: !!paymentId,
    refetchInterval: (q) => (q.state.data?.payment.status === 'INITIATED' && !timedOut && !cancelled ? 2000 : false),
  });
  // Customer pressed "cancel" on the gateway page: free the seats now instead of waiting for the hold to lapse.
  useEffect(() => {
    if (cancelled && data?.payment.status === 'INITIATED' && data.booking.status === 'PENDING' && !released) {
      setReleased(true);
      api.delete(`/bookings/${data.booking.id}/hold`).catch(() => {});
    }
  }, [cancelled, data, released]);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 60_000);
    return () => clearTimeout(t);
  }, []);

  if (!paymentId) return <div className="container-page py-12"><Alert>Missing payment reference.</Alert></div>;
  if (error) return <div className="container-page py-12"><Alert>{errorMessage(error)}</Alert></div>;
  if (!data) return <Spinner label="Checking your payment" />;

  const { payment, booking } = data;
  if (cancelled && booking.status !== 'CONFIRMED') {
    return (
      <div className="container-page max-w-lg py-12 text-center">
        <h1 className="font-display text-4xl tracking-wide">Payment cancelled</h1>
        <p className="mt-2 text-zinc-300">You have not been charged and your seats have been released.</p>
        <Link to="/" className="btn-primary mt-6">
          Back to movies
        </Link>
      </div>
    );
  }
  return (
    <div className="container-page max-w-lg py-12 text-center">
      {booking.status === 'CONFIRMED' ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-300" aria-hidden>
            ✓
          </div>
          <h1 className="mt-4 font-display text-4xl tracking-wide">You're booked!</h1>
          <p className="mt-2 text-zinc-300">
            Booking <span className="font-semibold text-white">{booking.reference}</span> is confirmed. Your e-ticket is on its way by email and SMS.
          </p>
          <Link to={`/bookings/${booking.id}`} className="btn-primary mt-6">
            View e-ticket
          </Link>
        </>
      ) : payment.status === 'INITIATED' && !timedOut ? (
        <Spinner label="Waiting for confirmation from the payment provider" />
      ) : payment.status === 'INITIATED' ? (
        <Alert kind="info">We have not heard back from the payment provider yet. If you were charged, your booking will be confirmed or refunded automatically within 15 minutes.</Alert>
      ) : payment.status === 'REFUNDED' ? (
        <Alert kind="warning">Your payment went through, but the seats were no longer available, so it has been refunded in full. Sorry about that — please pick other seats.</Alert>
      ) : (
        <>
          <h1 className="font-display text-4xl tracking-wide">Payment not completed</h1>
          <p className="mt-2 text-zinc-300">{payment.failReason ?? 'The payment did not go through.'} Your seats have been released and you have not been charged.</p>
          <Link to="/" className="btn-primary mt-6">
            Try again
          </Link>
        </>
      )}
    </div>
  );
}
