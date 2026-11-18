import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';
import { Alert, Field } from '../components/ui';
import { GoogleButton } from '../components/GoogleButton';

/** Only allow same-site relative redirects. */
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="container-page flex justify-center py-12">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center font-display text-4xl tracking-wide">{title}</h1>
        <div className="card p-6">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-zinc-400">{footer}</div>}
      </div>
    </div>
  );
}

function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof T) => ({
    name: k as string,
    value: values[k],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value })),
    error: errors[k as string],
  });
  async function submit(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { values, bind, submit, error, busy, setError };
}

export function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const f = useForm({ identifier: '', password: '' });
  const onGoogle = useCallback(
    (u: User) => {
      setUser(u);
      navigate(next, { replace: true });
    },
    [setUser, navigate, next],
  );
  if (user) return <Navigate to={next} replace />;
  return (
    <AuthCard
      title="Log in"
      footer={
        <>
          New to ShowPass?{' '}
          <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-gold-400">
            Create an account
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) =>
          f.submit(e, async () => {
            const { user } = await api.post<{ user: User }>('/auth/login', f.values);
            setUser(user);
            navigate(user.role === 'TICKET_CHECKER' && next === '/' ? '/checker' : next, { replace: true });
          })
        }
      >
        {f.error && <Alert>{f.error}</Alert>}
        <Field label="Email or mobile number" autoComplete="username" required {...f.bind('identifier')} />
        <Field label="Password" type="password" autoComplete="current-password" required {...f.bind('password')} />
        <button className="btn-primary w-full" disabled={f.busy}>
          {f.busy ? 'Logging in…' : 'Log in'}
        </button>
        <Link to="/forgot-password" className="block text-center text-sm text-zinc-400 hover:text-white">
          Forgot your password?
        </Link>
      </form>
      <div className="mt-4">
        <GoogleButton onSignedIn={onGoogle} text="signin_with" />
      </div>
    </AuthCard>
  );
}

export function Register() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const f = useForm({ name: '', email: '', phone: '', password: '' });
  const onGoogle = useCallback(
    (u: User) => {
      setUser(u);
      navigate(next, { replace: true });
    },
    [setUser, navigate, next],
  );
  if (user) return <Navigate to={next} replace />;
  return (
    <AuthCard
      title="Create account"
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-gold-400">
            Log in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) =>
          f.submit(e, async () => {
            const { user } = await api.post<{ user: User }>('/auth/register', f.values);
            setUser(user);
            navigate(`/verify?next=${encodeURIComponent(next)}`, { replace: true });
          })
        }
      >
        {f.error && <Alert>{f.error}</Alert>}
        <Field label="Full name" autoComplete="name" required {...f.bind('name')} />
        <Field label="Email" type="email" autoComplete="email" required {...f.bind('email')} />
        <Field label="Mobile number" type="tel" autoComplete="tel" placeholder="07X XXX XXXX" required {...f.bind('phone')} />
        <Field label="Password" type="password" autoComplete="new-password" required hint="At least 8 characters, with a letter and a number" {...f.bind('password')} />
        <button className="btn-primary w-full" disabled={f.busy}>
          {f.busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-xs text-zinc-500">We use your email and mobile number to send tickets and booking updates, in line with Sri Lanka's Personal Data Protection Act.</p>
      </form>
      <div className="mt-4">
        <GoogleButton onSignedIn={onGoogle} text="signup_with" />
      </div>
    </AuthCard>
  );
}

