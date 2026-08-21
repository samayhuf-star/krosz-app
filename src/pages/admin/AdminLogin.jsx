import { useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { ADMIN_EMAIL, isAppAdmin } from '@/lib/adminAccess';
import { Lock, Loader2, ShieldCheck, Globe, ArrowLeft } from 'lucide-react';

// Owner-only admin entry. The email is locked to the platform owner
// (ADMIN_EMAIL); the only thing entered here is the password. Any other
// account is refused at this gate even before RoleRoute runs.
// Hard-coded owner access PIN. This is a first-line gate in front of the
// credentials form — it is not a security boundary on its own (auth handles
// that), it just keeps the sign-in form hidden until the right code is entered.
const ADMIN_PIN = '778899';

export default function AdminLogin() {
  const { user, isAuthenticated, isLoadingAuth, authChecked, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submitPin = (e) => {
    e.preventDefault();
    if (pin.replace(/\s/g, '') === ADMIN_PIN) {
      setPinError('');
      setUnlocked(true);
    } else {
      setPinError('Incorrect access code. The sign-in form stays locked.');
    }
  };

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-orange-500" />
      </div>
    );
  }

  // Already signed in as the owner → straight into the console.
  if (isAuthenticated && isAppAdmin(user)) return <Navigate to="/admin/hub" replace />;

  // Signed in as someone else → tell them this console isn't for them.
  if (isAuthenticated && !isAppAdmin(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400"><ShieldCheck size={22} /></span>
          <h1 className="mt-5 text-xl font-bold text-white">Access restricted</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">This admin console is limited to the Krosz platform owner. The account you’re signed in with isn’t authorized.</p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={() => logout('/admin')} className="w-full rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500">Sign out & open admin sign-in</button>
            <Link to="/home" className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800">Back to your dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(ADMIN_EMAIL, password);
      window.location.href = '/admin/hub';
    } catch (err) {
      setError(err?.message || 'Could not sign in. Check the password and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-5 text-slate-100">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-[-180px] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-orange-600/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white"><Globe size={19} /></span>
          <div>
            <p className="text-sm font-bold text-white">Krosz Admin</p>
            <p className="text-[11px] text-slate-400">Platform owner console</p>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-800 bg-slate-900/60 p-7 shadow-2xl">
          {!unlocked ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-white">Enter access code</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">This console is restricted. Enter the 6-digit owner access code to reveal the sign-in form.</p>
              {pinError && <div className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{pinError}</div>}
              <form onSubmit={submitPin} className="mt-5 space-y-4" autoComplete="off">
                <div className="space-y-2">
                  <label htmlFor="admin-pin" className="text-xs font-semibold text-slate-300">6-digit access code</label>
                  <input
                    id="admin-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="off"
                    autoFocus
                    placeholder="••••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    className="h-14 w-full rounded-xl border border-slate-700 bg-slate-950 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-600 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    required
                  />
                </div>
                <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white transition hover:bg-orange-500">
                  <Lock size={16} /> Unlock sign-in
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-white">Owner sign-in</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">Access code accepted. Sign in with the owner password to manage every admin tool.</p>

              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Authorized account</p>
                <p className="mt-1 break-all text-sm font-semibold text-orange-300">{ADMIN_EMAIL}</p>
              </div>

              {error && <div className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="admin-password" className="text-xs font-semibold text-slate-300">Owner password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} aria-hidden />
                    <input
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-sm text-white placeholder-slate-600 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                      required
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white transition hover:bg-orange-500 disabled:opacity-60">
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : 'Sign in to admin'}
                </button>
              </form>
            </>
          )}

          <Link to="/" className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-300"><ArrowLeft size={13} /> Back to krosz.com</Link>
        </div>
      </div>
    </div>
  );
}