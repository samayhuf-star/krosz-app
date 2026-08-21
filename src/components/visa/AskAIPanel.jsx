import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { X, SendHorizonal, Sparkles, Loader2, MessageSquare, LifeBuoy } from "lucide-react";
import AgentMessageBubble from "./AgentMessageBubble";

function agentForRole(role) {
  return role === "admin" ? "operations_assistant" : "traveler_assistant";
}

const GREETING = {
  traveler_assistant: "Hi! I'm your Arrivals assistant. Ask me about visa requirements, eligibility, start an application, or check a case status. What trip are you planning?",
  operations_assistant: "Hi! I'm the operations assistant. I can triage the task queue, explain a case, show overdue items or provider failures. What do you need?",
};

export default function AskAIPanel({ open, onClose }) {
  const { user } = useAuth();
  const agentName = agentForRole(user?.role);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Initialize / reuse conversation on open.
  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        let convs = [];
        try { convs = await base44.agents.listConversations({ q: { agent_name: agentName } }); }
        catch { convs = []; }
        let conv = Array.isArray(convs) && convs.find((c) => c.metadata?.persist === true);
        if (!conv) {
          conv = await base44.agents.createConversation({ agent_name: agentName, metadata: { name: "Ask AI", description: "Persistent visa assistant session", persist: true } });
        }
        if (!active) return;
        setConversation(conv);
        try {
          const fresh = await base44.agents.getConversation(conv.id);
          const seeded = fresh.messages && fresh.messages.length ? fresh.messages : [{ role: "assistant", content: GREETING[agentName] }];
          setMessages(seeded);
        } catch {
          setMessages([{ role: "assistant", content: GREETING[agentName] }]);
        }
      } catch (e) {
        if (!active) return;
        setError(e?.message || "Failed to load conversation");
        setMessages([{ role: "assistant", content: GREETING[agentName] }]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, user, agentName]);

  // Subscribe to streaming updates.
  useEffect(() => {
    if (!conversation?.id) return;
    const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
      if (data?.messages) setMessages(data.messages);
    });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [conversation?.id]);

  // Auto-scroll to bottom on new messages.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Focus input when opened.
  useEffect(() => {
    if (open && !loading) inputRef.current?.focus();
  }, [open, loading]);

  const send = async () => {
    const content = input.trim();
    if (!content || !conversation || sending) return;
    setInput("");
    setSending(true);
    setLastQuestion(content);
    try {
      await base44.agents.addMessage(conversation, { role: "user", content });
    } catch (e) {
      setError(e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const [lastQuestion, setLastQuestion] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [ticket, setTicket] = useState(null);
  const escalate = async () => {
    if (!lastQuestion) return;
    setEscalating(true); setTicket(null);
    try {
      const ctx = messages.slice(-6).map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`).join("\n");
      const res = await base44.functions.invoke("create-help-ticket", { question: lastQuestion, ai_context: ctx });
      const r = res?.data ?? res;
      setTicket(r?.ticket_number || "HELP-????");
    } catch (e) { setError(e?.message || "Could not escalate"); }
    finally { setEscalating(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm md:block" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl md:w-[28rem]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white"><Sparkles size={18} /></span>
            <div>
              <p className="text-sm font-semibold text-slate-950">Arrivals Assistant</p>
              <p className="text-xs text-slate-500">{agentName === "operations_assistant" ? "Operations · internal" : "Traveler support"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"><X size={20} /></button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading conversation…</div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{error} — showing limited mode.</div>
          )}
          {!loading && messages.map((m, idx) => <AgentMessageBubble key={idx} message={m} />)}
          {!loading && messages.length <= 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Try asking</p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {agentName === "operations_assistant" ? (
                  <>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "Which cases need document review?"</li>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "Show me overdue cases"</li>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "Provider failures today"</li>
                  </>
                ) : (
                  <>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "Do I need a visa for Thailand?"</li>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "What documents do I need for an Japan eVisa?"</li>
                    <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" /> "What's the status of my application?"</li>
                  </>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask about visas, requirements, or a case…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-1 focus:ring-orange-600"
            />
            <button type="button" onClick={send} disabled={!input.trim() || sending || loading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white transition-colors hover:bg-orange-700 disabled:opacity-40">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal size={18} />}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">The assistant can't submit or pay on your behalf — high-risk actions always require your confirmation.</p>
          {ticket && <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">Escalated to our team. Your reference is <strong>{ticket}</strong> — we'll email you and reply in your Support inbox.</p>}
          {lastQuestion && !ticket && (
            <button onClick={escalate} disabled={escalating} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {escalating ? <Loader2 size={12} className="animate-spin" /> : <LifeBuoy size={12} />} Can't answer this — escalate to a human
            </button>
          )}
        </div>
      </aside>
    </>
  );
}