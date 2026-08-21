import { topActions, topPages, failureCount } from '@/lib/productLearning';

export default function ProductInsights() {
  const acts = topActions(6);
  const pages = topPages(6);
  const fails = failureCount();
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Product insights</h3>
        <span className="text-xs text-slate-400">anonymous · local only</span>
      </div>
      <p className="mb-4 text-xs text-slate-500">The platform learns from your usage to suggest improvements — it never changes your data or behavior automatically.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Most used actions</p>
          {acts.length === 0 ? <p className="text-sm text-slate-400">No data yet.</p> : (
            <ul className="space-y-1.5">
              {acts.map((a) => (
                <li key={a.name} className="flex items-center justify-between text-sm">
                  <span className="truncate capitalize text-slate-600">{a.name.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-slate-800">{a.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Most visited screens</p>
          {pages.length === 0 ? <p className="text-sm text-slate-400">No data yet.</p> : (
            <ul className="space-y-1.5">
              {pages.map((p) => (
                <li key={p.path} className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-600">{p.path}</span>
                  <span className="font-medium text-slate-800">{p.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        Repeated failures recorded: <span className={fails > 0 ? 'font-medium text-amber-600' : 'text-slate-400'}>{fails}</span>
      </div>
    </div>
  );
}