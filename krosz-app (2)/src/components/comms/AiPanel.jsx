import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import ThreadView from '@/components/comms/ThreadView';

export default function AiPanel({ businessId, onRefresh }) {
  const [sel, setSel] = useState(null);
  const q = useQuery({ queryKey: ['comms', 'ai-inbox', businessId], queryFn: () => commsApi.listMessages(businessId, { folder: 'inbox' }), enabled: !!businessId });
  const msgs = (q.data?.messages || []).filter((m) => m.is_unread || m.needs_reply || m.ai_suggested_action);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles size={16} /> AI Email Assistant</CardTitle>
          <p className="text-xs text-slate-500 mt-1">Summarize · Draft reply · Rewrite · Translate · Categorize · Extract action items · Extract lead · Suggest next action. All AI flows through the Orchestration Engine against the Business Knowledge Graph — no direct AI provider calls.</p>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Needs attention</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 max-h-[70vh] overflow-auto">
            {msgs.length === 0 ? <p className="text-sm text-slate-500">No messages need attention.</p> : msgs.map((m) => (
              <button key={m.id} onClick={() => setSel(m)} className={`w-full rounded-xl border px-4 py-3 text-left ${sel?.id === m.id ? 'border-emerald-400 bg-emerald-50/50' : 'hover:bg-slate-50'}`}>
                <div className="flex items-center justify-between"><span className="font-medium text-slate-900 text-sm">{m.from_addr}</span>{m.needs_reply ? <Badge variant="outline" className="text-[9px] text-amber-700">Reply</Badge> : null}</div>
                <p className="text-xs text-slate-500 truncate">{m.subject}</p>
              </button>
            ))}
          </CardContent>
        </Card>
        <div>{sel ? <ThreadView messageId={sel.id} businessId={businessId} onRefresh={onRefresh} /> : <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-slate-400">Select a message to run AI actions</div>}</div>
      </div>
    </div>
  );
}