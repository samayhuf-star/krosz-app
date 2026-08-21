import { useEffect, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { listSupportTickets, listConversationMessages, sendSupportMessage, createSupportTicket } from "@/lib/visaApi";

const CATEGORIES = [
  { value: "STATUS", label: "Application status" },
  { value: "DOCUMENTS", label: "Documents" },
  { value: "PAYMENT", label: "Payment" },
  { value: "APPOINTMENT", label: "Appointment" },
  { value: "SUBMISSION", label: "Submission" },
  { value: "REFUND", label: "Refund" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "OTHER", label: "Other" },
];

export default function SupportPanel({ applicationId }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ category: "STATUS", subject: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try { const r = await listSupportTickets(applicationId); setTickets(r.tickets || []); }
    catch (e) { setError(e?.message || ""); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [applicationId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    setSubmitting(true); setError("");
    try {
      await createSupportTicket({ id: applicationId, category: form.category, subject: form.subject, message: form.message });
      setForm({ category: "STATUS", subject: "", message: "" });
      setShowNew(false);
      load();
    } catch (err) { setError(err?.message || "Could not create ticket"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mt-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><LifeBuoy size={16} className="text-orange-600" /><p className="text-sm font-semibold text-slate-900">Support</p></div>
        {!showNew && <button onClick={() => setShowNew(true)} className="text-xs font-semibold text-orange-700 hover:text-orange-800">+ New ticket</button>}
      </div>

      {showNew && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-slate-100 p-4">
          <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Subject (optional)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={3} placeholder="Describe your issue" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">Create ticket</button>
            <button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 space-y-2">
        {loading ? <p className="text-sm text-slate-400">Loading…</p> :
          tickets.length === 0 ? <p className="text-sm text-slate-400">No support tickets for this application.</p> :
          tickets.map((t) => <TicketRow key={t.id} ticket={t} />)}
      </div>
    </div>
  );
}

function TicketRow({ ticket }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const openThread = async () => {
    if (!open && ticket.conversation_id) {
      try { const r = await listConversationMessages(ticket.conversation_id); setMessages(r.messages || []); } catch {}
    }
    setOpen(!open);
  };

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try { await sendSupportMessage(ticket.conversation_id, body); setBody(""); const r = await listConversationMessages(ticket.conversation_id); setMessages(r.messages || []); }
    catch {}
    finally { setSending(false); }
  };

  return (
    <div className="rounded-xl border border-slate-100">
      <button onClick={openThread} className="flex w-full items-center justify-between p-3 text-left">
        <div>
          <p className="text-sm font-medium text-slate-800">{ticket.ticket_number} · <span className="capitalize">{ticket.category.toLowerCase()}</span></p>
          <p className="text-xs text-slate-500">{ticket.subject}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ticket.status === "RESOLVED" || ticket.status === "CLOSED" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}>{ticket.status.replace(/_/g, " ").toLowerCase()}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3">
          <div className="max-h-64 space-y-2 overflow-auto">
            {messages.map((m) => (
              <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.sender_type === "TRAVELER" ? "ml-auto bg-orange-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                <p>{m.body}</p>
              </div>
            ))}
            {messages.length === 0 && <p className="text-xs text-slate-400">No messages yet.</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Reply…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button onClick={send} disabled={sending} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"><Send size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}