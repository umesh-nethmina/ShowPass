import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isAdmin, isStaff, useAuth } from '../lib/auth';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="ShowPass home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#16161f" />
        <path d="M7 10h18v4a2 2 0 0 0 0 4v4H7v-4a2 2 0 0 0 0-4z" fill="#f5c518" />
      </svg>
      <span className="font-display text-2xl tracking-wider">
        Show<span className="text-gold-400">Pass</span>
      </span>
    </Link>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'text-gold-400' : 'text-zinc-300 hover:text-white'}`;

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = (
    <>
      <NavLink to="/" end className={navClass} onClick={() => setOpen(false)}>
        Movies
      </NavLink>
      {user && (
        <NavLink to="/bookings" className={navClass} onClick={() => setOpen(false)}>
          My bookings
        </NavLink>
      )}
      {isStaff(user) && (
        <NavLink to="/checker" className={navClass} onClick={() => setOpen(false)}>
          Scan tickets
        </NavLink>
      )}
      {isAdmin(user) && (
        <NavLink to="/admin" className={navClass} onClick={() => setOpen(false)}>
          Admin
        </NavLink>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-gold-400 focus:px-3 focus:py-2 focus:text-ink-950">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <>
                <Link to="/profile" className="btn-ghost btn-sm">
                  {user.name.split(' ')[0]}
                </Link>
                <button
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost btn-sm">
                  Log in
                </Link>
                <Link to="/register" className="btn-primary btn-sm">
                  Sign up
                </Link>
              </>
            )}
          </div>
          <button className="btn-ghost md:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
            <span className="sr-only">Menu</span>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="container-page flex flex-col gap-1 border-t border-ink-700 py-3 md:hidden" aria-label="Main">
            {links}
            {user ? (
              <>
                <NavLink to="/profile" className={navClass} onClick={() => setOpen(false)}>
                  Profile
                </NavLink>
                <button
                  className="btn-secondary mt-2"
                  onClick={async () => {
                    setOpen(false);
                    await logout();
                    navigate('/');
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link to="/login" className="btn-secondary" onClick={() => setOpen(false)}>
                  Log in
                </Link>
                <Link to="/register" className="btn-primary" onClick={() => setOpen(false)}>
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-16 border-t border-ink-700 py-8 text-sm text-zinc-500">
        <div className="container-page flex flex-col justify-between gap-2 sm:flex-row">
          <p>© {new Date().getFullYear()} ShowPass. All prices in LKR.</p>
          <p>Secure payments. We never store your card details.</p>
        </div>
      </footer>
    </div>
  );
}
