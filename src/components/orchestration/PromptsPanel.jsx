import { useQuery } from '@tanstack/react-query';
import { orchestratorApi } from '@/lib/orchestratorApi';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollText } from 'lucide-react';

const STATUS_TONE = {
  draft: 'border-slate-200 bg-slate-50 text-slate-600',
  review: 'border-sky-200 bg-sky-50 text-sky-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  published: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function PromptsPanel({ tenantId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['orchestration-prompts', tenantId],
    queryFn: () => orchestratorApi.listPrompts(tenantId),
  });
  const prompts = data?.prompts || [];
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><ScrollText size={15} /> Prompt Registry</div>
      {isLoading ? (
        <p className="px-4 py-8 text-center text-xs text-slate-400">Loading…</p>
      ) : !prompts.length ? (
        <p className="px-4 py-8 text-center text-xs text-slate-400">No prompts registered yet. The default test prompt is seeded on first orchestration.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {prompts.map((p) => (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-semibold text-slate-800">{p.prompt_id}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">module: {p.module} · capability: {p.capability}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">v{p.version}</Badge>
                  <Badge className={STATUS_TONE[p.status] || ''}>{p.status}</Badge>
                </div>
              </div>
              {p.default_model && <p className="mt-1.5 text-[11px] text-slate-400">model: {p.default_model}{(p.fallback_models || []).length ? ` · fallback: ${p.fallback_models.join(', ')}` : ''}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}