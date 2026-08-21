import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Images, Layers, FileText, Gauge } from 'lucide-react';
import ProvenanceChip from './ProvenanceChip';

export default function WebsiteSummary({ summary, provenance, validation }) {
  const s = summary || {};
  const v = validation?.summary || {};
  const cards = [
    { label: 'Pages', value: s.page_count ?? 0, icon: FileText },
    { label: 'Components', value: s.component_count ?? 0, icon: Layers },
    { label: 'Media items', value: s.media_count ?? 0, icon: Images },
    { label: 'Pages with SEO', value: s.seo_summary?.with_meta ?? 0, icon: CheckCircle2 },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
            <c.icon size={16} className="text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{c.value}</p>
        </div>
      ))}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2 lg:col-span-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Gauge size={16} className="text-emerald-600" />
            <span className="font-medium text-slate-700">Validation:</span>
            {validation?.status === 'pass' ? <Badge className="bg-emerald-600">Pass</Badge>
              : validation?.status === 'warning' ? <Badge className="bg-amber-500">Warning</Badge>
              : <Badge className="bg-rose-500">Fail</Badge>}
            <span className="text-slate-500">{v.errors || 0} errors · {v.warnings || 0} warnings · {v.passed || 0} passed</span>
          </div>
          <ProvenanceChip provenance={provenance} />
        </div>
        {s.estimated_publish_time && <p className="mt-2 text-xs text-slate-500">{s.estimated_publish_time}</p>}
      </div>
    </div>
  );
}