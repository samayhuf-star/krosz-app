import { Link } from 'react-router-dom';
import { Globe, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

// Minimal public discovery header used by the search-first homepage, destination
// pages, and search results. Adapts CTA to auth state but never gates exploration
// (§31 — visitors explore without an account).
export default function DiscoveryHeader({ onSearchClick = null }) {
  const { isAuthenticated: authed, authChecked } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-[#f5f7fa]/88 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-[68px] sm:px-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[#003580] text-white shadow-sm"><Globe size={17} /></span>
          <span className="text-base font-bold tracking-[-0.025em] text-slate-950">Krosz</span>
        </Link>
        <nav className="flex items-center gap-2">
          {onSearchClick &&
          <button onClick={onSearchClick} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:inline-flex">Search</button>
          }
          <Link to={authed ? '/applications' : '/login?returnTo=%2Fapplications'} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:inline-flex">My applications</Link>
          {authChecked && authed ?
          <Link to="/home" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#003580] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00225A] sm:px-5">Dashboard <ArrowRight size={14} /></Link> :

          <>
              <Link to="/login" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:inline-flex">Sign in</Link>
              <Link to="/register" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#003580] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00225A] sm:px-5">Sign up <ArrowRight size={14} /></Link>
            </>
          }
        </nav>
      </div>
    </header>);

}