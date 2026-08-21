import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

// Top-right account dropdown for the customer shell. Replaces the plain avatar
// link with Profile / Settings / Logout. Auth + navigation use the existing
// useAuth helpers; no new business logic.
export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const initial = String(user?.full_name || user?.email || 'K').trim().charAt(0).toUpperCase() || 'K';

  const handleLogout = () => { setOpen(false); logout(true); };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#003580] text-xs font-bold text-white">{initial}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-[0_24px_70px_-46px_rgba(15,23,42,.28)]">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-sm font-semibold text-[#081A5C]">{user?.full_name || 'Traveler'}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || ''}</p>
          </div>
          <Link to="/profile" onClick={() => setOpen(false)} role="menuitem" className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[#081A5C] hover:bg-[#E7F0FE]">
            <UserRound size={16} className="text-[#006CEC]" /> Profile
          </Link>
          <Link to="/account" onClick={() => setOpen(false)} role="menuitem" className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[#081A5C] hover:bg-[#E7F0FE]">
            <Settings size={16} className="text-[#006CEC]" /> Settings
          </Link>
          <div className="my-1 h-px bg-slate-100" />
          <button type="button" onClick={handleLogout} role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-[#081A5C] hover:bg-[#E7F0FE]">
            <LogOut size={16} className="text-[#006CEC]" /> Logout
          </button>
        </div>
      )}
    </div>
  );
}