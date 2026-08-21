import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2, FolderOpen, RotateCw, XCircle } from 'lucide-react';
import QuestionField from '@/components/visa/QuestionField';
import WorkspaceNav from '@/components/visa/workspace/WorkspaceNav';
import WorkspaceReview from '@/components/visa/workspace/WorkspaceReview';
import { startWorkspace, putAnswer, listApplicationDocuments, getWorkspaceReadiness, cancelApplication } from '@/lib/visaApi';

const DOC_REF_TYPES = {
  'financial.bank_statement_reference': ['BANK_STATEMENT'],
  'invitation.invitation_letter_reference': ['INVITATION_LETTER'],
  'study.admission_letter_reference': ['ADMISSION_LETTER'],
  'previous_refusal.refusal_letter_reference': ['REFUSAL_LETTER'],
  'sponsorship.sponsor_financial_proof_reference': ['SPONSOR_FINANCIAL_PROOF'],
};

function computeProgress(sections, answersByCode) {
  let rt = 0, rd = 0;
  const out = (sections || []).map((s) => {
    const req = s.questions.filter((q) => q.required);
    const done = req.filter((q) => { const a = answersByCode[q.code]; return a && a.normalized_value && a.verified; }).length;
    rt += req.length; rd += done;
    return { key: s.key, label: s.label, total: req.length, done, complete: req.length > 0 && done === req.length };
  });
  return { overall_pct: rt ? Math.round((rd / rt) * 100) : 0, required_total: rt, required_done: rd, sections: out };
}

export default function ApplicationWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ws, setWs] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [active, setActive] = useState(null); // section key | 'DOCUMENTS' | 'REVIEW'
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const readinessTimer = useRef(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([startWorkspace(id), listApplicationDocuments(id)])
      .then(([w, d]) => {
        setWs(w);
        setAttachments(d?.attachments || []);
        setReadiness(w.readiness);
        const prog = computeProgress(w.sections, byCode(w.answers));
        const firstIncomplete = prog.sections.find((s) => !s.complete);
        setActive(firstIncomplete ? firstIncomplete.key : 'REVIEW');
      })
      .catch((e) => setErr(e?.message || 'Failed to load workspace'))
      .finally(() => setLoading(false));
  }, [id]);

  const answersByCode = useMemo(() => byCode(ws?.answers), [ws?.answers]);
  const progress = useMemo(() => {
    const p = computeProgress(ws?.sections, answersByCode);
    return { ...p, documents: ws?.progress?.documents };
  }, [ws?.sections, answersByCode, ws?.progress?.documents]);

  const navSections = progress.sections;
  const resumeAt = useMemo(() => {
    const first = navSections.find((s) => !s.complete);
    return first ? first.key : null;
  }, [navSections]);

  const refreshReadiness = () => {
    if (readinessTimer.current) clearTimeout(readinessTimer.current);
    readinessTimer.current = setTimeout(async () => {
      try { setReadiness(await getWorkspaceReadiness(id)); } catch {}
    }, 700);
  };

  const save = (code, value) => {
    setSaving(code);
    putAnswer({ id, question_code: code, value })
      .then((res) => {
        setWs((prev) => prev ? { ...prev, answers: upsert(prev.answers, res.answer), conflict_findings: res.conflict ? [res.conflict, ...(prev.conflict_findings || [])] : prev.conflict_findings } : prev);
        refreshReadiness();
      })
      .catch((e) => setErr(e?.message || 'Save failed'))
      .finally(() => setSaving(null));
  };
  const confirmAnswer = (code) => {
    setSaving(code);
    putAnswer({ id, question_code: code, confirm: true })
      .then((res) => setWs((prev) => prev ? { ...prev, answers: upsert(prev.answers, res.answer) } : prev))
      .catch((e) => setErr(e?.message))
      .finally(() => setSaving(null));
  };

  const docOptionsFor = (code) => {
    const types = DOC_REF_TYPES[code] || [];
    return attachments.filter((a) => types.includes(a.document_type)).map((a) => ({ value: JSON.stringify({ document_id: a.document_id, document_version_id: a.document_version_id, display_name: a.document?.display_name || a.document_type }), label: a.document?.display_name || a.document_type }));
  };

  const goNext = () => {
    const order = [...navSections.map((s) => s.key), 'DOCUMENTS', 'REVIEW'];
    const idx = order.indexOf(active);
    // jump to next incomplete section, else DOCUMENTS/REVIEW
    for (let i = idx + 1; i < order.length; i++) {
      const key = order[i];
      if (key === 'DOCUMENTS' || key === 'REVIEW') { setActive(key); return; }
      const s = navSections.find((x) => x.key === key);
      if (s && !s.complete) { setActive(key); return; }
    }
    setActive('REVIEW');
  };
  const goBack = () => {
    const order = [...navSections.map((s) => s.key), 'DOCUMENTS', 'REVIEW'];
    const idx = order.indexOf(active);
    if (idx > 0) { const prev = order[idx - 1]; const el = document.getElementById(`ws-${prev}`); if (el) el.scrollIntoView(); setActive(prev); }
  };

  const handleCancel = async () => {
    if (!confirmAction('Cancel this application? This cannot be undone.')) return;
    setCancelling(true);
    try { await cancelApplication(id); navigate('/applications'); }
    catch (e) { setErr(e?.message || 'Cancel failed'); }
    finally { setCancelling(false); }
  };

  const reload = () => {
    setLoading(true);
    startWorkspace(id).then((w) => { setWs(w); setReadiness(w.readiness); }).catch((e) => setErr(e?.message)).finally(() => setLoading(false));
  };

  if (loading) return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Loading your application workspace…</div>;
  if (err && !ws) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-rose-600">{err}</p><Link to="/applications" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;

  const app = ws.application;
  const snap = ws.snapshot;
  const optionName = snap?.visa_option?.name || app.visa_type_key;
  const sections = ws.sections || [];
  const current = sections.find((s) => s.key === active);

  return (
    <div className="px-4 md:px-8 pb-24">
      <div className="flex items-center justify-between">
        <Link to={`/applications/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Application overview</Link>
        <button onClick={reload} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><RotateCw size={13} /> Refresh</button>
      </div>

      {/* Header */}
      <div className="mt-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">{app.destination} · <span className="capitalize">{app.purpose}</span> visa</h1>
            <p className="text-sm text-slate-500">{optionName} · <span className="capitalize">{app.channel}</span> channel{app.appointment_required ? ' · appointment required' : ''}</p>
            {snap && <p className="mt-1 text-[11px] text-slate-400">Rule context pinned at creation · requirements v{snap.requirements_version || '—'}{snap.fee_version ? ` · fees v${snap.fee_version}` : ''}. Changing rules won't affect this application.</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-slate-950">{progress.overall_pct}%</p>
            <p className="text-[11px] text-slate-400">{progress.required_done}/{progress.required_total} required answered</p>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress.overall_pct}%` }} /></div>
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Sidebar nav (desktop) */}
        <aside className="lg:w-72 lg:shrink-0">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-4">
            <WorkspaceNav sections={navSections} active={active} onSelect={(k) => { setActive(k); document.getElementById(`ws-${k}`)?.scrollIntoView(); }} reviewActive={active === 'REVIEW'} onSelectReview={() => { setActive('REVIEW'); document.getElementById('ws-REVIEW')?.scrollIntoView(); }} resumeAt={resumeAt} />
          </div>
        </aside>

        {/* Active section / review */}
        <main className="min-w-0 flex-1 space-y-5" id={`ws-${active}`}>
          {active === 'REVIEW' ? (
            <WorkspaceReview ws={{ ...ws, progress, readiness }} onJump={(type, key) => { setActive(key); document.getElementById(`ws-${key}`)?.scrollIntoView(); }} onRefresh={refreshReadiness} />
          ) : active === 'DOCUMENTS' ? (
            <DocumentsSection ws={ws} attachments={attachments} />
          ) : current ? (
            <SectionCard section={current}>
              <div className="divide-y divide-slate-50">
                {current.questions.map((q) => <QuestionField key={q.code} question={q} answer={answersByCode[q.code]} saving={saving === q.code} onSave={save} onConfirm={confirmAnswer} docOptions={docOptionsFor(q.code)} />)}
              </div>
            </SectionCard>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No questions for this section.</div>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between gap-2">
            <button onClick={goBack} disabled={active === navSections[0]?.key} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={15} /> Back</button>
            {active !== 'REVIEW' ? (
              <button onClick={goNext} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700">Save & continue <ArrowRight size={15} /></button>
            ) : (
              <button onClick={handleCancel} disabled={cancelling} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">{cancelling ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />} Cancel application</button>
            )}
          </div>
        </main>
      </div>

      {err && <p className="mt-4 text-sm text-rose-600">{err}</p>}
      <p className="mt-6 text-[11px] text-amber-700">Some requirements are still being verified. Your answers are saved automatically — close and resume any time.</p>
    </div>
  );
}

