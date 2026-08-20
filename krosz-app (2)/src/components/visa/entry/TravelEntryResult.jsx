// Worldz Visa (Phase 22) — normalized TravelEntryResult card.
// ONE journey-agnostic UI: it does not care whether the result came from
// Pipeworx, a government source, or internal research. Rendered on the
// destination page (and reusable on home/search result cards).

import { ShieldCheck, AlertTriangle, ExternalLink, Clock, FileText, Wallet, ListChecks, Sparkles, ArrowRight, MapPin } from 'lucide-react';

const JOURNEY = {
  VISA_FREE: { label: 'Visa-free', tone: 'emerald' },
  VISA_ON_ARRIVAL: { label: 'Visa on Arrival', tone: 'amber' },
  ETA: { label: 'ETA', tone: 'blue' },
  EVISA: { label: 'eVisa', tone: 'blue' },
  OTHER_LOW_FRICTION: { label: 'Low-friction entry', tone: 'emerald' },
  EMBASSY_VISA: { label: 'Embassy visa', tone: 'rose' },
  CONSULAR_VISA: { label: 'Consular visa', tone: 'rose' },
  TRANSIT_VISA: { label: 'Transit visa', tone: 'slate' },
  WORK_VISA: { label: 'Work visa', tone: 'rose' },
  STUDENT_VISA: { label: 'Student visa', tone: 'rose' },
  OTHER: { label: 'Other', tone: 'slate' },
};
const TONE = {
  emerald: 'bg-orange-50 text-orange-700 border-orange-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};
const FRESH = {
  FRESH: { label: 'Fresh', cls: 'text-orange-600' },
  STALE: { label: 'Stale', cls: 'text-amber-600' },
  REQUIRES_REVIEW: { label: 'Needs review', cls: 'text-blue-600' },
  EXPIRED: { label: 'Expired', cls: 'text-rose-600' },
};

function fmtMinor(amount, currency) {
  if (amount == null) return null;
  const n = Number(amount) / 100;
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency || ''} ${n.toFixed(2)}`; }
}

export default function TravelEntryResult({ entry, country, onStart, compact = false }) {
  if (!entry) return null;
  const j = entry.journey_type ? JOURNEY[entry.journey_type] : null;
  const jt = j?.tone || 'slate';
  const fresh = entry.ready_for_public === true
    ? (FRESH[entry.freshness] || FRESH.REQUIRES_REVIEW)
    : { label: 'Verification in progress', cls: 'text-amber-600' };
  const checklist = (entry.checklist || []).filter((i) => i.applicable);
  const conditions = (entry.conditions || []).filter((c) => !/maximum stay|stay up to|up to \d+ days/i.test(c?.label || ''));
  const cap = entry.application?.capability || {};
  const portal = entry.application?.official_portal;
  const governmentMinor = Number(entry.fees?.government_minor);
  const serviceMinor = Number(entry.fees?.service_minor);
  const totalMinor = Number(entry.fees?.total_minor);
  const feeGov = Number.isFinite(governmentMinor) && governmentMinor > 0 ? fmtMinor(governmentMinor, entry.fees?.currency) : null;
  const feeService = Number.isFinite(serviceMinor) && serviceMinor > 0 ? fmtMinor(serviceMinor, entry.fees?.currency) : null;
  const feeTot = Number.isFinite(totalMinor) && totalMinor > 0 ? fmtMinor(totalMinor, entry.fees?.currency) : null;

  return (
    <div className={`rounded-3xl border ${TONE[jt]} p-4 shadow-sm sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-3xl" aria-hidden>{country?.flag_emoji}</span>
          <div>
            <div className="flex items-center gap-2">
              {j && <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[jt]}`}>{j.label}</span>}
              <span className={`flex items-center gap-1 text-xs font-medium ${fresh.cls}`}><ShieldCheck size={12} /> {fresh.label}</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{country?.name}{entry.max_stay_days ? ` · up to ${entry.max_stay_days} days` : ''}</h2>
          </div>
        </div>
        {!entry.ready_for_public && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-500"><AlertTriangle size={12} className="text-amber-500" /> Verification in progress</span>
        )}
      </div>

      {entry.outcome === 'no_configuration' ? (
        <p className="mt-3 text-sm text-slate-600">This destination is still being researched for Indian passport holders. You can still explore visa options below — we'll verify details before any application is submitted.</p>
      ) : (
        <p className="mt-2 text-sm text-slate-700">
          {entry.visa_required
            ? `Indian passport holders need ${j?.label || 'a visa'} to enter ${country?.name || 'this destination'}.`
            : `Good news — Indian passport holders can travel ${j?.label === 'Visa-free' ? 'visa-free' : 'without a visa'} for up to ${entry.max_stay_days || '—'} days.`}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {entry.max_stay_days != null && <Stat icon={Clock} label="Max stay" value={`${entry.max_stay_days} days`} />}
        {entry.entries != null && <Stat icon={MapPin} label="Entries" value={entry.entries === -1 ? 'Multiple' : entry.entries === 0 ? 'Visa-free' : entry.entries} />}
        {feeGov && <Stat icon={Wallet} label="Govt fee" value={feeGov} />}
        {feeService && <Stat icon={Wallet} label="Krosz fee" value={feeService} />}
        {feeTot && <Stat icon={Wallet} label="Estimated total" value={feeTot} />}
        {entry.application?.automation && <Stat icon={Sparkles} label="Application support" value={entry.application.automation === 'FULLY_AUTOMATED' ? 'Digital' : 'Guided'} />}
      </div>

      {!compact && conditions.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Entry conditions</p>
          <ul className="space-y-1">
            {conditions.map((c) => (
              <li key={c.code} className="flex items-start gap-2 text-sm text-slate-700">
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${c.required ? 'bg-orange-500' : 'bg-slate-300'}`} />
                {c.label}{c.required ? '' : ' (recommended)'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && checklist.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ListChecks size={13} /> Travel checklist</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {checklist.map((i) => (
              <div key={i.code} className="flex items-start gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-sm text-slate-700">
                <FileText size={14} className="mt-0.5 text-orange-600" />
                <div>
                  <p className="font-medium text-slate-800">{i.label}</p>
                  {i.reason && <p className="text-[11px] text-amber-600">{i.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && entry.visa_required && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">We can:</span>
          {[['prepare', 'Prepare'], ['prefill', 'Prefill'], ['pay', 'Pay'], ['submit', 'Submit'], ['track', 'Track']].map(([k, label]) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${cap[k] === 'YES' ? 'border-orange-200 bg-orange-50 text-orange-700' : cap[k] === 'PROVIDER' ? 'border-blue-200 bg-blue-50 text-blue-700' : cap[k] === 'MANUAL' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
              {label}{cap[k] && cap[k] !== 'NO' ? `: ${cap[k]}` : ''}
            </span>
          ))}
        </div>
      )}

      {!compact && portal && (
        <a href={portal} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-orange-700 hover:text-orange-800">
          Official portal <ExternalLink size={13} />
        </a>
      )}

      {onStart && entry.ready_for_public === true && (
        <div className="mt-5">
          <button onClick={onStart} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
            {entry.visa_required ? 'Start application' : 'Add trip & view checklist'} <ArrowRight size={15} />
          </button>
        </div>
      )}

      {entry.source?.name && (
        <p className="mt-4 border-t border-white/40 pt-2 text-[11px] text-slate-500">
          Source: {entry.source.name}{entry.source.verified_at ? ` · verified ${new Date(entry.source.verified_at).toLocaleDateString()}` : ''}{entry.rule_version ? ` · rule v${entry.rule_version}` : ''}
        </p>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-white/70 p-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"><Icon size={11} /> {label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}