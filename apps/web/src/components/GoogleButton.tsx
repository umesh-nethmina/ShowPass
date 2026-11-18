import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { User } from '../lib/types';

interface GoogleId {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleId;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGis() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** FR-1.6: "Continue with Google". Renders nothing unless the API has a Google client ID configured. */
export function GoogleButton({ onSignedIn, text = 'continue_with' }: { onSignedIn: (u: User, created: boolean) => void; text?: 'signin_with' | 'signup_with' | 'continue_with' }) {
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<{ googleClientId: string | null }>('/auth/config'), staleTime: Infinity });
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = config.data?.googleClientId;

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !window.google || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const r = await api.post<{ user: User; created: boolean }>('/auth/google', { credential });
              onSignedIn(r.user, r.created);
            } catch (e) {
              setError(errorMessage(e));
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, { theme: 'filled_black', size: 'large', text, shape: 'pill', width: 320 });
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [clientId, onSignedIn, text]);

  if (!clientId) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-500">
        <span className="h-px flex-1 bg-ink-600" /> or <span className="h-px flex-1 bg-ink-600" />
      </div>
      <div ref={ref} className="flex justify-center" />
      {error && (
        <p className="text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
