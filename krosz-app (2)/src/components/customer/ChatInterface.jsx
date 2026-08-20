import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { actionApi } from '@/lib/actionApi';
import { useActiveBusiness } from '@/lib/ActiveBusinessContext';
import { trackAction } from '@/lib/productLearning';
import AssistantActionCard from '@/components/assistant/AssistantActionCard';
import { Send, Sparkles, Loader2 } from 'lucide-react';

const SUGGESTIONS = [
  'How is my business doing?',
  'Show me my customers',
  'Analyze my website',
  'Improve my website',
  'Improve my SEO',
  'Launch my business',
];

const TERMINAL = new Set(['completed', 'failed', 'capability_not_available', 'blocked']);

export default function ChatInterface({ initialMessage }) {
  const { activeBusiness } = useActiveBusiness();
  const qc = useQueryClient();
  const [messages, setMessages] = useState([{ role: 'assistant', text: "Tell me what you want me to do — I'll route it to the right tool and get it done." }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const sentInitial = useRef(false);
  const scrollRef = useRef(null);
  const polls = useRef({});

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, sending]);

  const stopPoll = (id) => { if (polls.current[id]) { clearTimeout(polls.current[id]); delete polls.current[id]; } };
  useEffect(() => () => Object.keys(polls.current).forEach(stopPoll), []);

  const refreshBusinessState = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['business-context'] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['home'] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['journey-nav'] }).catch(() => {});
  }, [qc]);

  const pollAction = useCallback((actionId) => {
    if (!activeBusiness?.id) return;
    stopPoll(actionId);
    polls.current[actionId] = setTimeout(async () => {
      try {
        const res = await actionApi.getStatus(activeBusiness.id, actionId);
        const action = res?.action;
        if (!action) { delete polls.current[actionId]; return; }
        setMessages((m) => m.map((x) => x.actionId === actionId ? { ...x, action, progress: res.progress } : x));
        if (action.status && TERMINAL.has(action.status)) { delete polls.current[actionId]; refreshBusinessState(); }
        else pollAction(actionId);
      } catch { delete polls.current[actionId]; }
    }, 2500);
  }, [activeBusiness?.id, refreshBusinessState]);

  const updateAction = useCallback((action) => {
    setMessages((m) => m.map((x) => x.actionId === action.id ? { ...x, action } : x));
    if (action.status && TERMINAL.has(action.status)) { stopPoll(action.id); refreshBusinessState(); }
    else pollAction(action.id);
  }, [pollAction, refreshBusinessState]);

  const send = async (text) => {
    const request = (text ?? '').trim();
    if (!request || sending) return;
    if (!activeBusiness?.id) { setMessages((m) => [...m, { role: 'assistant', text: 'Pick a business first and I will route your request.' }]); return; }
    trackAction('ask_ai');
    setMessages((m) => [...m, { role: 'user', text: request }]);
    setInput('');
    setSending(true);
    try {
      const res = await actionApi.request(activeBusiness.id, request);
      const action = res?.action;
      if (!action) { setMessages((m) => [...m, { role: 'assistant', text: "I couldn't reach the action service right now." }]); return; }
      const msg = { role: 'assistant', actionId: action.id, action, progress: null };
      setMessages((m) => [...m, msg]);
      if (action.status && TERMINAL.has(action.status)) refreshBusinessState();
      else pollAction(action.id);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: "I couldn't reach the action service right now — please try again." }]);
    } finally {
      setSending(false);
    }
  };

  const onApprove = async (actionId) => { setBusyAction(actionId); try { const res = await actionApi.approve(activeBusiness.id, actionId); if (res?.action) updateAction(res.action); } finally { setBusyAction(null); } };
  const onRetry = async (actionId) => { setBusyAction(actionId); try { const res = await actionApi.retry(activeBusiness.id, actionId); if (res?.action) updateAction(res.action); } finally { setBusyAction(null); } };

  useEffect(() => {
    if (initialMessage && !sentInitial.current && activeBusiness?.id) { sentInitial.current = true; send(initialMessage); }
  }, [initialMessage, activeBusiness?.id]);  

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
        {messages.map((m, i) => m.action ? (
          <div key={i} className="flex justify-start">
            <div className="w-full max-w-[88%]">
              <AssistantActionCard action={m.action} progress={m.progress} onApprove={() => onApprove(m.actionId)} onRetry={() => onRetry(m.actionId)} busy={busyAction === m.actionId} />
            </div>
          </div>
        ) : (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
              <p className="leading-6">{m.text}</p>
            </div>
          </div>
        ))}
        {sending && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Working on it…</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700">{s}</button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Sparkles size={16} /></span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="What would you like me to do?" className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
        <button type="submit" disabled={sending || !input.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Send size={15} /> Send</button>
      </form>
    </div>
  );
}