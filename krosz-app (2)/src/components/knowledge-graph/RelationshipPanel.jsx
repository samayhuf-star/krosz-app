import { useMemo } from 'react';
import { GitBranch, Boxes } from 'lucide-react';

const NODE_LABELS = {
  business: 'Business', blueprint: 'Blueprint', website: 'Website', page: 'Pages',
  crm: 'CRM', pipeline: 'Pipeline', pipeline_stage: 'Pipeline Stages', score_rule: 'Lead Score Rules',
  automation: 'Automations', task_template: 'Task Templates', email_template: 'Email Templates',
  dashboard_widget: 'Dashboard Widgets', crm_report: 'CRM Reports',
  domain: 'Domain', seo: 'SEO', keyword: 'Keywords', keyword_cluster: 'Clusters',
  content_opportunity: 'Content Opportunities', image_seo: 'Image SEO',
};

export default function RelationshipPanel({ graph }) {
  const nodes = graph?.nodes || [];
  const rels = graph?.relationships || [];

  const byType = useMemo(() => {
    const m = {};
    for (const n of nodes) m[n.type] = (m[n.type] || 0) + 1;
    return m;
  }, [nodes]);

  const relByType = useMemo(() => {
    const m = {};
    for (const r of rels) m[r.type] = (m[r.type] || 0) + 1;
    return m;
  }, [rels]);

  const relSamples = useMemo(() => {
    const labelOf = {};
    for (const n of nodes) labelOf[n.id] = n.label;
    return rels.slice(0, 40).map((r) => ({ type: r.type, from: labelOf[r.source] || r.source, to: labelOf[r.target] || r.target }));
  }, [nodes, rels]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2"><Boxes className="text-emerald-700" size={18} /><h3 className="text-sm font-semibold text-slate-900">Nodes by type</h3></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <div key={t} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs text-slate-600">{NODE_LABELS[t] || t}</span>
                <span className="text-sm font-bold text-slate-900">{n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2"><GitBranch className="text-emerald-700" size={18} /><h3 className="text-sm font-semibold text-slate-900">Relationships by type</h3></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(relByType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <div key={t} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="truncate text-xs text-slate-600" title={t}>{t.replace(/_/g, ' ')}</span>
                <span className="text-sm font-bold text-slate-900">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Cross-module edges (sample)</h3>
        {relSamples.length === 0 ? (
          <p className="text-sm text-slate-400">No relationships. Rebuild the graph after generating upstream modules.</p>
        ) : (
          <ul className="space-y-1.5">
            {relSamples.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{r.from}</span>
                <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">{r.type.replace(/_/g, ' ')}</span>
                <span className="text-slate-400">→</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{r.to}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}