import { useState, useRef, useEffect } from 'react';
import { understandBusiness } from '@/lib/discoveryApi';
import { MEMORY_LABELS } from '@/lib/accountMemory';
import { useSpeech } from '@/hooks/useSpeech';
import { trackAction } from '@/lib/productLearning';
import UnderstandingCard from '@/components/onboarding/UnderstandingCard';
import LaunchPreviewCard from '@/components/onboarding/LaunchPreviewCard';
import { Send, Mic, MicOff, Loader2, Sparkles, ArrowRight } from 'lucide-react';

const EXAMPLES = [
  'I own a gym in Noida.',
  'I am starting a dental clinic.',
  'I manufacture ladies innerwear.',
  'I have a hostel near KIET.',
  'I want to launch an online fashion brand.',
];

const uid = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);

function hasExisting(info) { return info && Object.values(info).some((v) => v); }

export default function DiscoveryInterview({ onLaunch, accountMemory = {} }) {
  const [messages, setMessages] = useState([{ id: uid(), role: 'ai', text: "👋 Welcome. Tell me about your business." }]);
  const [stage, setStage] = useState('intro'); // intro | analyzing | confirm | questions | existing | preview | launching
  const [profile, setProfile] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [qi, setQi] = useState(0);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const rememberedRows = Object.entries(accountMemory || {})
    .filter(([k, v]) => MEMORY_LABELS[k] && v)
    .map(([k, v]) => [k, v]);

  const { supported, listening, start, stop } = useSpeech((finalText) => setInput(finalText));

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, stage, listening]);

  const push = (m) => setMessages((arr) => [...arr, { id: uid(), ...m }]);

  const analyze = async (text) => {
    if (!text.trim()) return;
    trackAction('onboarding_describe');
    push({ role: 'user', text });
    setInput('');
    setStage('analyzing');
    try {
      const res = await understandBusiness(text, accountMemory);
      if (!res || !res.business_name) throw new Error('I could not understand that — could you add a little more detail?');
      res.raw_description = text;
      setProfile(res);
      setQuestions(res.questions || []);
      push({ role: 'ai', text: "Here is what I understood." });
      push({ role: 'ai', card: 'understanding' });
      setStage('confirm');
    } catch (e) {
      push({ role: 'ai', text: e.message || 'Something went wrong. Try describing your business again.' });
      setStage('intro');
    }
  };

  const confirmProfile = () => {
    const conf = Number(profile?.confidence || 0);
    const needQuestions = conf < 90 && questions.length > 0;
    if (needQuestions) askQuestion(0);
    else if (hasExisting(profile?.existing_info)) showExisting();
    else showPreview();
  };

  const askQuestion = (i) => {
    setQi(i);
    push({ role: 'ai', text: questions[i].question, why: questions[i].why });
    setStage('questions');
  };

  const answerQuestion = (text) => {
    const q = questions[qi];
    if (text.trim()) {
      setProfile((p) => ({ ...p, [q.field_key]: text.trim() }));
      push({ role: 'user', text });
    }
    const next = qi + 1;
    if (next < questions.length) askQuestion(next);
    else if (hasExisting(profile?.existing_info)) showExisting();
    else showPreview();
  };

  const skipQuestion = () => {
    const next = qi + 1;
    if (next < questions.length) askQuestion(next);
    else if (hasExisting(profile?.existing_info)) showExisting();
    else showPreview();
  };

  const showExisting = () => {
    push({ role: 'ai', text: 'We found existing information about your business. Please review.' });
    push({ role: 'ai', card: 'existing' });
    setStage('existing');
  };

  const showPreview = () => { push({ role: 'ai', card: 'launch' }); setStage('preview'); };

  const launch = async () => {
    trackAction('onboarding_launch');
    setStage('launching');
    setLaunching(true);
    setError('');
    try { await onLaunch(profile); } catch (e) { setError(e.message || 'Could not launch. Please try again.'); setLaunching(false); setStage('preview'); }
  };

  const onCardConfirm = () => confirmProfile();
  const onCardSave = (updated) => setProfile(updated);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (stage === 'intro') analyze(text);
    else if (stage === 'questions') answerQuestion(text);
  };

  // ---- Composer ----
  const composer = () => {
    if (stage === 'analyzing' || stage === 'launching') {
      return <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> {stage === 'analyzing' ? 'Understanding your business…' : 'Launching your business…'}</div>;
    }
    if (stage === 'confirm' || stage === 'existing' || stage === 'preview') return null;
    const isQuestion = stage === 'questions';
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        {isQuestion && questions[qi]?.why && <p className="mb-2 px-1 text-xs text-slate-400">Why I need this: {questions[qi].why}</p>}
        <div className="flex items-end gap-2">
          {supported && (
            <button onClick={listening ? stop : start} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${listening ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`} title={listening ? 'Stop speaking' : 'Speak'}>
              {listening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
          )}
          <textarea
            rows={stage === 'intro' ? 3 : 1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={isQuestion ? 'Your answer…' : 'Describe your business in one sentence…'}
            className="flex-1 resize-none rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
          {isQuestion && <button onClick={skipQuestion} className="shrink-0 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:text-slate-600">Skip</button>}
          <button onClick={submit} disabled={!input.trim()} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Send size={16} /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col px-4 sm:px-6">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.map((m) => {
          if (m.card === 'understanding') return <div key={m.id} className="flex justify-start"><div className="w-full max-w-xl"><UnderstandingCard profile={profile} onConfirm={onCardConfirm} onSave={onCardSave} /></div></div>;
          if (m.card === 'existing') return <ExistingInfoCard key={m.id} info={profile?.existing_info} onConfirm={showPreview} />;
          if (m.card === 'launch') return <div key={m.id} className="flex justify-start"><div className="w-full max-w-xl"><LaunchPreviewCard onLaunch={launch} launching={launching} error={error} /></div></div>;
          const ai = m.role === 'ai';
          return (
            <div key={m.id} className={`flex ${ai ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${ai ? 'bg-white border border-slate-200 text-slate-800' : 'bg-emerald-600 text-white'}`}>
                {ai && m.id === messages[0]?.id && <Sparkles size={14} className="mb-1 inline text-emerald-600" />}
                <p className="whitespace-pre-wrap text-sm leading-6">{m.text}</p>
                {m.why && <p className="mt-1 text-[11px] text-slate-400">Why: {m.why}</p>}
              </div>
            </div>
          );
        })}

        {stage === 'intro' && (
          <div className="space-y-2 pt-1">
            {rememberedRows.length > 0 && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Reusing from your account</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {rememberedRows.map(([k, v]) => (
                    <span key={k} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600"><span className="text-slate-400">{MEMORY_LABELS[k] || k}:</span> {String(v)}</span>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">We'll only ask what's different for this business.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setInput(ex)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:border-emerald-300 hover:text-emerald-700">{ex}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="py-3">{composer()}</div>
    </div>
  );
}

function ExistingInfoCard({ info, onConfirm }) {
  const rows = Object.entries(info || {}).filter(([, v]) => v);
  if (!rows.length) return null;
  const label = { website: 'Website', phone: 'Phone', email: 'Email', google_business: 'Google Business', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' };
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-xl rounded-2xl border border-sky-200 bg-sky-50/50 p-5">
        <p className="text-sm font-semibold text-slate-900">We found existing information about your business.</p>
        <p className="text-xs text-slate-500">Please review — these have been added to your profile.</p>
        <ul className="mt-3 space-y-1.5">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center gap-2 text-sm">
              <ArrowRight size={13} className="text-sky-600" />
              <span className="text-slate-500">{label[k] || k}:</span>
              <span className="font-medium text-slate-800">{v}</span>
            </li>
          ))}
        </ul>
        <button onClick={onConfirm} className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Looks good, continue</button>
      </div>
    </div>
  );
}