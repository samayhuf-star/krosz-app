import { NavLink } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminAccess';
import {
  Globe, Globe2, Home, Compass, FolderOpen, FileText, Bell, MessageSquare,
  Settings, CalendarDays, Headset, ShieldCheck, Send, Wallet, Workflow, Users, Plane, Bookmark, FileEdit, ListChecks, Briefcase, ClipboardList, ClipboardCheck, LogOut, Activity, LifeBuoy, LayoutDashboard, AlertOctagon, ServerCog, Rocket, GitPullRequest,
} from 'lucide-react';

const TRAVELER_LINKS = [
  { to: '/home', label: 'Home', icon: Home, end: true },
  { to: '/apply', label: 'Explore Visas', icon: Compass },
  { to: '/cases', label: 'My Cases', icon: ListChecks },
  { to: '/applications', label: 'Applications', icon: FolderOpen },
  { to: '/travelers', label: 'Travelers', icon: Users },
  { to: '/trips', label: 'Trips', icon: Plane },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/support', label: 'Support', icon: MessageSquare },
  { to: '/saved', label: 'Saved', icon: Bookmark },
  { to: '/account', label: 'Account', icon: Settings },
];

const ADMIN_GROUPS = [
  { label: 'Overview', links: [
    { to: '/admin/control-tower', label: 'Launch Control Tower', icon: Rocket },
    { to: '/admin/hub', label: 'Command Center', icon: LayoutDashboard },
    { to: '/admin/failures', label: 'Failures & Incidents', icon: AlertOctagon },
  ]},
  { label: 'Customers & Cases', links: [
    { to: '/admin/users', label: 'Users & Customers', icon: Users },
    { to: '/admin/cases', label: 'Visa Cases & Status', icon: Briefcase },
    { to: '/admin/reviews', label: 'Visa Review Queue', icon: ShieldCheck },
  ]},
  { label: 'Operations', links: [
    { to: '/admin/operations-command-center', label: 'Command Center', icon: LayoutDashboard },
    { to: '/admin/tasks', label: 'Operations Queue', icon: ClipboardList },
    { to: '/admin/operations', label: 'Submission Operations', icon: Workflow },
    { to: '/ops/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/admin/support', label: 'Tickets & Support', icon: Headset },
    { to: '/admin/finance', label: 'Payments & Refunds', icon: Wallet },
  ]},
  { label: 'Reliability', links: [
    { to: '/admin/engine-health', label: 'Engine & Provider Health', icon: ServerCog },
    { to: '/admin/qa', label: 'QA Command Center', icon: Activity },
    { to: '/admin/system-flow-qa', label: 'System Flow QA', icon: ClipboardCheck },
  ]},
  { label: 'Engineering', links: [
    { to: '/admin/pull-requests', label: 'GitHub Pull Requests', icon: GitPullRequest },
  ]},
  { label: 'Visa Configuration', links: [
    { to: '/admin/country-capabilities', label: 'Country Coverage', icon: Globe2 },
    { to: '/admin/visa-intelligence', label: 'Visa Rules & Sources', icon: Globe },
    { to: '/admin/visa-providers', label: 'Visa Providers', icon: Globe },
    { to: '/admin/submission-providers', label: 'Submission Providers', icon: Send },
    { to: '/admin/government-forms', label: 'Government Forms', icon: Send },
  ]},
  { label: 'Content & Governance', links: [
    { to: '/admin/destination-content', label: 'Destination Content', icon: FileEdit },
    { to: '/admin/help-content', label: 'Help & FAQ Content', icon: LifeBuoy },
    { to: '/admin/trust-compliance', label: 'Trust & Compliance', icon: ShieldCheck },
  ]},
];

const ADMIN_LINKS = ADMIN_GROUPS.flatMap((group) => group.links);

function NavGroup({ links }) {
  return links.map(({ to, label, icon: Icon, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
          isActive
            ? 'bg-orange-50 font-semibold text-orange-800'
            : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`
      }
    >
      <Icon size={18} /> {label}
    </NavLink>
  ));
}

export default function WorldzSidebar() {
  const { user, logout } = useAuth();
  const isAdmin = isAppAdmin(user);
  const links = isAdmin ? ADMIN_LINKS : TRAVELER_LINKS;

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white"><Globe size={18} /></span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Krosz Admin</p>
            <p className="text-[11px] text-slate-400">Visa operations console</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {isAdmin ? ADMIN_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{group.label}</p>
              <NavGroup links={group.links} />
            </div>
          )) : <NavGroup links={TRAVELER_LINKS} />}
        </nav>
        <div className="border-t border-slate-100 px-3 py-3">
          <p className="px-2 pb-2 text-[11px] leading-4 text-slate-400">
            Some requirements are <span className="font-medium text-amber-600">still being verified</span> against authoritative sources.
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t bg-white px-1 py-1 md:hidden">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) =>
              `flex min-w-[68px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] ${
                isActive ? 'text-orange-700' : 'text-slate-500'
              }`
            }
          >
            <Icon size={18} />
            <span className="max-w-[64px] truncate">{label.split(' ')[0]}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => logout()}
          aria-label="Sign out"
          className="flex min-w-[68px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-slate-500 hover:text-rose-700"
        >
          <LogOut size={18} />
          <span className="max-w-[64px] truncate">Sign out</span>
        </button>
      </nav>
    </>
  );
}