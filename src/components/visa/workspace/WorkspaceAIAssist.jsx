import { useState } from 'react';
import { Sparkles, Loader2, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Phase 16 §24: AI assistance is a controlled, read-only interface.
// AI may explain questions, detect missing info, and summarize — it NEVER
// fabricates applicant data, mutates answers, overrides eligibility, validates
// documents, or claims approval. All output is a suggestion the traveler reviews.
export default function WorkspaceAIAssist({ readiness, application }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState('');
  const [err, setErr] = useState('');

  const run = async (mode) => {
    setLoading(true); setErr(''); setOut('');
    const reasons = (readiness?.reasons || []).map((r) => `- ${r.message || r.code}`).join('\n');
    const needsReview = (readiness?.needs_review || []).map((r) => `- ${r.title}: ${r.description || ''}`).join('\n');
    const prompt = mode === 'missing'
      ? `You are a visa application assistant. A traveler is applying for a ${application?.destination} ${application?.purpose} visa. Based on these outstanding items, write a short, plain-language checklist of what they still need to do (no legal advice, no guarantees). Outstanding: ${reasons || 'none'}. Needs review: ${needsReview || 'none'}.`
      : `You are a visa application assistant. Summarize the current state of this ${application?.destination} ${application?.purpose} visa application in 3 short sentences for the traveler. Status: ${application?.status}. Outstanding required items: ${reasons || 'none'}.`;
    try {
      const res = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: { type: 'object', properties: { message: { type: 'string' } } } });
      const message = typeof res === 'string'
        ? res
        : (res && typeof res === 'object' && 'message' in res && typeof res.message === 'string'
          ? res.message
          : 'No suggestion returned.');
      setOut(message);
    } catch (e) { setErr(e?.message || 'AI unavailable'); }
    finally { setLoading(false); }
  };

  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-violet-600" />
        <p className="text-sm font-semibold text-violet-900">AI assistant</p>
      </div>
      <p className="mt-1 text-[11px] text-violet-700/80">Explains and summarizes only. AI never fills answers or validates documents — you stay in control.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => { setOpen(true); run('summary'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50">
          <Sparkles size={13} /> Summarize my application
        </button>
        <button onClick={() => { setOpen(true); run('missing'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50">
          What's still needed?
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-violet-900">AI suggestion</p>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          {loading ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Thinking…</div>
          ) : err ? (
            <p className="mt-2 text-xs text-rose-600">{err}</p>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{out}</p>
          )}
          <p className="mt-2 text-[10px] text-slate-400">Review before acting. This is guidance, not a decision.</p>
        </div>
      )}
    </div>
  );
}