import { CheckCircle2, AlertTriangle, Info, Loader2, XCircle } from 'lucide-react';
import VisaOptionCard from './VisaOptionCard';

const OUTCOME_META = {
  eligible: { icon: CheckCircle2, tone: 'emerald', title: "You're eligible", desc: "We found visa options for your trip. Pick one to start your application." },
  possibly_eligible: { icon: Info, tone: 'amber', title: 'Likely eligible — final verification in progress', desc: 'Live visa intelligence found a likely route. We still verify material requirements before you rely on them.' },
  requires_review: { icon: AlertTriangle, tone: 'blue', title: 'Needs review', desc: 'Some details need a closer look. Start an application and we will confirm eligibility.' },
  not_eligible: { icon: XCircle, tone: 'rose', title: 'No visa route found', desc: 'No route found for this combination. Try another destination or purpose.' },
};

const TONE_BG = { emerald: 'bg-orange-50 border-orange-200', amber: 'bg-amber-50 border-amber-200', blue: 'bg-blue-50 border-blue-200', rose: 'bg-rose-50 border-rose-200' };
const TONE_TEXT = { emerald: 'text-orange-600', amber: 'text-amber-600', blue: 'text-blue-600', rose: 'text-rose-600' };
const TONE_SUB = { emerald: 'text-orange-800', amber: 'text-amber-800', blue: 'text-blue-800', rose: 'text-rose-800' };

export default function DiscoveryResults({ result, onStart, starting }) {
  if (!result) return null;
  const routeVerified = result.ready_for_public === true || result.provenance?.verified === true;
  const meta = routeVerified
    ? OUTCOME_META.eligible
    : { icon: AlertTriangle, tone: 'blue', title: 'Route verification in progress', desc: 'We found a possible route, but we will not present it as confirmed until the material requirements are verified.' };
  const Icon = meta.icon;
  const tone = meta.tone;

  return (
    <div className="space-y-5">
      <div className={`rounded-2xl border p-5 ${TONE_BG[tone]}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-6 w-6 ${TONE_TEXT[tone]}`} />
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{meta.title}</h2>
            <p className={`mt-0.5 text-sm ${TONE_SUB[tone]}`}>{meta.desc}</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          {routeVerified
            ? `Information verified${(result.source?.verified_at || result.provenance?.verified_at) ? ' ' + new Date(result.source?.verified_at || result.provenance?.verified_at).toLocaleDateString() : '.'}`
            : 'We’ll show the confirmed requirements and fees as soon as this route passes verification.'}
        </p>
      </div>

      {result.destination && (
        <div className="flex items-center gap-3">
          <span className="text-3xl">{result.destination.flag_emoji}</span>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Destination</p>
            <p className="text-lg font-semibold text-slate-950">{result.destination.name}</p>
          </div>
          <div className="ml-auto text-right text-sm text-slate-500">
            <p>{result.nationality?.name || result.input.nationality} passport</p>
            <p className="capitalize">{result.purpose?.label || result.input.purpose}</p>
          </div>
        </div>
      )}

      {result.options?.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.options.map((opt) => (
            <VisaOptionCard key={opt.id} option={opt} onStart={onStart} routeReady={routeVerified} />
          ))}
        </div>
      ) : (
        !starting && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No visa options available for this combination yet.</p>
      )}

      {starting && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Starting your application…
        </div>
      )}
    </div>
  );
}