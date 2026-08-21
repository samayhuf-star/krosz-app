import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';

export default function AiSummaryCard({ businessId, business, counts }) {
  const q = useQuery({
    queryKey: ['home', 'ai-summary', businessId],
    queryFn: async () => {
      const prompt = `You are the friendly business assistant inside a Business Operating System. Write a short, upbeat note (max 2 sentences, plain text, no emojis, no markdown) telling the business owner what to do next.
Business: ${business?.name || 'this business'} (${business?.industry || '—'}${business?.city ? ', ' + business?.city : ''}).
Current state: ${counts?.leads || 0} leads, ${counts?.unreadMsgs || 0} unread emails, ${counts?.needsReply || 0} emails needing a reply, ${counts?.openTickets || 0} open support tickets, ${counts?.publishedPages || 0} published pages, website ${counts?.websitePublished ? 'published' : counts?.websiteDrafted ? 'drafted' : 'not built'}, domain ${counts?.domainActive ? 'active' : 'pending'}.
Identify the single most valuable next action and motivate it in one line.`;
      const res = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } });
      return res?.note || res;
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Sparkles size={16} /></span>
        <h3 className="text-sm font-semibold text-slate-900">AI summary</h3>
        {q.isFetching && <Loader2 size={13} className="animate-spin text-slate-400" />}
        {q.data && <button onClick={() => q.refetch()} className="ml-auto text-slate-400 hover:text-slate-600"><RefreshCw size={13} /></button>}
      </div>
      {q.isLoading ? <p className="text-sm text-slate-400">Reading your business state…</p>
        : q.isError ? <p className="text-sm text-slate-500">Focus on your most valuable next action — see the recommendations below.</p>
        : <p className="text-sm leading-6 text-slate-700">{q.data}</p>}
    </div>
  );
}