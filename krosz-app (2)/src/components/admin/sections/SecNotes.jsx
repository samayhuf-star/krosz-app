import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { adminInternalNoteCreate, adminInternalNoteList } from '@/lib/adminCaseApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pin } from 'lucide-react';

const CATS = ['GENERAL', 'DOCUMENT', 'ELIGIBILITY', 'PROVIDER', 'PAYMENT', 'ESCALATION', 'COMPLIANCE'];

export default function SecNotes({ d, reload, caseId }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [cat, setCat] = useState('GENERAL');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['admin-notes', caseId], queryFn: () => adminInternalNoteList(caseId) });
  const notes = q.data?.notes || [];
  const create = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await adminInternalNoteCreate({ application_id: caseId, body, category: cat, pinned }); toast({ title: 'Note added' }); setBody(''); setPinned(false); qc.invalidateQueries({ queryKey: ['admin-notes', caseId] }); qc.invalidateQueries({ queryKey: ['admin-case-detail', caseId] }); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">Internal notes are admin-only, timestamped, attributed. Travelers cannot see them.</p>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add an internal note…" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned</label>
          <button onClick={create} disabled={busy || !body.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : null} Add note</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Notes ({notes.length})</h3>
        <ul className="mt-2 space-y-2">
          {notes.length === 0 && <li className="text-sm text-slate-400">No notes yet.</li>}
          {notes.map((n) => <li key={n.id} className={`rounded-lg border p-3 ${n.pinned ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
            <div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-700">{n.author_name} · {n.category}{n.pinned && <Pin size={11} className="ml-1 inline text-amber-600" />}</p><p className="text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString()}</p></div>
            <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{n.body}</p>
          </li>)}
        </ul>
      </div>
    </div>
  );
}