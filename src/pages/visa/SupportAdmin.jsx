import { useEffect, useState } from 'react';
import PageHeader from '@/components/app/PageHeader';
import { adminListSupportTickets, listConversationMessages, sendSupportMessage, listInternalNotes, addInternalNote, assignTicket, resolveTicket } from '@/lib/visaApi';

const QUEUE_FILTERS = [
  ['OPEN', 'Open'],
  ['URGENT', 'Urgent'],
  ['WAITING_CUSTOMER', 'Waiting on customer'],
  ['WAITING_PROVIDER', 'Waiting on provider'],
  ['RESOLVED', 'Resolved'],
  ['ALL', 'All'],
];

export default function SupportAdmin() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('OPEN');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState('messages');

  const load = () => {
    setLoading(true);
    const opts = filter === 'URGENT' ? { priority: 'URGENT' } : filter === 'ALL' ? {} : { status: filter };
    adminListSupportTickets(opts).then((r) => setTickets(r.tickets || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filter]);

  const open = async (t) => {
    setActive({ ticket: t });
    setTab('messages');
    try {
      const [m, n] = await Promise.all([listConversationMessages(t.conversation_id), listInternalNotes(t.application_id)]);
      setActive({ ticket: t, messages: m.messages || [], notes: n.notes || [] });
    } catch { setActive({ ticket: t, messages: [], notes: [] }); }
  };

  const send = async () => {
    if (!active || !body.trim()) return;
    await sendSupportMessage(active.ticket.conversation_id, body);
    setBody("");
    const m = await listConversationMessages(active.ticket.conversation_id);
    setActive({ ...active, messages: m.messages || [] });
    load();
  };
  const addNote = async () => {
    if (!active || !note.trim()) return;
    await addInternalNote({ id: active.ticket.application_id, body: note, ticket_id: active.ticket.id });
    setNote("");
    const n = await listInternalNotes(active.ticket.application_id);
    setActive({ ...active, notes: n.notes || [] });
  };

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Support Console" subtitle="Operator queue for visa support tickets." />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
      <div className="mb-4 flex flex-wrap gap-2">
        {QUEUE_FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === k ? 'bg-orange-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{label}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-2">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : tickets.length === 0 ? <p className="text-sm text-slate-400">No tickets in this view.</p> :
            tickets.map((t) => (
              <button key={t.id} onClick={() => open(t)} className={`block w-full rounded-xl border p-3 text-left ${active && active.ticket.id === t.id ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{t.ticket_number}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${t.priority === 'URGENT' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{t.priority}</span>
                </div>
                <p className="text-xs text-slate-500">{t.category} · {t.status.replace(/_/g, ' ').toLowerCase()}</p>
                <p className="mt-1 text-xs text-slate-400 truncate">{t.subject}</p>
              </button>
            ))}
        </div>

        <div className="lg:col-span-2 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          {!active ? <p className="text-sm text-slate-400">Select a ticket to work it.</p> : (
            <>
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-900">{active.ticket.ticket_number} · <span className="capitalize">{active.ticket.category.toLowerCase()}</span></p><p className="text-xs text-slate-500">Application {active.ticket.application_id?.slice(-6).toUpperCase()}</p></div>
                <div className="flex gap-2">
                  <button onClick={() => assignTicket(active.ticket.id, "").then(load)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">Assign to me</button>
                  <button onClick={() => resolveTicket(active.ticket.id).then(() => { load(); open({ ...active.ticket, status: 'RESOLVED' }); })} className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white">Resolve</button>
                </div>
              </div>

              <div className="mt-3 flex gap-4 border-b border-slate-100 text-xs font-semibold">
                <button onClick={() => setTab('messages')} className={`pb-2 ${tab === 'messages' ? 'text-orange-700 border-b-2 border-orange-600' : 'text-slate-500'}`}>Customer conversation</button>
                <button onClick={() => setTab('notes')} className={`pb-2 ${tab === 'notes' ? 'text-orange-700 border-b-2 border-orange-600' : 'text-slate-500'}`}>Internal notes</button>
              </div>

              {tab === 'messages' ? (
                <div className="mt-3">
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {(active.messages || []).map((m) => (
                      <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.sender_type === 'TRAVELER' ? 'bg-slate-100 text-slate-800' : 'ml-auto bg-orange-600 text-white'}`}>{m.body}</div>
                    ))}
                    {(active.messages || []).length === 0 && <p className="text-xs text-slate-400">No messages yet.</p>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Reply to customer…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                    <button onClick={send} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Send</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {(active.notes || []).filter((n) => !n.ticket_id || n.ticket_id === active.ticket.id).map((n) => (
                      <div key={n.id} className={`rounded-xl border p-3 text-sm ${n.pinned ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                        <p className="text-xs text-slate-400">{n.author_name} {n.pinned && '· pinned'}</p>
                        <p className="mt-1 text-slate-700">{n.body}</p>
                      </div>
                    ))}
                    {(active.notes || []).length === 0 && <p className="text-xs text-slate-400">No internal notes. These never appear to the customer.</p>}
                  </div>
                  <div className="mt-3 space-y-2">
                    <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} placeholder="Internal note (customer cannot see this)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button onClick={addNote} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Add note</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}