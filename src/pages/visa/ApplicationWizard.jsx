import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Loader2, AlertTriangle, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { getAnswers, putAnswer, checkReadiness, approveApplication, listApplicationDocuments } from '@/lib/visaApi';
import QuestionField from '@/components/visa/QuestionField';

const DOC_REF_TYPES = {
  'financial.bank_statement_reference': ['BANK_STATEMENT'],
  'invitation.invitation_letter_reference': ['INVITATION_LETTER'],
  'study.admission_letter_reference': ['ADMISSION_LETTER'],
  'previous_refusal.refusal_letter_reference': ['REFUSAL_LETTER'],
  'sponsorship.sponsor_financial_proof_reference': ['SPONSOR_FINANCIAL_PROOF'],
};

export default function ApplicationWizard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState('');
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef({});

  const load = () => {
    setLoading(true);
    Promise.all([getAnswers(id), listApplicationDocuments(id), checkReadiness(id)])
      .then(([a, d, r]) => { setData(a); setAttachments(d?.attachments || []); setReadiness(r); setErr(''); })
      .catch((e) => setErr(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const answersByCode = useMemo(() => {
    const m = {};
    for (const a of data?.answers || []) if (a.active !== false) m[a.question_code] = a;
    return m;
  }, [data?.answers]);

  const sections = data?.question_set?.sections || [];

  const requiredTotal = useMemo(() => sections.reduce((n, s) => n + s.questions.filter((q) => q.required).length, 0), [sections]);
  const requiredDone = useMemo(() => sections.reduce((n, s) => n + s.questions.filter((q) => q.required && answersByCode[q.code]?.verified && answersByCode[q.code]?.normalized_value).length, 0), [sections, answersByCode]);
  const pct = requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 0;

  const nextAction = useMemo(() => {
    for (const s of sections) for (const q of s.questions) if (q.required && !(answersByCode[q.code]?.verified && answersByCode[q.code]?.normalized_value)) return { section: s, question: q };
    return null;
  }, [sections, answersByCode]);

  const save = (code, value) => {
    if (saveTimers.current[code]) clearTimeout(saveTimers.current[code]);
    saveTimers.current[code] = setTimeout(async () => {
      setSaving(code);
      try {
        const res = await putAnswer({ id, question_code: code, value });
        setData((prev) => prev ? { ...prev, answers: upsert(prev.answers, res.answer), conflict_findings: res.conflict ? [res.conflict, ...(prev.conflict_findings || [])] : prev.conflict_findings } : prev);
        const r = await checkReadiness(id);
        setReadiness(r);
      } catch (e) { setErr(e?.message || 'Save failed'); }
      finally { setSaving(null); }
    }, 400);
  };
  const confirm = async (code) => {
    setSaving(code);
    try { const res = await putAnswer({ id, question_code: code, confirm: true }); const r = await checkReadiness(id); setReadiness(r); setData((p) => p ? { ...p, answers: upsert(p.answers, res.answer) } : p); }
    catch (e) { setErr(e?.message); } finally { setSaving(null); }
  };

  const approve = async () => {
    setApproved(true);
    try { await approveApplication(id); load(); } catch (e) { setErr(e?.message || 'Approval failed'); }
    finally { setApproved(false); }
  };

  const docOptionsFor = (code) => {
    const types = DOC_REF_TYPES[code] || [];
    return attachments.filter((a) => types.includes(a.document_type)).map((a) => ({ value: JSON.stringify({ document_id: a.document_id, document_version_id: a.document_version_id, display_name: a.document?.display_name || a.document_type }), label: a.document?.display_name || a.document_type }));
  };

  if (loading) return <div className="px-4 md:px-8 py-10 text-sm text-slate-500">Loading application…</div>;
  if (err && !data) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-red-600">{err}</p><Link to="/applications" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;

  const conflicts = data?.conflict_findings || [];

  return (
    <div className="px-4 md:px-8 pb-20">
      <Link to={`/applications/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Application</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Application form</h1>
          <p className="text-sm text-slate-500">{data?.application?.destination} · <span className="capitalize">{data?.application?.purpose}</span> · only the questions this route needs.</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-900">{pct}% complete</p>
          <p className="text-[11px] text-slate-400">{requiredDone}/{requiredTotal} required answered</p>
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} /></div>

      {nextAction && (
        <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Next: what do we need now?</p>
          <p className="mt-0.5 text-sm text-slate-700">{nextAction.question.label} <span className="text-slate-400">· {nextAction.section.label}</span></p>
          <a href={`#sec-${nextAction.section.key}`} className="mt-2 inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">Continue <ArrowRight size={13} /></a>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {sections.map((s) => (
          <section key={s.key} id={`sec-${s.key}`} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)] scroll-mt-20">
            <p className="text-sm font-semibold text-slate-900">{s.label}</p>
            <div className="mt-2 divide-y divide-slate-50">
              {s.questions.map((q) => <QuestionField key={q.code} question={q} answer={answersByCode[q.code]} saving={saving === q.code} onSave={save} onConfirm={confirm} docOptions={docOptionsFor(q.code)} />)}
            </div>
          </section>
        ))}
      </div>

      {/* Review */}
      <section className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Review & readiness</p>
          <button onClick={load} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw size={12} /> Refresh</button>
        </div>
        <ReadinessView readiness={readiness} />
        {conflicts.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-amber-700">Conflicts to review ({conflicts.length})</p>
            <ul className="mt-1 space-y-1">
              {conflicts.map((c) => <li key={c.id} className="inline-flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={11} /> {c.message}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={approve} disabled={!readiness?.ready || approved} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
            {approved ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Review & approve
          </button>
          {!readiness?.ready && readiness?.blocking_items?.length ? (
            <span className="text-[11px] text-slate-400">Resolve {readiness.blocking_items.length} blocking item(s) first</span>
          ) : null}
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </section>
    </div>
  );
}

function upsert(list, item) { if (!item) return list; const i = list.findIndex((x) => x.id === item.id); if (i < 0) return [...list, item]; const c = [...list]; c[i] = item; return c; }

function ReadinessView({ readiness }) {
  if (!readiness) return <p className="mt-2 text-sm text-slate-400">Checking readiness…</p>;
  const items = readiness.blocking_items || [];
  const byType = { QUESTION: [], DOCUMENT: [], FINDING: [], REVIEW: [] };
  for (const it of items) byType[it.type]?.push(it);
  if (readiness.ready) return (
    <div className="mt-2 flex items-center gap-2 text-orange-700"><CheckCircle2 size={18} /><p className="text-sm font-medium">Application is ready — all questions and documents complete.</p></div>
  );
  return (
    <div className="mt-2 space-y-2">
      <BlockGroup title="Questions" items={byType.QUESTION} />
      <BlockGroup title="Documents" items={byType.DOCUMENT} />
      <BlockGroup title="Validation findings" items={byType.FINDING} />
      <BlockGroup title="Reviews pending" items={byType.REVIEW} />
    </div>
  );
}
function BlockGroup({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => <li key={i} className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Circle size={12} className="text-slate-300" /> {it.message || it.code}</li>)}
      </ul>
    </div>
  );
}