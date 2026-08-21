import { Cpu } from 'lucide-react';

export default function ProvenanceChip({ provenance }) {
  if (!provenance) return null;
  const p = provenance;
  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600">
      <Cpu size={12} />
      <span className="font-medium">{p.ai_provider} · {p.ai_model}</span>
      <span>prompt {p.prompt_version}</span>
      {p.generation_status && <span className={`px-1.5 py-0.5 rounded ${p.generation_status === 'complete' ? 'bg-emerald-100 text-emerald-700' : p.generation_status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{p.generation_status}</span>}
      {p.generation_time_ms != null && <span>{Math.round(p.generation_time_ms / 100) / 10}s</span>}
      {p.token_usage?.llm_calls != null && <span className="hidden sm:inline">{p.token_usage.llm_calls} LLM calls</span>}
    </div>
  );
}