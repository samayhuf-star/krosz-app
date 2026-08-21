import { useEffect, useState } from 'react';
import { Check, Edit3, FileText, ShieldCheck, AlertTriangle } from 'lucide-react';

const SOURCE_META = {
  PASSPORT: { label: 'From passport', tone: 'text-orange-700 bg-orange-50 border-orange-100', icon: ShieldCheck },
  TRAVELER: { label: 'From your profile', tone: 'text-sky-700 bg-sky-50 border-sky-100', icon: ShieldCheck },
  PREVIOUS_APPLICATION: { label: 'From a previous application', tone: 'text-indigo-700 bg-indigo-50 border-indigo-100', icon: Check },
  DOCUMENT: { label: 'From an attached document', tone: 'text-violet-700 bg-violet-50 border-violet-100', icon: FileText },
  USER: { label: 'Your answer', tone: 'text-slate-600 bg-slate-50 border-slate-200', icon: Edit3 },
};

function SourceBadge({ answer }) {
  if (!answer) return null;
  const meta = SOURCE_META[answer.source_type] || SOURCE_META.USER;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}>
      <Icon size={11} /> {meta.label}
      {answer.confidence != null && answer.source_type !== 'USER' && <span className="opacity-70">· {Math.round(answer.confidence * 100)}%</span>}
    </span>
  );
}

function parsedDocRef(value) {
  try { const o = JSON.parse(value || ''); return { document_id: o?.document_id, document_version_id: o?.document_version_id, display_name: o?.display_name }; } catch { return null; }
}

export default function QuestionField({ question, answer, saving, error = "", onSave, onConfirm, docOptions }) {
  const [val, setVal] = useState(answer?.value || '');
  const [dirty, setDirty] = useState(false);
  const code = question.code;

  useEffect(() => { if (!dirty) setVal(answer?.value || ''); }, [answer?.value, dirty]);

  const commit = (v) => { setVal(v); setDirty(true); onSave(code, v); };
  const confirm = () => { if (onConfirm) onConfirm(code); };

  const control = () => {
    switch (question.type) {
      case 'TEXTAREA':
        return <textarea value={val} onChange={(e) => setVal(e.target.value)} onBlur={(e) => commit(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />;
      case 'SELECT':
        return (
          <select value={val} onChange={(e) => commit(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500">
            <option value="">Select…</option>
            {question.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case 'BOOLEAN':
        return (
          <div className="flex gap-2">
            <button type="button" onClick={() => commit('true')} className={`rounded-lg border px-4 py-1.5 text-sm ${val === 'true' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Yes</button>
            <button type="button" onClick={() => commit('false')} className={`rounded-lg border px-4 py-1.5 text-sm ${val === 'false' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>No</button>
          </div>
        );
      case 'DOCUMENT_REFERENCE': {
        const ref = parsedDocRef(val);
        if (ref) {
          return (
            <div className="flex items-center justify-between rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
              <span className="text-sm font-medium text-violet-900">{ref.display_name || 'Document selected'}</span>
              <button type="button" onClick={() => commit('')} className="text-[11px] text-violet-700 hover:underline">Change</button>
            </div>
          );
        }
        const opts = docOptions || [];
        return (
          <select value={val} onChange={(e) => commit(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500">
            <option value="">Select a document…</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      }
      default:
        return <input type={question.type === 'DATE' ? 'date' : question.type === 'NUMBER' ? 'number' : question.type === 'EMAIL' ? 'email' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} onBlur={(e) => commit(e.target.value)} placeholder={question.label} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />;
    }
  };

  const isDocDerived = answer && answer.source_type && answer.source_type !== 'USER';
  const needsConfirm = isDocDerived && !answer?.verified;
  const wasOverridden = answer?.metadata?.extracted_value && answer?.source_type === 'USER' && answer.metadata.previous_value !== answer.value;

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-slate-800">{question.label}{question.required ? <span className="text-rose-500"> *</span> : null}</label>
        {answer ? <SourceBadge answer={answer} /> : null}
      </div>
      {question.description ? <p className="mt-0.5 text-[11px] text-slate-400">{question.description}</p> : null}
      <div className="mt-1.5">{control()}</div>
      {needsConfirm && val ? (
        <button type="button" onClick={confirm} disabled={saving} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-orange-700 hover:underline">
          <Check size={12} /> Looks correct — confirm this value
        </button>
      ) : null}
      {wasOverridden ? (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
          <AlertTriangle size={11} /> Overridden — extracted value was “{answer.metadata.extracted_value}”. A conflict was logged for review.
        </p>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}