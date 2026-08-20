import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

export default function ThreadPanel({ businessId, onRefresh }) {
  const [sel, setSel] = useState(null);
  const q = useQuery({ queryKey: ['comms', 'threads', businessId], queryFn: () => commsApi.listThreads(businessId), enabled: !!businessId });
  const threads = q.data?.threads || [];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.6fr]">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Threads</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 max-h-[72vh] overflow-auto">
          {threads.length === 0 ? <p className="text-sm text-slate-500">No threads yet.</p> : threads.map((t) => (
            <button key={t.id} onClick={() => setSel(t)} className={`w-full rounded-xl border px-4 py-3 text-left ${sel?.id === t.id ? 'border-emerald-400 bg-emerald-50/50' : 'hover:bg-slate-50'}`}>
              <div className="flex items-center justify-between"><span className="font-medium text-slate-900 truncate">{t.subject}</span><Badge variant="outline" className="capitalize text-[9px]">{t.status}</Badge></div>
              <p className="text-xs text-slate-400">{t.message_count} messages · {t.participants?.length || 0} participants</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {t.crm_link ? <Badge variant="outline" className="text-[9px] text-emerald-700">CRM</Badge> : null}
                {t.ticket_link ? <Badge variant="outline" className="text-[9px] text-sky-700">Ticket</Badge> : null}
                {t.assigned_user_id ? <Badge variant="outline" className="text-[9px]">Assigned</Badge> : null}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
      <div>{sel ? <ThreadDetail threadId={sel.id} businessId={businessId} onRefresh={onRefresh} /> : <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-slate-400">Select a thread</div>}</div>
    </div>
  );
}

function ThreadDetail({ threadId, businessId, onRefresh }) {
  const q = useQuery({ queryKey: ['comms', 'thread', threadId], queryFn: () => commsApi.getThread(threadId) });
  const [reply, setReply] = useState('');
  const thread = q.data?.thread; const msgs = q.data?.messages || [];
  const last = msgs[msgs.length - 1];
  const send = useMutation({ mutationFn: () => commsApi.sendMessage(businessId, { mailbox_id: thread.mailbox_id, to_addr: [last?.from_addr].filter(Boolean), subject: 'Re: ' + thread.subject, body: reply }), onSuccess: () => { setReply(''); q.refetch(); onRefresh(); } });
  if (q.isLoading) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={16} /></div>;
  return (
    <div className="rounded-2xl border bg-white">
      <div className="border-b px-5 py-4"><h3 className="font-semibold">{thread?.subject}</h3><p className="text-xs text-slate-500">{thread?.status} · CRM {thread?.crm_link ? 'linked' : '—'} · Ticket {thread?.ticket_link ? 'linked' : '—'}</p></div>
      <div className="space-y-2 px-5 py-4 max-h-72 overflow-auto text-sm">
        {msgs.map((m) => <div key={m.id} className={`rounded-lg p-3 ${m.folder === 'sent' ? 'bg-emerald-50/50' : 'bg-slate-50'}`}><p className="text-xs text-slate-400">{m.from_addr} · {new Date(m.received_at || m.sent_at || m.created_date).toLocaleString()}</p><p className="whitespace-pre-wrap">{m.body_text}</p></div>)}
      </div>
      <div className="border-t px-5 py-3"><Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" /><div className="mt-2 flex justify-end"><Button size="sm" disabled={!reply || send.isLoading} onClick={() => send.mutate()}>{send.isLoading ? <Loader2 size={13} className="animate-spin mr-2" /> : null}Reply</Button></div></div>
    </div>
  );
}