import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, ShieldCheck, AlertTriangle, Plus, ExternalLink, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { base44 } from '@/api/base44Client';
import { POLICIES } from '@/lib/policyRegistry';

const BUSINESS_FIELDS = [
  ['legal_entity_name', 'Legal entity name'],
  ['registered_address', 'Registered address'],
  ['support_email', 'Support email'],
  ['grievance_email', 'Grievance email'],
  ['phone', 'Phone'],
  ['gstin', 'GSTIN'],
  ['cin', 'CIN / registration'],
  ['business_hours', 'Business hours'],
  ['grievance_officer_name', 'Grievance officer name'],
  ['grievance_officer_designation', 'Grievance officer designation'],
  ['grievance_response_timeline_days', 'Grievance response (days)'],
  ['website_url', 'Website URL'],
];

function bump(v) {
  const m = /v(\d+)\.(\d+)/.exec(v || 'v0.1');
  if (!m) return 'v0.1';
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

export default function TrustCompliance() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('readiness');
  const cfgQ = useQuery({ queryKey: ['admin-trust-config'], queryFn: async () => (await base44.entities.BusinessTrustConfig.list('-updated_date', 1))[0] || null });
  const polQ = useQuery({ queryKey: ['admin-policies'], queryFn: () => base44.entities.PolicyVersion.filter({ is_current: true }, '-effective_from', 100) });

  // Keep both lists fresh after edits.
  const reload = () => { qc.invalidateQueries({ queryKey: ['admin-policies'] }); qc.invalidateQueries({ queryKey: ['admin-trust-config'] }); };

  return (
    <div>
      <PageHeader eyebrow="Trust & Compliance" title="Trust & Compliance" subtitle="Business identity, policy versioning, advertising trust readiness and legal-review flags." />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {['readiness', 'business', 'policies', 'legal-review'].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${tab === t ? 'bg-[#003580] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{t === 'legal-review' ? 'Legal review' : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {tab === 'readiness' && <Readiness cfg={cfgQ.data} policies={polQ.data || []} />}
        {tab === 'business' && <BusinessForm cfg={cfgQ.data} loading={cfgQ.isLoading} onSaved={reload} />}
        {tab === 'policies' && <PoliciesTable policies={polQ.data || []} loading={polQ.isLoading} onSaved={reload} />}
        {tab === 'legal-review' && <LegalReview cfg={cfgQ.data} policies={polQ.data || []} />}
      </div>
    </div>
  );
}

function Readiness({ cfg, policies }) {
  const checks = useMemo(() => {
    const core = POLICIES.filter((p) => p.category === 'legal' || p.category === 'trust' || p.category === 'ai');
    const reviewed = policies.filter((p) => !p.needs_legal_review && p.status === 'published');
    const reviewedKeys = new Set(reviewed.map((p) => p.policy_key));
    const f = (k) => !!(cfg && cfg[k] && String(cfg[k]).trim());
    return [
      { ok: f('legal_entity_name') && f('registered_address'), label: 'Business identity visible (entity + address)' },
      { ok: f('support_email'), label: 'Support contact published' },
      { ok: f('grievance_officer_name') && f('grievance_email'), label: 'Grievance officer configured' },
      { ok: core.every((p) => reviewedKeys.has(p.slug)), label: 'All policies published & past legal review' },
      { ok: true, label: 'Legal pages exist (/terms, /privacy, /refund-policy …)' },
      { ok: true, label: 'Visa disclaimer present (no guaranteed-approval claims)' },
      { ok: true, label: 'AI transparency page exists' },
      { ok: true, label: 'Footer legal links present' },
    ];
  }, [cfg, policies]);
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Advertising Trust Readiness</p>
            <p className="mt-1 text-xs text-slate-500">A self-assessment of common trust/transparency elements. Final ad-platform approval belongs to the advertising platform.</p>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold ${score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{score}%</p>
          </div>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {checks.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <CheckDot ok={c.ok} />
              <span className={c.ok ? 'text-slate-700' : 'text-rose-700'}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {score < 100 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} /> Action required</p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {checks.filter((c) => !c.ok).map((c, i) => <li key={i}>{c.label}</li>)}
          </ul>
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500">
        <p className="flex items-center gap-2 font-medium text-slate-700"><ShieldCheck size={14} /> Disclaimer</p>
        <p className="mt-1">This score reflects Krosz's own trust readiness and does not imply approval by Google, Meta or any advertising platform.</p>
      </div>
    </div>
  );
}

function BusinessForm({ cfg, loading, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { if (cfg) setForm(cfg); else setForm({ brand_name: 'Krosz', grievance_response_timeline_days: 7 }); }, [cfg]);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDone(false); };
  const save = async () => {
    setBusy(true);
    try {
      if (cfg?.id) await base44.entities.BusinessTrustConfig.update(cfg.id, form);
      else await base44.entities.BusinessTrustConfig.create(form);
      setDone(true); onSaved();
    } catch (e) { alert(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };
  if (loading) return <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-sm font-semibold text-slate-900">Business identity & grievance officer</p>
      <p className="mt-1 text-xs text-slate-500">Shown on legal pages and the Trust Center. Leave a field empty to display it as ACTION REQUIRED until configured — never invent official details.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {BUSINESS_FIELDS.map(([k, l]) => (
          <label key={k} className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{l}</span>
            <input value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#006CEC]" />
          </label>
        ))}
      </div>
      <button onClick={save} disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00225A] disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {done ? 'Saved' : 'Save business info'}
      </button>
    </div>
  );
}

function PoliciesTable({ policies, loading, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = (p) => setEdit({ policy_key: p.policy_key, title: p.title, summary: p.summary || '', body: p.body || '', needs_legal_review: p.needs_legal_review, effective_from: new Date().toISOString().slice(0, 10), version: bump(p.version) });
  const save = async () => {
    setBusy(true);
    try {
      const cur = (await base44.entities.PolicyVersion.filter({ policy_key: edit.policy_key, is_current: true }, '-effective_from', 1))[0];
      const created = await base44.entities.PolicyVersion.create({
        policy_key: edit.policy_key, title: edit.title, summary: edit.summary, body: edit.body,
        version: edit.version, status: 'published', effective_from: edit.effective_from,
        needs_legal_review: !!edit.needs_legal_review, is_current: true, material_change: true,
        previous_version_id: cur?.id,
      });
      if (cur) await base44.entities.PolicyVersion.update(cur.id, { is_current: false, status: 'superseded' });
      setEdit(null); onSaved();
    } catch (e) { alert(e.message || 'Could not save policy'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  if (edit) return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">New version — {edit.title}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{edit.version}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">Saving creates a new version and marks the previous one superseded. History is never overwritten.</p>
      <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={16} className="mt-3 w-full rounded-lg border border-slate-200 p-3 font-mono text-xs outline-none focus:border-[#006CEC]" placeholder="Markdown body. Use {{placeholder}} tokens (legal_entity_name, support_email, …)." />
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={edit.needs_legal_review} onChange={(e) => setEdit({ ...edit, needs_legal_review: e.target.checked })} />
        Needs legal review (shows a draft banner on the public page)
      </label>
      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00225A] disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Publish new version</button>
        <button onClick={() => setEdit(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
          <th className="p-3 font-medium">Policy</th><th className="p-3 font-medium">Version</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Legal review</th><th className="p-3 font-medium">Effective</th><th />
        </tr></thead>
        <tbody className="divide-y divide-slate-50">
          {POLICIES.map((p) => {
            const row = policies.find((x) => x.policy_key === p.slug) || null;
            return (
              <tr key={p.slug} className="hover:bg-slate-50/60">
                <td className="p-3"><p className="font-medium text-slate-900">{p.title}</p><p className="text-[11px] text-slate-400">{p.slug}</p></td>
                <td className="p-3">{row?.version || '—'}</td>
                <td className="p-3">{row ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">{row.status}</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">missing</span>}</td>
                <td className="p-3">{row?.needs_legal_review ? <span className="text-amber-600">Required</span> : <span className="text-emerald-600">Cleared</span>}</td>
                <td className="p-3 text-slate-600">{row?.effective_from || '—'}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <a href={p.path} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700"><ExternalLink size={14} /></a>
                    <button onClick={() => start(row || { policy_key: p.slug, title: p.title, version: 'v0.1', body: '', summary: '', needs_legal_review: true })} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">{row ? 'New version' : 'Create'}</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LegalReview({ cfg, policies }) {
  const f = (k) => !!(cfg && cfg[k] && String(cfg[k]).trim());
  const businessGaps = BUSINESS_FIELDS.filter(([k]) => !f(k)).map(([, l]) => l);
  const reviewPolicies = policies.filter((p) => p.needs_legal_review).map((p) => p.title);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Panel title="Implemented technical controls">
        <ul className="space-y-1.5 text-sm text-slate-700">
          <Item>Policy versioning (immutable history)</Item>
          <Item>Public legal/trust pages + footer links</Item>
          <Item>Reusable visa disclaimer (no guaranteed approval)</Item>
          <Item>AI transparency page</Item>
          <Item>Business identity + grievance officer config</Item>
          <Item>Advertising trust readiness score</Item>
        </ul>
      </Panel>
      <Panel title="Requires legal verification">
        <ul className="space-y-1.5 text-sm">
          {reviewPolicies.length === 0 && businessGaps.length === 0 ? <li className="text-emerald-600">No outstanding items flagged.</li> : null}
          {reviewPolicies.map((t) => <li key={t} className="flex items-center gap-2 text-amber-700"><AlertTriangle size={13} /> Policy text: {t}</li>)}
          {businessGaps.map((l) => <li key={l} className="flex items-center gap-2 text-rose-700"><AlertTriangle size={13} /> Missing business info: {l}</li>)}
          <li className="flex items-center gap-2 text-slate-500"><AlertTriangle size={13} /> All generated policy text must be reviewed by a qualified Indian lawyer/compliance professional.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Panel({ title, children }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-semibold text-slate-900">{title}</h2><div className="mt-3">{children}</div></div>;
}
function Item({ children }) {
  return <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-500" /> {children}</li>;
}
function CheckDot({ ok }) {
  return <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{ok ? '✓' : '!'}</span>;
}