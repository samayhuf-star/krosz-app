import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import {
  ClipboardList, Briefcase, Activity, Globe, Globe2, FileEdit, CalendarDays,
  Headset, ShieldCheck, Send, Wallet, Workflow, ArrowRight,
} from 'lucide-react';

// All admin tools in one place. Rendered inside WorldzShell so the admin
// sidebar/topbar keep working; this is just the landing grid.
const ADMIN_PAGES = [
  { to: '/admin/tasks', label: 'Operations Queue', icon: ClipboardList, desc: 'Live operational task queue for your team.' },
  { to: '/admin/cases', label: 'Case Management', icon: Briefcase, desc: 'All customer visa cases across destinations.' },
  { to: '/admin/qa', label: 'QA Command Center', icon: Activity, desc: 'QA reports, findings and regression runs.' },
  { to: '/admin/visa-providers', label: 'Visa Providers', icon: Globe, desc: 'Manage visa provider catalog and bindings.' },
  { to: '/admin/country-capabilities', label: 'Country Matrix', icon: Globe2, desc: 'Country capability and provider matrix.' },
  { to: '/admin/destination-content', label: 'Destination Content', icon: FileEdit, desc: 'Edit destination SEO and landing content.' },
  { to: '/ops/appointments', label: 'Appointments', icon: CalendarDays, desc: 'Appointment ops and slot coordination.' },
  { to: '/admin/visa-intelligence', label: 'Visa Intelligence', icon: Globe, desc: 'Visa intelligence versions and sources.' },
  { to: '/admin/support', label: 'Support Console', icon: Headset, desc: 'Support tickets and conversations.' },
  { to: '/admin/reviews', label: 'Review Console', icon: ShieldCheck, desc: 'Reviews, findings and review rules.' },
  { to: '/admin/government-forms', label: 'Form Catalog', icon: Send, desc: 'Government form definitions and mappings.' },
  { to: '/admin/submission-providers', label: 'Submission Providers', icon: Send, desc: 'Submission provider configuration.' },
  { to: '/admin/finance', label: 'Finance', icon: Wallet, desc: 'Payments, invoices and refunds.' },
  { to: '/admin/operations', label: 'Operations', icon: Workflow, desc: 'Operations dashboard and case detail.' },
];

export default function AdminHub() {
  const { user } = useAuth();
  const firstName = (user?.full_name || user?.email || 'Owner').split(' ')[0];

  return (
    <div className="pb-10">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_70px_-50px_rgba(15,23,42,.4)] sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Admin console</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Welcome back, {firstName}.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Everything you need to run Krosz — cases, operations, providers, content, reviews, finance and forms — in one place.</p>
      </section>

      <section className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950">All admin tools</h2>
          <span className="text-xs text-slate-500">{ADMIN_PAGES.length} modules</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_PAGES.map((p) => (
            <Link key={p.to} to={p.to} className="group rounded-[22px] border border-slate-200/80 bg-white p-5 transition duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_20px_50px_-34px_rgba(15,23,42,.35)]">
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition group-hover:bg-orange-600 group-hover:text-white"><p.icon size={18} /></span>
                <ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-600" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-slate-950">{p.label}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{p.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}