function SectionCard({ section, children }) {
  return (
    <section className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{section.label}</h2>
        <span className="text-[11px] text-slate-400">{section.questions.length} question{section.questions.length === 1 ? '' : 's'}</span>
      </div>
      {children}
    </section>
  );
}

function DocumentsSection({ ws, attachments }) {
  const docItems = (ws.checklist?.items || []).filter((i) => i.type === 'document');
  return (
    <section className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Documents</h2>
        <Link to="/documents" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"><FolderOpen size={13} /> Open Document Vault</Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">Your documents live in the reusable Document Vault. Link the same passport across multiple applications — nothing is duplicated.</p>
      <div className="mt-4 divide-y divide-slate-100">
        {docItems.length === 0 && <p className="py-3 text-sm text-slate-400">No document requirements for this route.</p>}
        {docItems.map((it) => (
          <div key={it.key} className="flex items-center gap-3 py-2.5">
            {it.state === 'AVAILABLE' ? <CheckCircle2 size={16} className="text-orange-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">{it.label}</p>
              <p className="text-[11px] text-slate-400 capitalize">{it.state.toLowerCase().replace(/_/g, ' ')}{it.required ? ' · required' : ''}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/documents" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Upload to vault</Link>
        <Link to={`/applications/${ws.application?.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Manage linked documents</Link>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">{attachments.length} document(s) linked to this application.</p>
    </section>
  );
}

function byCode(answers) { const m = {}; for (const a of answers || []) if (a.active !== false) m[a.question_code] = a; return m; }
function upsert(list, item) { if (!item) return list; const i = list.findIndex((x) => x.id === item.id); if (i < 0) return [...list, item]; const c = [...list]; c[i] = item; return c; }
function confirmAction(msg) { return typeof window !== 'undefined' ? window.confirm(msg) : true; }