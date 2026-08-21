import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, MessageSquare } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { listApplications, listSupportTickets, listConversationMessages, sendSupportMessage } from '@/lib/visaApi';

export default function SupportCenter() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // {ticket, messages}
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const apps = (await listApplications()).applications || [];
      const out = [];
      for (const a of apps) {
        const r = await listSupportTickets(a.id).catch(() => ({ tickets: [] }));
        for (const t of (r.tickets || [])) out.push({ app: a, ticket: t });
      }
      out.sort((x, y) => String(y.ticket.created_date || "").localeCompare(String(x.ticket.created_date || "")));
      setGroups(out);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openThread = async (g) => {
    try {
      const r = await listConversationMessages(g.ticket.conversation_id);
      setActive({ ticket: g.ticket, app: g.app, messages: r.messages || [] });
    } catch { setActive({ ticket: g.ticket, app: g.app, messages: [] }); }
  };

  const send = async () => {
    if (!active || !body.trim()) return;
    setSending(true);
    try { await sendSupportMessage(active.ticket.conversation_id, body); setBody(""); const r = await listConversationMessages(active.ticket.conversation_id); setActive({ ...active, messages: r.messages || [] }); }
    finally { setSending(false); }
  };

  return (
    <div className="px-4 md:px-8">
      <PageHeader title="Support" subtitle="Message us about any of your applications." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          {loading ? <p className="text-sm text-slate-500">Loading…</p> :
            groups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700"><LifeBuoy size={22} /></span>
                <p className="mt-3 text-sm font-medium text-slate-900">No support tickets yet</p>
                <p className="mt-1 text-sm text-slate-500">Open an application to start a support conversation.</p>
                <Link to="/applications" className="mt-3 inline-flex text-sm font-semibold text-orange-700">Go to applications →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => (
                  <button key={g.ticket.id} onClick={() => openThread(g)} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-orange-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{g.ticket.ticket_number} · <span className="capitalize">{g.ticket.category.toLowerCase()}</span></p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.ticket.status === 'RESOLVED' ? 'bg-orange-50 text-orange-700' : 'bg-amber-50 text-amber-700'}`}>{g.ticket.status.replace(/_/g, ' ').toLowerCase()}</span>
                    </div>
                    <p className="text-xs text-slate-500">{g.app.destination} · {g.ticket.subject}</p>
                    <p className="mt-1 text-xs text-slate-400 truncate">{g.ticket.first_message}</p>
                  </button>
                ))}
              </div>
            )}
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          {active ? (
            <>
              <p className="text-sm font-semibold text-slate-900">{active.ticket.ticket_number} · {active.app.destination}</p>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {active.messages.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.sender_type === 'TRAVELER' ? 'ml-auto bg-orange-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{m.body}</div>
                ))}
                {active.messages.length === 0 && <p className="text-xs text-slate-400">No messages yet.</p>}
              </div>
              <div className="mt-3 flex gap-2">
                <input className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Reply…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                <button onClick={send} disabled={sending} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><MessageSquare size={14} /></button>
              </div>
            </>
          ) : <p className="text-sm text-slate-400">Select a ticket to read and reply.</p>}
        </div>
      </div>
    </div>
  );
}