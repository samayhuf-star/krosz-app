import { Link } from 'react-router-dom';
import { ArrowRight, CreditCard, Wrench } from 'lucide-react';
import { useSeo } from '@/lib/seo';

export default function Pricing() {
  useSeo({
    title: 'Pricing — Krosz visa tools for Indian travellers',
    description: 'How Krosz pricing works for Indian passport holders. Explore visa tools and destination fees without a surprise homepage redirect.',
    canonical_path: '/pricing',
    robots: 'index,follow',
  });

  return (
    <div className="min-h-screen bg-[#f8faf9] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="text-base font-semibold text-slate-900">Krosz</Link>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            Back to home <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pricing</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
          Clear pricing for your visa journey
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-700">
          Krosz shows government fees and service fees per destination before you commit.
          This page is a public overview — pick a destination or open Travel Tools to see fees for your route.
          We do not invent plan tiers here.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CreditCard size={16} className="text-emerald-600" /> What you pay
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Destination pages list government visa fees plus any Krosz service fee for that route.
              Totals are confirmed again before payment.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wrench size={16} className="text-emerald-600" /> Free tools
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Eligibility checks, fee calculators, and visa-free lookups on Travel Tools stay available without buying a plan.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/tools" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
            Open Travel Tools <ArrowRight size={16} />
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Browse destinations
          </Link>
        </div>
      </main>
    </div>
  );
}
