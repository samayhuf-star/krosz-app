import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { adminExceptionUpdate } from '@/lib/adminCaseApi';
import { AlertTriangle } from 'lucide-react';

const SEV = { CRITICAL: 'rose', HIGH: 'amber', MEDIUM: 'amber', LOW: 'slate' };

export default function SecExceptions({ d, reload, caseId }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const signals = d.exceptions || [];
  const persisted = d.persisted_exceptions || [];
  const act = async (id, patch) => {
    setBusy(id + (patch.status || '')); try { await adminExceptionUpdate({ exception_id: id, ...patch }); toast({ title: 'Exception updated' }); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Detected signals (deterministic)</h3>
        {signals.length === 0 ? <p className="mt-2 text-sm text-emerald-700">No active exceptions.</p> : (
          <ul className="mt-2 space-y-1.5">
            {signals.map((s, i) => <li key={i} className="flex items-start gap-2 text-sm text-slate-700"><AlertTriangle size={14} className={SEV[s.severity] === 'rose' ? 'text-rose-600' : 'text-amber-600'} /> <span><span className="font-medium">{s.type}</span> · {s.severity} — {s.message}</span></li>)}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Persisted exceptions ({persisted.length})</h3>
        {persisted.length === 0 ? <p className="mt-2 text-sm text-slate-400">None persisted yet. Signals above prepare data for the Phase 30 operations queue.</p> : (
          <ul className="mt-2 space-y-2">
            {persisted.map((e) => <li key={e.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm font-medium text-slate-800">{e.type}</p><p className="text-[11px] text-slate-400">{e.severity} · status {e.status}{e.owner_id ? ` · owner ${String(e.owner_id).slice(-6)}` : ''}</p></div>
                <div className="flex gap-1.5">
                  <button onClick={() => act(e.id, { status: 'RESOLVED', resolution: 'Resolved' })} disabled={!!busy} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50">Resolve</button>
                  <button onClick={() => act(e.id, { status: 'DISMISSED', resolution: 'Dismissed' })} disabled={!!busy} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Dismiss</button>
                  <button onClick={() => act(e.id, { owner_id: 'self' })} disabled={!!busy} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Claim</button>
                </div>
              </div>
              {e.message && <p className="mt-1 text-xs text-slate-500">{e.message}</p>}
            </li>)}
          </ul>
        )}
      </div>
    </div>
  );
}