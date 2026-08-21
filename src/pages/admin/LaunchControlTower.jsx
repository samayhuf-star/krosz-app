import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { controlTower, launchControlGet, launchControlSet } from '@/lib/launchControlApi';
import PageHeader from '@/components/app/PageHeader';
import { RefreshCw, Loader2, ShieldAlert, ShieldCheck, ShieldX, Pause, Play, Save } from 'lucide-react';

const COUNTRIES = [
  { code: 'AE', name: 'UAE' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'ID', name: 'Indonesia' },
];
const STATUS_META = {
  GO: { tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: ShieldCheck, label: 'GO' },
  CAUTION: { tone: 'bg-amber-50 text-amber-700 border-amber-200', Icon: ShieldAlert, label: 'CAUTION' },
  STOP: { tone: 'bg-rose-50 text-rose-700 border-rose-200', Icon: ShieldX, label: 'STOP' },
};

export default function LaunchControlTower() {
  const { user } = useAuth();
  const [tower, setTower] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = async () => {
    setBusy(true); setErr(''); setToast('');
    try {
      const [t, c] = await Promise.all([controlTower(), launchControlGet()]);
      setTower(t); setCfg(c?.config || null);
    } catch (e) { setErr(e?.message || 'Failed to load control tower'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (user?.role === 'admin') load(); }, [user]);

  if (user?.role !== 'admin') return <div className="px-6 py-12 text-sm text-slate-500">Admin access required.</div>;

  const overall = tower?.overall || { status: 'GO', p0_count: 0, p1_count: 0 };
  const meta = STATUS_META[overall.status] || STATUS_META.GO;
  const m = tower?.metrics || {};
  const setCountryField = (cc, patch) => setCfg((c) => ({ ...c, countries: { ...(c?.countries || {}), [cc]: { ...(c?.countries?.[cc] || { pilot: 'INTERNAL', paused: false, max_paid_per_day: 0 }), ...patch } } }));
  const save = async () => { setBusy(true); setErr(''); setToast(''); try { const r = await launchControlSet(cfg); setCfg(r?.config || cfg); setToast('Launch controls updated.'); await load(); } catch (e) { setErr(e?.message || 'Save failed'); } finally { setBusy(false); } };

  return (
    <div>
      <PageHeader eyebrow="Phase 5 · MVP" title="Launch Control Tower" description="Deterministic launch readiness for UAE, Vietnam and Indonesia. No AI — all metrics computed from existing application, payment, review, support, refund and rule data."
        action={<button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</button>} />

      <div className="px-5 py-6 sm:px-8 lg:px-10 space-y-6">
        {err && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
        {toast && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{toast}</p>}

        {/* Executive view */}
        <div className={`flex items-center justify-between rounded-2xl border p-5 ${meta.tone}`}>
          <div className="flex items-center gap-3"><meta.Icon size={28} /><div><p className="text-sm font-medium uppercase tracking-wide opacity-70">Overall launch status</p><p className="text-3xl font-bold">{meta.label}</p></div></div>
          <div className="hidden gap-6 sm:flex"><p className="text-center"><span className="block text-2xl font-bold">{overall.p0_count}</span><span className="text-xs opacity-70">P0 issues</span></p><p className="text-center"><span className="block text-2xl font-bold">{overall.p1_count}</span><span className="text-xs opacity-70">P1 issues</span></p></div>
        </div>

        {/* Country cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COUNTRIES.map(({ code, name }) => {
            const c = tower?.countries?.[code] || {};
            const cm = STATUS_META[c.final_status] || STATUS_META.GO;
            return (
              <div key={code} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-slate-950">{name}</p><p className="text-[11px] text-slate-400">{code}</p></div><span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${cm.tone}`}><cm.Icon size={13} /> {cm.label}</span></div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                  <Row label="Application flow" value={c.application_flow} />
                  <Row label="Pricing" value={c.pricing} />
                  <Row label="Payment" value={c.payment} />
                  <Row label="Post-payment" value={c.post_payment} />
                  <Row label="Human review" value={c.human_review} />
                  <Row label="Submission" value={c.submission} />
                  <Row label="Support" value={c.support} />
                  <Row label="Rule freshness" value={c.rule_freshness} />
                </dl>
                <p className="mt-2 text-[11px] text-slate-400">Last verified {fmt(c.rule_freshness_detail?.last_verified)} · Next review {fmt(c.rule_freshness_detail?.next_review)}</p>
              </div>
            );
          })}
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Paid apps stuck" value={m.paid_stuck} danger={m.paid_stuck > 0} />
          <Metric label="Human reviews pending" value={m.human_reviews_pending} />
          <Metric label="Submission failures" value={m.submission_failures} />
          <Metric label="Payment problems" value={m.payment_problems} danger={m.payment_problems > 0} />
          <Metric label="Support backlog" value={m.support_backlog} />
          <Metric label="Refund failures" value={m.refund_failures} />
          <Metric label="Refund overdue" value={m.refund_overdue} />
          <Metric label="Provider failures" value={m.provider_failures} />
          <Metric label="Rule issues" value={m.rule_issues} danger={m.rule_issues > 0} />
        </div>

        {/* Today's required actions */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Today's required actions</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{(tower?.actions_today || ['Loading…']).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>

        {/* Pilot & pause controls */}
        {cfg && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Pilot mode & pause controls</h2>
              <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#003580] px-3 py-2 text-sm font-semibold text-white hover:bg-[#00225A] disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save controls</button>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cfg.global_paused} onChange={(e) => setCfg({ ...cfg, global_paused: e.target.checked })} /> <span className="font-medium text-slate-800">Pause all new applications (global)</span></label>
              <span className="text-[11px] text-slate-400">— existing applications keep running.</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr>{['Country', 'Pilot', 'Pause new', 'Reason', 'Max paid / day', 'Paid today', ''].map((h) => <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {COUNTRIES.map(({ code, name }) => {
                    const row = cfg.countries?.[code] || { pilot: 'INTERNAL', paused: false, max_paid_per_day: 0 };
                    const towerRow = tower?.countries?.[code];
                    return (
                      <tr key={code}>
                        <td className="px-3 py-2 font-medium text-slate-800">{name}</td>
                        <td className="px-3 py-2"><select value={row.pilot || 'INTERNAL'} onChange={(e) => setCountryField(code, { pilot: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1 text-sm"><option value="INTERNAL">INTERNAL</option><option value="LIMITED">LIMITED</option><option value="OPEN">OPEN</option><option value="PAUSED">PAUSED</option></select></td>
                        <td className="px-3 py-2"><button onClick={() => setCountryField(code, { paused: !row.paused })} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${row.paused ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{row.paused ? <><Pause size={11} /> Paused</> : <><Play size={11} /> Active</>}</button></td>
                        <td className="px-3 py-2"><input value={row.pause_reason || ''} onChange={(e) => setCountryField(code, { pause_reason: e.target.value })} placeholder={row.paused ? 'Why paused' : '—'} className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" /></td>
                        <td className="px-3 py-2"><input type="number" min={0} value={row.max_paid_per_day || 0} onChange={(e) => setCountryField(code, { max_paid_per_day: Number(e.target.value) })} className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm" /></td>
                        <td className="px-3 py-2 text-slate-600">{towerRow?.paid_today ?? '—'}</td>
                        <td className="px-3 py-2 text-[11px] text-slate-400">{row.paused_at ? `at ${fmt(row.paused_at)}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Pausing blocks new starts only — existing customer applications are never interrupted. Changes are recorded with the admin id and timestamp.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  const danger = !!value && value !== 'OK';
  return <div className="flex items-center justify-between gap-2 px-1 py-0.5"><dt className="text-[11px] text-slate-400">{label}</dt><dd className={`text-[11px] font-medium ${danger ? 'text-rose-700' : 'text-slate-700'}`}>{String(value ?? '—')}</dd></div>;
}
function Metric({ label, value, danger }) {
  return <div className={`rounded-xl border p-2.5 ${danger ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700'}`}><p className="text-[10px] font-medium opacity-80">{label}</p><p className="text-lg font-bold">{value ?? 0}</p></div>;
}
function fmt(s) { return s ? new Date(s).toLocaleDateString('en-IN') : '—'; }