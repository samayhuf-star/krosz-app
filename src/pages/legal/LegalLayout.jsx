import { Outlet, Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { POLICIES } from '@/lib/policyRegistry';

// Public shell for legal/trust/policy pages. These pages are anonymous and
// must not sit behind the authenticated CustomerShell.
export default function LegalLayout() {
  const legal = POLICIES.filter((p) => p.category === 'legal');
  const trust = POLICIES.filter((p) => p.category !== 'legal');
  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f5f7fa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#003580] text-sm font-black text-white">K</span>
            <span className="text-sm font-bold">Krosz</span>
            <span className="hidden text-xs text-slate-400 sm:inline">Trust & Legal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
            <Link to="/legal" className="hover:text-slate-900">Legal</Link>
            <Link to="/trust" className="hover:text-slate-900">Trust Center</Link>
            <Link to="/ai-transparency" className="hidden hover:text-slate-900 sm:inline">AI</Link>
            <Link to="/" className="hover:text-slate-900">Back to site</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
          <FooterCol title="Krosz" links={[['Home', '/'], ['Trust Center', '/trust'], ['How Krosz uses AI', '/ai-transparency']]} />
          <FooterCol title="Legal" links={legal.map((p) => [p.title, p.path]).slice(0, 8)} />
          <FooterCol title="More legal" links={legal.map((p) => [p.title, p.path]).slice(8)} />
          <FooterCol title="Trust & safety" links={trust.map((p) => [p.title, p.path])} />
        </div>
        <div className="border-t border-slate-100 px-4 py-5 text-center text-xs text-slate-400 sm:px-6">
          <ShieldCheck size={13} className="mr-1 inline" /> Krosz is a private service and is not affiliated with any government authority. Visa decisions are made by the relevant government.
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }) {
  if (!links.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, to]) => (
          <li key={to}><Link to={to} className="text-sm text-slate-600 hover:text-slate-900">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}