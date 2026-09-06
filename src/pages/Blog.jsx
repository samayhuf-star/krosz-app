import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { useSeo } from '@/lib/seo';

export default function Blog() {
  useSeo({
    title: 'Travel Journal — Krosz blog',
    description: 'Visa tips and travel notes for Indian passport holders. The Krosz Travel Journal will grow here — this is not the homepage.',
    canonical_path: '/blog',
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
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Travel Journal</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
          Krosz blog
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-700">
          Guides and notes for Indian travellers — eligibility tips, document checklists, and destination basics.
          New articles will appear here. Nothing has been published yet.
        </p>

        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <BookOpen size={22} />
          </span>
          <p className="mt-4 text-sm font-semibold text-slate-900">No posts yet</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Check back soon, or explore destinations and Travel Tools meanwhile.
          </p>
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
