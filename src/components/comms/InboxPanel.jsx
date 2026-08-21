import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Inbox, Star, Reply, Sparkles, Mail, Send } from 'lucide-react';
import ThreadView from '@/components/comms/ThreadView';
import ComposeModal from '@/components/comms/ComposeModal';

const FOLDERS = [
  { id: 'inbox', label: 'All Mail', icon: Inbox },
  { id: 'unread', label: 'Unread', icon: Mail },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'needs_reply', label: 'Needs Reply', icon: Reply },
  { id: 'ai_suggested', label: 'AI Suggested', icon: Sparkles },
  { id: 'sent', label: 'Sent', icon: Send },
];

export default function InboxPanel({ data, businessId, onRefresh }) {
  const mailboxes = data?.mailboxes || [];
  const [folder, setFolder] = useState('inbox');
  const [mailboxId, setMailboxId] = useState('all');
  const [query, setQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [selected, setSelected] = useState(null);

  const list = useQuery({
    queryKey: ['comms', 'messages', businessId, folder, mailboxId],
    queryFn: () => commsApi.listMessages(businessId, { folder: folder === 'inbox' ? 'all' : 'inbox', mailbox_id: mailboxId === 'all' ? undefined : mailboxId, limit: 100 }),
    enabled: !!businessId,
  });

  const search = useMutation({ mutationFn: (q) => commsApi.search(businessId, q) });
  const messages = query && search.data ? (search.data?.results?.messages || []) : (list.data?.messages || []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <aside className="space-y-3">
        <div className="rounded-2xl border bg-white p-2">
          <nav className="space-y-0.5">
            {FOLDERS.map((f) => {
              const Icon = f.icon; const active = folder === f.id;
              return <button key={f.id} onClick={() => { setFolder(f.id); setQuery(''); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? 'bg-emerald-50 font-medium text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={15} /> {f.label}</button>;
            })}
          </nav>
        </div>
        <div className="rounded-2xl border bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Mailbox</p>
          <select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-sm">
            <option value="all">All mailboxes</option>
            {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
          </select>
        </div>
      </aside>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                <Input className="pl-9" placeholder="Search across emails, threads, contacts, leads…" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.length >= 2) search.mutate(e.target.value); else search.reset(); }} />
              </div>
              <Button variant="outline" onClick={() => setShowCompose(true)}><Send size={14} className="mr-2" /> Compose</Button>
            </div>
            {query && search.data && (
              <p className="mt-2 text-xs text-slate-500">{(search.data.results?.messages || []).length} messages · {(search.data.results?.threads || []).length} threads · {(search.data.results?.leads || []).length} leads · {(search.data.results?.contacts || []).length} contacts</p>
            )}
          </CardContent>
        </Card>

        {list.isLoading ? <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading…</div> : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr]">
            <div className="space-y-1.5 max-h-[70vh] overflow-auto">
              {messages.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No messages. Sync a mailbox to receive email.</p> : messages.map((m) => (
                <button key={m.id} onClick={() => setSelected(m)} className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selected?.id === m.id ? 'border-emerald-400 bg-emerald-50/50' : 'bg-white hover:bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${m.is_unread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{m.from_addr}</span>
                    <span className="text-xs text-slate-400">{m.received_at ? new Date(m.received_at).toLocaleDateString() : ''}</span>
                  </div>
                  <p className={`text-sm ${m.is_unread ? 'font-medium' : ''} truncate`}>{m.subject}</p>
                  <p className="text-xs text-slate-400 truncate">{m.body_text?.slice(0, 80)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.is_unread ? <Badge className="text-[9px]">Unread</Badge> : null}
                    {m.needs_reply ? <Badge variant="outline" className="text-[9px] text-amber-700">Needs reply</Badge> : null}
                    {m.ai_category && m.ai_category !== 'unknown' ? <Badge variant="outline" className="text-[9px] capitalize">{m.ai_category}</Badge> : null}
                    {m.ai_suggested_action ? <Badge variant="outline" className="text-[9px] text-violet-700">AI</Badge> : null}
                    {m.crm_lead_id ? <Badge variant="outline" className="text-[9px] text-emerald-700">Lead</Badge> : null}
                    {m.ticket_id ? <Badge variant="outline" className="text-[9px] text-sky-700">Ticket</Badge> : null}
                  </div>
                </button>
              ))}
            </div>
            <div>{selected ? <ThreadView messageId={selected.id} businessId={businessId} onRefresh={onRefresh} /> : <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-slate-400">Select a message to view its thread</div>}</div>
          </div>
        )}
      </div>

      {showCompose && <ComposeModal businessId={businessId} mailboxes={mailboxes} onClose={() => setShowCompose(false)} onSent={() => { setShowCompose(false); onRefresh(); }} />}
    </div>
  );
}