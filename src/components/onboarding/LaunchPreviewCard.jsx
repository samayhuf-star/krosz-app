import { Rocket, Check, Loader2, AlertCircle } from 'lucide-react';

const ITEMS = [
  'Business Blueprint', 'Domain Suggestions', 'Website', 'SEO', 'Business Emails', 'CRM', 'Communication Hub', 'Knowledge Graph', 'AI Assistant',
];

export default function LaunchPreviewCard({ onLaunch, launching, error }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Rocket size={16} /></span>
        <div>
          <p className="text-sm font-semibold text-slate-900">We are ready.</p>
          <p className="text-xs text-slate-500">AI will prepare each of these. You approve before anything goes live.</p>
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {ITEMS.map((it) => (
          <li key={it} className="flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-sm text-slate-700">
            <Check size={13} className="text-emerald-600" /> {it}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm">
        <span className="text-slate-500">Estimated time <span className="font-semibold text-slate-800">~10–15 min</span></span>
        <span className="text-slate-500">Estimated cost <span className="font-semibold text-slate-800">Standard AI credits</span></span>
      </div>

      {error && <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"><AlertCircle size={14} /> {error}</p>}

      <button onClick={onLaunch} disabled={launching} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60">
        {launching ? <><Loader2 size={16} className="animate-spin" /> Launching your business…</> : <>🚀 Launch Business</>}
      </button>
      <p className="mt-2 text-[11px] text-slate-400">Nothing is purchased, published, or sent without your explicit one-click approval.</p>
    </div>
  );
}