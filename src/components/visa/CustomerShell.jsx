import { Outlet, NavLink, Link } from 'react-router-dom';
import { Home, FileText, Users, Bell, LifeBuoy, Plus, UserRound, LogOut, Menu, X, Plane, Settings } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import UserMenu from '@/components/visa/UserMenu';
import TravelerConcierge from '@/components/visa/TravelerConcierge';

const LINKS = [
  { to: '/home', label: 'Home', icon: Home, end: true },
  { to: '/applications', label: 'Applications', icon: FileText },
  { to: '/travelers', label: 'Travelers', icon: Users },
  { to: '/trips', label: 'Trips', icon: Plane },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/notifications', label: 'Updates', icon: Bell },
];

function CustomerNavLink({ to, label, icon: Icon, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => `flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${isActive ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/70 hover:text-slate-950'}`}
    >
      <Icon size={17} /> {label}
    </NavLink>
  );
}

export default function CustomerShell() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f5f7fa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-5">
          <Link to="/home" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#003580] text-sm font-black text-white shadow-sm">K</span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-slate-950">Krosz</p>
              <p className="text-[10px] text-slate-400">Your visa journey</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((item) => <CustomerNavLink key={item.to} {...item} />)}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/apply" className="hidden items-center gap-1.5 rounded-full bg-[#003580] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00225A] sm:inline-flex"><Plus size={16} /> New application</Link>
            <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 md:hidden" aria-label="Open menu">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
            <UserMenu />
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
            <div className="grid gap-1">
              {LINKS.map((item) => <CustomerNavLink key={item.to} {...item} onClick={() => setMenuOpen(false)} />)}
              <CustomerNavLink to="/support" label="Support" icon={LifeBuoy} onClick={() => setMenuOpen(false)} />
              <CustomerNavLink to="/profile" label="Profile" icon={UserRound} onClick={() => setMenuOpen(false)} />
              <CustomerNavLink to="/account" label="Settings" icon={Settings} onClick={() => setMenuOpen(false)} />
              <button type="button" onClick={() => { setMenuOpen(false); logout(true); }} className="mt-1 flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-white/70 hover:text-slate-950"><LogOut size={17} /> Sign out</button>
              <Link to="/apply" onClick={() => setMenuOpen(false)} className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-[#003580] px-5 py-2.5 text-sm font-semibold text-white"><Plus size={16} /> New application</Link>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-5 sm:py-10">
        <Outlet />
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-slate-200/70 px-4 py-7 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>Signed in as <span className="font-medium text-slate-600">{user?.email || 'traveler'}</span></div>
        <div className="flex items-center gap-4">
          <Link to="/support" className="hover:text-slate-700">Support</Link>
          <Link to="/help" className="hover:text-slate-700">Help</Link>
          <Link to="/legal" className="hover:text-slate-700">Legal</Link>
          <Link to="/trust" className="hover:text-slate-700">Trust</Link>
          <Link to="/account" className="hover:text-slate-700">Account</Link>
          <button type="button" onClick={() => logout(true)} className="inline-flex items-center gap-1 hover:text-slate-700"><LogOut size={12} /> Sign out</button>
        </div>
      </footer>

      <TravelerConcierge />
    </div>
  );
}