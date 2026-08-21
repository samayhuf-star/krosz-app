import { useState } from 'react';
import { Check, Pencil, Sparkles, ChevronDown } from 'lucide-react';

// Identity fields the owner confirms/edits. Suggestions stay read-only chips.
const FIELDS = [
  ['business_name', 'Business Name', 'text'],
  ['industry', 'Industry', 'text'],
  ['business_category', 'Category', 'text'],
  ['city', 'City', 'text'], ['state', 'State', 'text'], ['country', 'Country', 'text'],
  ['service_area', 'Service Area', 'text'],
  ['audience', 'Audience', 'text'], ['target_customers', 'Target Customers', 'text'],
  ['products', 'Products', 'list'], ['services', 'Services', 'list'],
  ['business_model', 'Business Model', 'text'], ['business_goal', 'Business Goal', 'text'],
  ['suggested_brand_tone', 'Brand Tone', 'text'],
];
const CHECKLIST = ['business_name', 'industry', 'city', 'audience', 'services', 'business_goal'];
const SUGGESTIONS = [
  ['suggested_keywords', 'Keywords'], ['suggested_website_structure', 'Website structure'],
  ['suggested_crm', 'CRM'], ['suggested_emails', 'Suggested emails'], ['suggested_ai_agents', 'AI agents'], ['suggested_marketing_direction', 'Marketing direction'],
];

const val = (p, k) => (Array.isArray(p?.[k]) ? p[k].join(', ') : (p?.[k] || ''));

export default function UnderstandingCard({ profile, onConfirm, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const save = () => { setEditing(false); onSave(draft); };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Check size={16} /></span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Here is what I understood.</p>
          <p className="text-xs text-slate-500">Review the details. Tap Edit to change anything, or Confirm to continue.</p>
        </div>
      </div>

      {!editing ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {FIELDS.map(([k, label]) => (
            <div key={k} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p><p className="truncate text-sm font-medium text-slate-800">{val(profile, k) || '—'}</p></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {FIELDS.map(([k, label, type]) => (
            <div key={k}>
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</label>
              {type === 'list' ? (
                <textarea rows={2} value={(draft[k] || []).join('\n')} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400" />
              ) : (
                <input value={draft[k] || ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400" />
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowSuggestions((s) => !s)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900">
        <Sparkles size={13} /> AI suggestions <ChevronDown size={13} className={showSuggestions ? 'rotate-180' : ''} />
      </button>
      {showSuggestions && (
        <div className="mt-2 grid gap-2 rounded-xl bg-violet-50/50 p-3 sm:grid-cols-2">
          {SUGGESTIONS.map(([k, label]) => (
            <div key={k}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-violet-500">{label}</p>
              <p className="text-sm text-slate-700">{val(profile, k) || '—'}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        {editing ? (
          <>
            <button onClick={save} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
            <button onClick={() => { setDraft(profile); setEditing(false); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Pencil size={14} /> Edit</button>
            <button onClick={onConfirm} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Check size={15} /> Confirm</button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Only confirmed values become authoritative in your Business Knowledge Graph.</p>
    </div>
  );
}