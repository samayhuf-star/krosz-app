import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Tag, FileText, UserPlus, LifeBuoy, Send, Shuffle } from 'lucide-react';

export default function ThreadView({ messageId, businessId, onRefresh }) {
  const [reply, setReply] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [action, setAction] = useState('');

  const msgQ = useQuery({ queryKey: ['comms', 'msg', messageId], queryFn: async () => {
    const m = await commsApi.listMessages(businessId, { folder: 'all', limit: 500 });
    return (m.messages || []).find((x) => x.id === messageId);
  }, enabled: !!messageId });

  const threadQ = useQuery({ queryKey: ['comms', 'thread', msgQ.data?.thread_id], queryFn: () => commsApi.getThread(msgQ.data?.thread_id), enabled: !!msgQ.data?.thread_id });

  const ai = useMutation({ mutationFn: ({ ai_action }) => { setAction(ai_action); return commsApi.aiAction(messageId, ai_action); }, onSuccess: (r) => { setAiResult(r); onRefresh(); }, onSettled: () => setAction('') });
  const ticket = useMutation({ mutationFn: () => commsApi.createTicketFromEmail(messageId), onSuccess: () => onRefresh() });
  const sendReply = useMutation({
    mutationFn: () => commsApi.sendMessage(businessId, { mailbox_id: msgQ.data.mailbox_id, to_addr: [msgQ.data.from_addr], subject: 'Re: ' + msgQ.data.subject, body: reply }),
    onSuccess: () => { setReply(''); onRefresh(); },
  });

  useEffect(() => { setReply(''); setAiResult(null); }, [messageId]);

  if (msgQ.isLoading) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading message…</div>;
  const m = msgQ.data; if (!m) return <div className="text-sm text-slate-500">Message not found.</div>;
  const thread = threadQ.data; const msgs = thread?.messages || [m];

  const runDraft = async () => {
    const r = await commsApi.aiAction(messageId, 'draft_reply'); setAiResult(r);
    if (r.result?.body) { setReply(r.result.body); }
    onRefresh();
  };

  return (
    <div className="rounded-2xl border bg-white">
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{m.subject}</h3>
          <div className="flex flex-wrap gap-1">
            {m.ai_category && m.ai_category !== 'unknown' ? <Badge variant="outline" className="capitalize">{m.ai_category}</Badge> : null}
            {m.ai_urgency && m.ai_urgency !== 'normal' ? <Badge variant="outline" className={m.ai_urgency === 'urgent' ? 'text-red-600' : ''}>{m.ai_urgency}</Badge> : null}
            {m.crm_lead_id ? <Badge variant="outline" className="text-emerald-700">CRM Lead</Badge> : null}
            {m.ticket_id ? <Badge variant="outline" className="text-sky-700">Ticket</Badge> : null}
            {m.assigned_user_id ? <Badge variant="outline">Assigned</Badge> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">From <span className="font-medium text-slate-700">{m.from_addr}</span> · {m.received_at ? new Date(m.received_at).toLocaleString() : ''}</p>
        {m.ai_summary && <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900"><b>AI summary:</b> {m.ai_summary}</div>}
        {m.ai_action_items?.length ? <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Action items:</b><ul className="list-disc pl-5">{m.ai_action_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div> : null}
        {m.ai_suggested_action && <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><b>Suggested next:</b> {m.ai_suggested_action}</div>}
      </div>

      <div className="px-5 py-4 space-y-3 max-h-64 overflow-auto text-sm text-slate-700 whitespace-pre-wrap">
        {msgs.map((mm) => (
          <div key={mm.id} className={`rounded-lg p-3 ${mm.folder === 'sent' ? 'bg-emerald-50/50' : 'bg-slate-50'}`}>
            <p className="text-xs text-slate-400 mb-1">{mm.from_addr} · {mm.sent_at ? new Date(mm.sent_at).toLocaleString() : mm.received_at ? new Date(mm.received_at).toLocaleString() : ''}</p>
            <p>{mm.body_text}</p>
          </div>
        ))}
      </div>

      <div className="border-t px-5 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={action === 'summarize'} onClick={() => ai.mutate({ ai_action: 'summarize' })}><Sparkles size={13} className="mr-1" /> {action === 'summarize' ? <Loader2 size={13} className="animate-spin" /> : 'Summarize'}</Button>
          <Button size="sm" variant="outline" disabled={action === 'categorize'} onClick={() => ai.mutate({ ai_action: 'categorize' })}><Tag size={13} className="mr-1" /> {action === 'categorize' ? <Loader2 size={13} className="animate-spin" /> : 'Categorize'}</Button>
          <Button size="sm" variant="outline" disabled={action === 'extract_action_items'} onClick={() => ai.mutate({ ai_action: 'extract_action_items' })}><FileText size={13} className="mr-1" /> {action === 'extract_action_items' ? <Loader2 size={13} className="animate-spin" /> : 'Actions'}</Button>
          <Button size="sm" variant="outline" disabled={action === 'extract_lead'} onClick={() => ai.mutate({ ai_action: 'extract_lead' })}><UserPlus size={13} className="mr-1" /> {action === 'extract_lead' ? <Loader2 size={13} className="animate-spin" /> : 'Lead?'}</Button>
          <Button size="sm" variant="outline" disabled={action === 'suggest_next_action'} onClick={() => ai.mutate({ ai_action: 'suggest_next_action' })}><Shuffle size={13} className="mr-1" /> {action === 'suggest_next_action' ? <Loader2 size={13} className="animate-spin" /> : 'Next'}</Button>
          <Button size="sm" variant="outline" disabled={ticket.isLoading} onClick={() => ticket.mutate()}><LifeBuoy size={13} className="mr-1" /> {ticket.isLoading ? <Loader2 size={13} className="animate-spin" /> : 'Ticket'}</Button>
          <Button size="sm" variant="ghost" disabled={ai.isLoading} onClick={runDraft}><Sparkles size={13} className="mr-1" /> Draft reply</Button>
        </div>
        {aiResult?.crm && <p className="mb-2 text-xs text-emerald-700">CRM: {aiResult.crm.lead_id ? 'Lead + Contact created' : aiResult.crm.lead_creation_failed || 'No lead created.'}</p>}
        <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" disabled={!reply || sendReply.isLoading} onClick={() => sendReply.mutate()}>{sendReply.isLoading ? <Loader2 size={13} className="animate-spin mr-1" /> : <Send size={13} className="mr-1" />} Send reply</Button>
        </div>
      </div>
    </div>
  );
}