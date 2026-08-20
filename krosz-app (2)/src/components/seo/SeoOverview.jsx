import { Badge } from '@/components/ui/badge';
import { KeyRound, Network, FileText, ShieldCheck, Activity, Link2, AlertTriangle } from 'lucide-react';
import ProvenanceChip from '@/components/website/ProvenanceChip';

function HealthRing({ score }) {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  const color = s >= 80 ? '#059669' : s >= 50 ? '#d97706' : '#e11d48';
  const r = 34, c = 2 * Math.PI * r;
  const off = c - (s / 100) * c;
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={r} stroke="#e2e8f0" strokeWidth="8" fill="none" />
        <circle cx="42" cy="42" r={r} stroke={color} strokeWidth="8" fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">SEO Health Score</p>
        <p className="text-3xl font-semibold" style={{ color }}>{s}<span className="text-base text-slate-400">/100</span></p>
        <Badge variant="outline" className="mt-1 border-slate-300 text-slate-600">{s >= 80 ? 'Strong' : s >= 50 ? 'Needs work' : 'Critical'}</Badge>
      </div>
    </div>
  );
}

export default function SeoOverview({ version, provenance }) {
  if (!version) return null;
  const v = version, s = v.summary || {}, val = v.validation?.summary || {};
  const cards = [
    { label: 'Keywords', value: v.keyword_count || 0, icon: KeyRound },
    { label: 'Topic clusters', value: v.cluster_count || 0, icon: Network },
    { label: 'Pages optimized', value: Object.keys(v.page_seo || {}).length, icon: FileText },
    { label: 'Schema definitions', value: v.schema_count || 0, icon: ShieldCheck },
    { label: 'Internal links', value: v.internal_link_count || 0, icon: Link2 },
    { label: 'Validation issues', value: (val.errors || 0) + (val.warnings || 0), icon: AlertTriangle },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <HealthRing score={v.health_score} />
        <div className="grid grid-cols-2 gap-3 lg:col-span-3 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p><c.icon size={15} className="text-emerald-600" /></div>
              <p className="mt-1.5 text-2xl font-semibold text-slate-900">{c.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Activity size={16} className="text-emerald-600" />
          <span className="font-medium text-slate-700">Validation:</span>
          <Badge className={v.validation?.status === 'pass' ? 'bg-emerald-600' : v.validation?.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500'}>{v.validation?.status || '—'}</Badge>
          <span className="text-slate-500">Schema coverage: {val.schema_coverage ?? 0}% · {val.errors || 0} errors · {val.warnings || 0} warnings · {val.passed || 0} passed</span>
        </div>
        <ProvenanceChip provenance={provenance} />
      </div>
    </div>
  );
}