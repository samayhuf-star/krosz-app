import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';

// Minimal, non-blocking cookie consent banner. Stores the user's choice locally
// (no tracking fired until consent). Links to the Cookie Policy. Mounted in the
// customer shell and the public legal shell so it appears across the journey.
export default function CookieConsent() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(!localStorage.getItem('krosz_cookie_consent')); } catch { setOpen(true); }
  }, []);
  if (!open) return null;
  const decide = (val) => { try { localStorage.setItem('krosz_cookie_consent', val); } catch {} setOpen(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:flex sm:items-center sm:gap-4">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700 sm:flex"><Cookie size={18} /></span>
        <p className="flex-1 text-xs leading-5 text-slate-600">
          We use cookies to keep you signed in and remember your preferences. We don't sell your data. See our <Link to="/cookie-policy" className="font-medium text-[#006CEC] hover:underline">Cookie Policy</Link>.
        </p>
        <div className="mt-3 flex shrink-0 gap-2 sm:mt-0">
          <button onClick={() => decide('essential')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Essential only</button>
          <button onClick={() => decide('all')} className="rounded-lg bg-[#003580] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00225A]">Accept all</button>
          <button onClick={() => decide('dismissed')} aria-label="Dismiss" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"><X size={14} /></button>
        </div>
      </div>
    </div>
  );
}