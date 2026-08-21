import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { History, RotateCcw, Loader2, Bug } from 'lucide-react';

export default function VersionsPanel({ draft, onPublish, onRollback }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState('');
  const [taskKey, setTaskKey] = useState('');
  const [debug, setDebug] = useState(null);

  const load = async () => {
    if (!draft?.template_id) return;
    setLoading(true);
    try {
      const { studioApi } = await import('@/lib/studioApi');
      const r = await studioApi.versions(draft.template_id);
      setVersions(r.versions || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [draft?.template_id, draft?.published_version]);

  const dbg = async () => {
    if (!run || !taskKey) return;
    const { studioApi } = await import('@/lib/studioApi');
    setDebug(await studioApi.debugNode(run, taskKey));
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div>
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><History size={13} /> Version history</p>
        {loading && <p className="text-slate-400"><Loader2 size={12} className="inline animate-spin" /> loading…</p>}
        {!loading && versions.length === 0 && <p className="text-slate-400">Not published yet. Publish to create version 1.</p>}
        <div className="space-y-1">
          {versions.map((v) => (
            <div key={v.version} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5">
              <div>
                <p className="font-medium text-slate-700">v{v.version} · {v.name}</p>
                <p className="text-[10px] text-slate-400">{v.task_count} tasks · {v.active ? 'active' : 'inactive'}</p>
              </div>
              {!v.active && draft?.template_id && (
                <Button variant="ghost" size="sm" onClick={() => onRollback(v.version)} className="h-6 text-[10px]"><RotateCcw size={11} /> rollback</Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-2">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><Bug size={13} /> Debugger</p>
        <p className="mb-1 text-[10px] text-slate-400">Inspect a node in a real run — inputs, outputs, provider, cost, tokens, retries.</p>
        <input value={run} onChange={(e) => setRun(e.target.value)} placeholder="run id" className="mb-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px]" />
        <input value={taskKey} onChange={(e) => setTaskKey(e.target.value)} placeholder="task key" className="mb-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px]" />
        <Button variant="outline" size="sm" onClick={dbg} className="h-7 w-full text-[11px]">Inspect node</Button>
        {debug && (
          <div className="mt-2 rounded-md border border-slate-200 p-2 text-[10px]">
            <p className="font-semibold text-slate-600">{debug.task?.task_key} · {debug.task?.status}</p>
            <p className="text-slate-400">provider: {debug.task?.provider_id || '—'} · retries: {debug.task?.retry_count}/{debug.task?.max_retries} · {debug.task?.duration_ms}ms</p>
            {debug.executions?.map((e) => (
              <p key={e.id} className="mt-1 text-slate-500">attempt {e.attempt}: {e.provider} · {e.tokens} tok · ${e.estimated_cost} · {e.success ? '✓' : '✗ ' + (e.error_code || '')}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}