import { Globe, ScrollText, Factory, Users, Search, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const MODULES = [
  { key: 'blueprint', label: 'Business Blueprint', icon: ScrollText, module: 'blueprint' },
  { key: 'website', label: 'Website', icon: Factory, module: 'website' },
  { key: 'crm', label: 'CRM', icon: Users, module: 'crm' },
  { key: 'domain', label: 'Domain', icon: Globe, module: 'domain' },
  { key: 'seo', label: 'SEO', icon: Search, module: 'seo' },
];

export default function CoveragePanel({ coverage, stats, stale, staleReasons }) {
  const cards = MODULES.map((m) => {
    const data = coverage?.[m.key] ?? null;
    return { ...m, data };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          {stale ? <AlertTriangle className="text-amber-500" size={22} /> : <CheckCircle2 className="text-emerald-600" size={22} />}
          <div>
            <p className="text-sm font-semibold text-slate-900">{stale ? 'Graph is stale' : 'Graph is fresh'}</p>
            <p className="text-xs text-slate-500">
              {stale ? (staleReasons?.length ? staleReasons.join(' · ') : 'Upstream modules changed — rebuild to sync.') : 'All upstream modules match the captured snapshot.'}
            </p>
          </div>
        </div>
        {stats && (
          <div className="flex gap-6 text-right">
            <div><p className="text-2xl font-bold text-slate-900">{stats.node_count}</p><p className="text-xs text-slate-500">nodes</p></div>
            <div><p className="text-2xl font-bold text-slate-900">{stats.relationship_count}</p><p className="text-xs text-slate-500">relationships</p></div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const present = !!c.data;
          const Icon = c.icon;
          return (
            <div key={c.key} className={`rounded-xl border p-4 ${present ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${present ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}><Icon size={18} /></span>
                  <p className="text-sm font-semibold text-slate-900">{c.label}</p>
                </div>
                {present ? <CheckCircle2 className="text-emerald-600" size={18} /> : <XCircle className="text-slate-300" size={18} />}
              </div>
              <div className="mt-3 text-xs text-slate-600">
                {present ? (
                  <dl className="space-y-1">
                    {c.data.version != null && <div className="flex justify-between"><dt className="text-slate-400">Version</dt><dd className="font-medium">v{c.data.version}</dd></div>}
                    {c.data.status && <div className="flex justify-between"><dt className="text-slate-400">Status</dt><dd className="font-medium capitalize">{c.data.status}</dd></div>}
                    {c.data.page_count != null && <div className="flex justify-between"><dt className="text-slate-400">Pages</dt><dd className="font-medium">{c.data.page_count}</dd></div>}
                    {c.data.stage_count != null && <div className="flex justify-between"><dt className="text-slate-400">Stages</dt><dd className="font-medium">{c.data.stage_count}</dd></div>}
                    {c.data.keyword_count != null && <div className="flex justify-between"><dt className="text-slate-400">Keywords</dt><dd className="font-medium">{c.data.keyword_count}</dd></div>}
                    {c.data.cluster_count != null && <div className="flex justify-between"><dt className="text-slate-400">Clusters</dt><dd className="font-medium">{c.data.cluster_count}</dd></div>}
                    {c.data.domain_name && <div className="flex justify-between"><dt className="text-slate-400">Domain</dt><dd className="font-medium truncate ml-2">{c.data.domain_name}</dd></div>}
                    {c.data.health_score != null && <div className="flex justify-between"><dt className="text-slate-400">Health</dt><dd className="font-medium">{c.data.health_score}</dd></div>}
                  </dl>
                ) : (
                  <p className="text-slate-400">Not generated yet.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}