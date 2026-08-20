import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { base44 } from '@/api/base44Client';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';

const AGENT = 'traveler_assistant';
const SUGGESTIONS = [
  'What visa do I need for Thailand as an Indian passport holder?',
  'What documents are required for a Schengen visa?',
  'What is the next step for my current application?',
];

function ToolChip({ toolCall }) {
  const status = toolCall?.status || 'pending';
  const failed = ['failed', 'error'].includes(status);
  const running = ['pending', 'running', 'in_progress'].includes(status);
  const label = toolCall?.display_projection?.label
    || (failed ? toolCall?.display_projection?.error_label : toolCall?.display_projection?.active_label)
    || 'Checking visa details';
  return (
    <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${failed ? 'bg-rose-50 text-rose-700' : running ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
      {running ? <Loader2 size={11} className="animate-spin" /> : failed ? <X size={11} /> : <Sparkles size={11} />}
      {label}
    </span>
  );
}

export default function TravelerConcierge() {
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open || conversation) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const existingId = localStorage.getItem('krosz_concierge_conv');
        let conv = null;
        if (existingId) { try { conv = await base44.agents.getConversation(existingId); } catch { conv = null; } }
        if (!conv) conv = await base44.agents.createConversation({ agent_name: AGENT, metadata: { name: 'Krosz Concierge', description: 'Traveler AI concierge' } });
        if (cancelled) return;
        setConversation(conv);
        setMessages(conv.messages || []);
        localStorage.setItem('krosz_concierge_conv', conv.id);
      } catch (e) {
        if (!cancelled) setError('Could not start the concierge right now. Please try again.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, conversation]);

  useEffect(() => {
    if (!conversation?.id) return;
    const unsub = base44.agents.subscribeToConversation(conversation.id, (data) => {
      const next = data.messages || [];
      setMessages(next);
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last?.content?.trim()) setBusy(false);
    });
    return unsub;
  }, [conversation?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || !conversation || busy) return;
    setInput(''); setBusy(true);
    try {
      await base44.agents.addMessage(conversation, { role: 'user', content });
    } catch (e) {
      setBusy(false);
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry, something went wrong sending your message. Please try again.' }]);
    }
  };

  const hasUserMsg = messages.some((m) => m.role === 'user');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Ask the Krosz AI concierge"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#003580] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#003580]/20 transition hover:bg-[#00225A] sm:bottom-6 sm:right-6"
      >
        <Sparkles size={18} />
        <span className="hidden sm:inline">Ask Krosz AI</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-900/20 sm:bg-transparent sm:p-6" role="dialog" aria-label="Krosz AI concierge" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="flex h-[80vh] w-full max-h-[640px] sm:h-[600px] sm:w-[400px] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-[#003580] px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15"><Sparkles size={16} /></span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">Krosz AI Concierge</p>
                  <p className="text-[11px] text-white/70">Visa guidance for your trip</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close concierge" className="rounded-lg p-1.5 hover:bg-white/15"><X size={18} /></button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[#f5f7fa] px-4 py-4">
              {loading && <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Starting your concierge…</div>}
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
              {!loading && !error && messages.length === 0 && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">
                    Hi! I'm your Krosz visa concierge. Ask me about visa requirements, the documents you'll need, or your next steps — I'll use verified visa data to guide you.
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Try asking</p>
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-[#006CEC] hover:text-[#006CEC]">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div key={i} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${isUser ? 'bg-[#003580] text-white' : 'bg-white text-slate-800 shadow-sm'}`}>
                      {m.content && (isUser
                        ? <p className="whitespace-pre-wrap">{m.content}</p>
                        : <div className="prose-sm leading-relaxed"><ReactMarkdown components={{ a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" className="text-[#006CEC] underline" /> }}>{m.content}</ReactMarkdown></div>)}
                      {m.tool_calls?.map((tc, idx) => <ToolChip key={idx} toolCall={tc} />)}
                    </div>
                  </div>
                );
              })}
              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-3.5 py-2.5 shadow-sm">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Thinking…</span>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={hasUserMsg ? 'Ask about requirements, documents, next steps…' : 'Ask your visa question…'}
                className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-[#006CEC] focus:ring-2 focus:ring-[#006CEC]/20"
              />
              <button type="submit" disabled={!conversation || busy || !input.trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#003580] text-white hover:bg-[#00225A] disabled:opacity-40" aria-label="Send message">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}