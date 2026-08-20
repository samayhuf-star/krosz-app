import { Search, ArrowRight, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export default function SearchVisibilityPanel({ active, version }) {
  if (!active || !version) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><Search size={22} /></span>
        <p className="mt-3 text-sm font-semibold text-slate-700">Search visibility not measured yet</p>
        <p className="mt-1 text-xs text-slate-500">Run the AI SEO program to generate keywords, metadata, and a visibility score for your business.</p>
        <Button asChild className="mt-4 bg-slate-900 hover:bg-slate-800"><Link to="/seo">Open AI SEO Factory <ArrowRight size={14} /></Link></Button>
      </div>
    );
  }
  const keywords = (active.keywords || []).slice(0, 6);
  const health = version.health_score ?? 0;
  return (
    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
      <div className="flex flex-col items-center justify-center rounded-xl bg-emerald-50/50 p-4 text-center">
        <span className="text-3xl font-bold text-emerald-700">{health}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">SEO health</span>
      </div>
      <div className="sm:col-span-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><TrendingUp size={14} className="text-emerald-600" /> Top target keywords</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keywords.length ? keywords.map((k, i) => (
            <span key={(k.term || k.keyword || i)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">{k.term || k.keyword || k}</span>
          )) : <span className="text-xs text-slate-400">No keywords yet.</span>}
        </div>
        <p className="mt-3 text-xs text-slate-500">{version.keyword_count || 0} keywords · {version.cluster_count || 0} clusters · {version.schema_count || 0} schema marks</p>
        <Button asChild size="sm" variant="outline" className="mt-3"><Link to="/seo">Manage SEO in detail <ArrowRight size={14} /></Link></Button>
      </div>
    </div>
  );
}