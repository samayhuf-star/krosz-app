// Worldz Visa (Phase 25) — slide-over diff review for a pending material source change.
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Chip } from '@/components/visa/matrix/matrixShared';

const CHANGE_TONE = {
  MATERIAL: 'bg-rose-50 text-rose-700 border-rose-200',
  NON_MATERIAL: 'bg-amber-50 text-amber-700 border-amber-200',
  NONE: 'bg-slate-50 text-slate-500 border-slate-200',
};

export default function ChangeReviewDrawer({ snapshot, capability, onAccept, onReject, onClose, busy }) {
  const open = !!snapshot;
  const s = snapshot || {};
  const cap = capability || {};
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{cap.country_code || '—'} · {s.claim_type || 'general'}</SheetTitle>
          <SheetDescription>Source change detected by the change-detection engine. Review the diff before accepting the new truth.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Change class" value={<Chip value={s.change_vs_previous} items={CHANGE_TONE} />} />
            <Field label="Change risk" value={cap.change_risk || 'UNKNOWN'} />
            <Field label="Source" value={s.source_name || s.source_type || '—'} />
            <Field label="Source URL" value={s.source_url || '—'} mono />
            <Field label="Captured" value={s.captured_at ? new Date(s.captured_at).toLocaleString() : '—'} />
            <Field label="Review status" value={s.review_status || '—'} />
            <Field label="Fingerprint" value={s.fingerprint || '—'} mono />
            <Field label="Previous fingerprint" value={s.previous_fingerprint || '—'} mono />
          </div>
          <Section title="Material fields">
            <div className="flex flex-wrap gap-1.5">
              {(s.material_fields || []).length ? s.material_fields.map((f) => <span key={f} className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">{f}</span>) : <span className="text-xs text-slate-400">None — cosmetic-only change.</span>}
            </div>
          </Section>
          <Section title="Diff (previous → current)">
            {!((s.diff || []).length) ? <p className="text-xs text-slate-400">No field-level diff.</p> : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1.5 font-medium">Field</th><th className="px-2 py-1.5 font-medium">Previous</th><th className="px-2 py-1.5 font-medium">Current</th><th className="px-2 py-1.5"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {s.diff.map((d) => (
                      <tr key={d.field}><td className="px-2 py-1.5 font-mono text-slate-700">{d.field}</td><td className="px-2 py-1.5 text-slate-500">{fmt(d.previous)}</td><td className="px-2 py-1.5 font-medium text-slate-800">{fmt(d.current)}</td><td className="px-2 py-1.5">{d.material ? <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">material</span> : <span className="text-[10px] text-slate-400">cosmetic</span>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {s.diff_summary && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{s.diff_summary}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">Close</button>
            <button onClick={() => onReject({ snapshot_id: s.id })} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700">Reject</button>
            <button onClick={() => onAccept(s.id)} disabled={busy} className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm text-white hover:bg-orange-700">Accept change</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function fmt(v) { if (v === null || v === undefined) return '(none)'; if (typeof v === 'string') return v.length > 50 ? v.slice(0, 50) + '…' : v; return JSON.stringify(v); }
function Field({ label, value, mono = false }) { return <div><p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p><div className={`mt-0.5 text-sm text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div></div>; }
function Section({ title, children }) { return <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>{children}</div>; }