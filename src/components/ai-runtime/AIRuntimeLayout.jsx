import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Boxes, Cpu, MessageSquare, BarChart3, Activity, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: '/ai-runtime', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ai-runtime/providers', label: 'Providers', icon: Boxes },
  { to: '/ai-runtime/models', label: 'Models', icon: Cpu },
  { to: '/ai-runtime/playground', label: 'Playground', icon: MessageSquare },
  { to: '/ai-runtime/usage', label: 'Usage & Costs', icon: BarChart3 },
  { to: '/ai-runtime/health', label: 'Health', icon: Activity },
  { to: '/ai-runtime/logs', label: 'Execution Logs', icon: ScrollText },
];

export default function AIRuntimeLayout() {
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-1 overflow-x-auto px-4 py-2 sm:px-8 lg:px-10">
          <span className="mr-2 hidden whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-400 sm:inline">AI Runtime</span>
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors', isActive ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
              <Icon size={15} />{label}
            </NavLink>
          ))}
        </div>
      </div>
      <Outlet />
    </>
  );
}