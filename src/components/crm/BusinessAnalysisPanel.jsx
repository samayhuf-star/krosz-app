import { Briefcase, Users, MapPin, Target, AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function BusinessAnalysisPanel({ analysis }) {
  if (!analysis) return <Empty />;
  const a = analysis;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Industry & Segment"><Chip icon={Briefcase} items={[a.industry, a.vertical_segment].filter(Boolean)} /></Card>
        <Card title="Sales Cycle" icon={Clock}>
          {a.sales_cycle ? (
            <dl className="space-y-1 text-sm">
              <Row k="Duration" v={a.sales_cycle.duration} />
              <Row k="Complexity" v={a.sales_cycle.complexity} />
              <Row k="Decision maker" v={a.sales_cycle.decision_maker} />
            </dl>
          ) : <p className="text-sm text-slate-500">—</p>}
        </Card>
        <Card title="Services" icon={Target}>{a.services?.length ? <Chips items={a.services} /> : <p className="text-sm text-slate-500">—</p>}</Card>
        <Card title="Target Audience" icon={Users}>{a.target_audience?.length ? <Chips items={a.target_audience} /> : <p className="text-sm text-slate-500">—</p>}</Card>
      </div>
      <Card title="Customer Journey" icon={MapPin}>
        <ol className="space-y-3">
          {a.customer_journey?.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{i + 1}</span>
              <div className="flex-1"><div className="flex flex-wrap items-baseline gap-2"><p className="font-semibold text-slate-900">{s.step}</p><Badge variant="outline" className="border-slate-300 text-slate-500">{s.touchpoint || ''}</Badge></div><p className="text-sm text-slate-600">{s.description}</p></div>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Lead Sources" icon={TrendingUp}>{a.lead_sources?.length ? <Chips items={a.lead_sources} tone="emerald" /> : <p className="text-sm text-slate-500">—</p>}</Card>
        <Card title="Business Goals" icon={Target}><ul className="space-y-1 text-sm text-slate-700">{a.business_goals?.map((g, i) => <li key={i} className="flex gap-2"><span className="text-emerald-600">•</span>{g}</li>)}</ul></Card>
        <Card title="Pain Points" icon={AlertTriangle}><ul className="space-y-1 text-sm text-slate-700">{a.pain_points?.map((p, i) => <li key={i} className="flex gap-2"><span className="text-amber-600">•</span>{p}</li>)}</ul></Card>
        <Card title="Industry Notes" icon={Briefcase}><p className="text-sm text-slate-700">{a.industry_notes || '—'}</p></Card>
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, children }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-3 flex items-center gap-2"><Icon size={16} className="text-emerald-700" /><h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3></div>{children}</div>; }
function Row({ k, v }) { return <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium capitalize text-slate-800">{v || '—'}</dd></div>; }
function Chips({ items, tone = 'slate' }) { return <div className="flex flex-wrap gap-1.5">{items.map((x, i) => <Badge key={i} variant="outline" className={tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-slate-300 text-slate-700'}>{x}</Badge>)}</div>; }
function Chip({ icon: Icon, items }) { return <div className="flex flex-wrap gap-1.5">{items.map((x, i) => <Badge key={i} variant="outline" className="border-slate-300 text-slate-700">{Icon ? <Icon size={12} className="mr-1 text-emerald-600" /> : null}{x}</Badge>)}</div>; }
function Empty() { return <p className="text-sm text-slate-500">No business analysis available.</p>; }