/** FR-1.2: verify email or mobile with a one-time code before the first booking. */
export function Verify() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [sent, setSent] = useState<string | null>(null);
  const f = useForm({ code: '' });
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent('/verify')}`} replace />;
  if (user.verified) return <Navigate to={next} replace />;

  async function resend(ch: 'email' | 'sms') {
    setChannel(ch);
    try {
      await api.post('/auth/verify/request', { channel: ch });
      setSent(ch === 'email' ? `We sent a new code to ${user!.email}.` : `We sent a code by SMS to ${user!.phone}.`);
      f.setError(null);
    } catch (e) {
      f.setError(errorMessage(e));
    }
  }

  return (
    <AuthCard title="Verify your account">
      <p className="mb-4 text-sm text-zinc-300">
        {channel === 'email' ? (
          <>
            Enter the 6-digit code we sent to <span className="font-semibold text-white">{user.email}</span>.
          </>
        ) : (
          <>
            Enter the 6-digit code we sent to <span className="font-semibold text-white">{user.phone}</span>.
          </>
        )}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) =>
          f.submit(e, async () => {
            const { user } = await api.post<{ user: User }>('/auth/verify/confirm', { channel, code: f.values.code.trim() });
            setUser(user);
            navigate(next, { replace: true });
          })
        }
      >
        {sent && <Alert kind="success">{sent}</Alert>}
        {f.error && <Alert>{f.error}</Alert>}
        <Field label="Verification code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required {...f.bind('code')} />
        <button className="btn-primary w-full" disabled={f.busy}>
          Verify
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
        <button className="btn-ghost btn-sm" onClick={() => resend('email')}>
          Resend by email
        </button>
        {user.phone && (
          <button className="btn-ghost btn-sm" onClick={() => resend('sms')}>
            Send by SMS instead
          </button>
        )}
      </div>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<'request' | 'reset'>('request');
  const f = useForm({ identifier: '', code: '', password: '' });
  return (
    <AuthCard title="Reset password" footer={<Link to="/login" className="text-gold-400">Back to log in</Link>}>
      {stage === 'request' ? (
        <form
          className="space-y-4"
          onSubmit={(e) =>
            f.submit(e, async () => {
              await api.post('/auth/password/forgot', { identifier: f.values.identifier });
              setStage('reset');
            })
          }
        >
          {f.error && <Alert>{f.error}</Alert>}
          <p className="text-sm text-zinc-300">Enter your email or mobile number. We'll send you a code to reset your password.</p>
          <Field label="Email or mobile number" autoComplete="username" required {...f.bind('identifier')} />
          <button className="btn-primary w-full" disabled={f.busy}>
            Send code
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) =>
            f.submit(e, async () => {
              const { user } = await api.post<{ user: User }>('/auth/password/reset', f.values);
              setUser(user);
              navigate('/', { replace: true });
            })
          }
        >
          <Alert kind="info">If an account exists for {f.values.identifier}, we've sent it a 6-digit code.</Alert>
          {f.error && <Alert>{f.error}</Alert>}
          <Field label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required {...f.bind('code')} />
          <Field label="New password" type="password" autoComplete="new-password" required hint="At least 8 characters, with a letter and a number" {...f.bind('password')} />
          <button className="btn-primary w-full" disabled={f.busy}>
            Reset password
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function Profile() {
  const { user, setUser } = useAuth();
  const profile = useForm({ name: user?.name ?? '', phone: user?.phone ?? '' });
  const hasPassword = user?.hasPassword !== false;
  const pw = useForm({ currentPassword: '', newPassword: '' });
  const [saved, setSaved] = useState<string | null>(null);
  if (!user) return null;
  return (
    <div className="container-page max-w-xl space-y-6 py-8">
      <h1 className="font-display text-4xl tracking-wide">Profile</h1>
      {saved && <Alert kind="success">{saved}</Alert>}
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) =>
          profile.submit(e, async () => {
            const { name, phone } = profile.values;
            const { user } = await api.patch<{ user: User }>('/auth/me', phone.trim() ? { name, phone } : { name });
            setUser(user);
            setSaved('Profile updated.');
          })
        }
      >
        {profile.error && <Alert>{profile.error}</Alert>}
        <div>
          <p className="label">Email</p>
          <p className="text-sm">
            {user.email} {user.emailVerified ? <span className="text-emerald-400">· verified</span> : <Link to="/verify" className="text-gold-400 underline">· verify</Link>}
          </p>
        </div>
        <Field label="Full name" autoComplete="name" required {...profile.bind('name')} />
        <Field
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          required={!!user.phone}
          hint={!user.phone ? 'Add your mobile number to get booking confirmations by SMS' : user.phoneVerified ? 'Verified' : 'Not verified'}
          {...profile.bind('phone')}
        />
        <button className="btn-primary" disabled={profile.busy}>
          Save changes
        </button>
      </form>
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) =>
          pw.submit(e, async () => {
            await api.post('/auth/password/change', hasPassword ? pw.values : { newPassword: pw.values.newPassword });
            setUser({ ...user, hasPassword: true });
            setSaved(hasPassword ? 'Password changed.' : 'Password set. You can now also log in with your email and password.');
          })
        }
      >
        <h2 className="font-semibold">{hasPassword ? 'Change password' : 'Set a password'}</h2>
        {!hasPassword && <p className="text-sm text-zinc-400">You sign in with Google. Set a password if you also want to log in with your email.</p>}
        {pw.error && <Alert>{pw.error}</Alert>}
        {hasPassword && <Field label="Current password" type="password" autoComplete="current-password" required {...pw.bind('currentPassword')} />}
        <Field label="New password" type="password" autoComplete="new-password" required {...pw.bind('newPassword')} />
        <button className="btn-secondary" disabled={pw.busy}>
          {hasPassword ? 'Change password' : 'Set password'}
        </button>
      </form>
    </div>
  );
}
