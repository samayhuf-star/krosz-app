import { useState } from 'react';
import { Plus, Trash2, Save, X, Pencil, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export default function PipelinePanel({ pipeline, stages, isDraft, onSave, busy }) {
  const [draft, setDraft] = useState(null);
  const editing = draft !== null;
  const list = editing ? draft : (stages || []);

  const startEdit = () => setDraft((stages || []).map((s) => ({ ...s })));
  const cancel = () => setDraft(null);
  const commit = async () => {
    const cleaned = list.map((s, i) => ({
      ...s,
      key: (s.key || '').trim() || slugify(s.name || `stage_${i + 1}`),
      name: (s.name || `Stage ${i + 1}`).trim(),
      order: i + 1,
      probability: Number(s.probability) || 0,
      sla_hours: Number(s.sla_hours) || 0,
    }));
    await onSave(cleaned);
    setDraft(null);
  };
  const update = (i, patch) => setDraft(list.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const add = () => setDraft([...list, { key: '', name: '', description: '', probability: 0, entry_criteria: '', exit_criteria: '', owner_role: '', automation_hint: '', sla_hours: 24 }]);
  const remove = (i) => setDraft(list.filter((_, idx) => idx !== i));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return; setDraft(list.map((s, idx) => { if (idx === i) return list[j]; if (idx === j) return list[i]; return s; })); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div><p className="font-semibold text-slate-900">{pipeline?.name || 'Sales Pipeline'}</p><p className="text-sm text-slate-500">{list.length} stages · {pipeline?.description}</p></div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button onClick={cancel} variant="outline" size="sm"><X size={15} /> Cancel</Button>
              <Button onClick={commit} disabled={busy} size="sm" className="bg-emerald-700 hover:bg-emerald-800"><Save size={15} /> Save Pipeline</Button>
            </>
          ) : isDraft && (
            <Button onClick={startEdit} size="sm"><Pencil size={15} /> Edit Pipeline</Button>
          )}
        </div>
      </div>

      {!list.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center"><Layers size={28} className="mx-auto text-slate-400" /><p className="mt-2 text-sm text-slate-500">No stages defined.</p></div>
      ) : (
        <ol className="space-y-3">
          {list.map((s, i) => (
            <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{i + 1}</span>
                  {editing && <div className="flex flex-col"><button onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-700" aria-label="move up">▲</button><button onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-700" aria-label="move down">▼</button></div>}
                </div>
                <div className="flex-1">
                  {editing ? (
                    <div className="grid gap-2.5">
                      <Input value={s.name} placeholder="Stage name (e.g. Trial Booking)" onChange={(e) => update(i, { name: e.target.value })} className="font-medium" />
                      <Textarea value={s.description} placeholder="What happens at this stage" rows={2} onChange={(e) => update(i, { description: e.target.value })} />
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        <Field label="Win probability %"><Input type="number" value={s.probability} onChange={(e) => update(i, { probability: e.target.value })} /></Field>
                        <Field label="SLA (hours)"><Input type="number" value={s.sla_hours} onChange={(e) => update(i, { sla_hours: e.target.value })} /></Field>
                        <Field label="Owner role"><Input value={s.owner_role} onChange={(e) => update(i, { owner_role: e.target.value })} /></Field>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Field label="Entry criteria"><Input value={s.entry_criteria} onChange={(e) => update(i, { entry_criteria: e.target.value })} /></Field>
                        <Field label="Exit criteria"><Input value={s.exit_criteria} onChange={(e) => update(i, { exit_criteria: e.target.value })} /></Field>
                      </div>
                      <Field label="Automation hint"><Input value={s.automation_hint} onChange={(e) => update(i, { automation_hint: e.target.value })} /></Field>
                    </div>
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-slate-900">{s.name}</h4>{s.owner_role && <Badge variant="outline" className="border-slate-300 text-slate-600">{s.owner_role}</Badge>}{s.sla_hours ? <Badge variant="outline" className="border-slate-300 text-slate-500">SLA {s.sla_hours}h</Badge> : null}</div>
                      <p className="mt-1 text-sm text-slate-600">{s.description || '—'}</p>
                      <div className="mt-2"><div className="h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, s.probability || 0))}%` }} /></div><p className="mt-0.5 text-right text-xs text-slate-400">{s.probability ?? 0}% win probability</p></div>
                      {(s.entry_criteria || s.exit_criteria) && <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2"><span><b className="text-slate-600">Entry:</b> {s.entry_criteria || '—'}</span><span><b className="text-slate-600">Exit:</b> {s.exit_criteria || '—'}</span></div>}
                      {s.automation_hint && <p className="mt-2 text-xs text-emerald-700">↳ {s.automation_hint}</p>}
                    </div>
                  )}
                </div>
                {editing && <button onClick={() => remove(i)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" aria-label="delete stage"><Trash2 size={16} /></button>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {editing && <Button onClick={add} variant="outline" className="w-full border-dashed"><Plus size={16} /> Add Stage</Button>}
    </div>
  );
}

function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>{children}</label>; }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'stage'; }