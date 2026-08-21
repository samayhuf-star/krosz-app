import { Clock, CalendarDays, DollarSign, ArrowRight, ShieldCheck, AlertTriangle, FileText } from 'lucide-react';

const CATEGORY_LABEL = {
  evisa: 'e-Visa',
  visa_on_arrival: 'Visa on Arrival',
  eta: 'ETA',
  embassy_visa: 'Embassy Visa',
  sticker_visa: 'Sticker Visa',
  visa_free: 'Visa-Free',
  transit: 'Transit',
  other: 'Visa',
};

function formatMinor(amount, currency) {
  if (amount == null) return null;
  const n = Number(amount) / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${(n).toFixed(2)}`;
  }
}

export default function VisaOptionCard({ option, onStart, routeReady = false }) {
  const fees = option.fees;
  const stay = option.max_stay_days ? `Up to ${option.max_stay_days} days` : '—';
  const entries = option.entries === -1 ? 'Multiple' : option.entries === 0 ? 'Visa-free' : option.entries ? `${option.entries} entry${option.entries > 1 ? 's' : ''}` : '—';
  const proc = option.processing?.standard_min != null && option.processing?.standard_max != null
    ? `${option.processing.standard_min}–${option.processing.standard_max} days`
    : option.processing?.standard_min != null ? `${option.processing.standard_min}+ days` : '—';
  const unverified = !routeReady && (option.source === 'dev_seed' || !option.verified_at);
  // Starting an application should be blocked by an unverified regulatory route,
  // not by missing pricing. Fees can be resolved before payment without forcing
  // the traveler back to the discovery screen.
  const unavailable = unverified;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
              {CATEGORY_LABEL[option.category] || option.category || 'Visa'}
            </span>
            {option.appointment_required && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                <CalendarDays size={12} /> Appointment
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold tracking-tight text-slate-950">{option.name}</h3>
          {option.authority && <p className="mt-0.5 text-xs text-slate-500">{option.authority}</p>}
        </div>
        {unverified && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
            <AlertTriangle size={12} /> Being verified
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat icon={Clock} label="Processing" value={proc} />
        <Stat icon={CalendarDays} label="Max stay" value={stay} />
        <Stat icon={FileText} label="Entries" value={entries} />
      </div>

      {fees ? (
        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Government fee</span>
            <span className="font-medium text-slate-800">{fees.government_minor != null ? formatMinor(fees.government_minor, fees.currency) : '—'}</span>
          </div>
          {fees.service_minor > 0 && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-slate-500">Krosz fee</span>
              <span className="font-medium text-slate-800">{formatMinor(fees.service_minor, fees.currency)}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><DollarSign size={14} /> Estimated total</span>
            <span className="text-base font-bold text-orange-700">{formatMinor(fees.total_minor, fees.currency)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-xs text-slate-500">Pricing will be confirmed before any payment is requested.</p>
      )}

      <div className="mt-5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          {option.verified_at ? <><ShieldCheck size={12} className="text-orange-600" /> Verified {new Date(option.verified_at).toLocaleDateString()}</> : 'Requirements are being verified'}
        </span>
        <button
          onClick={() => !unavailable && onStart(option)}
          disabled={unavailable}
          aria-disabled={unavailable}
          title={unavailable ? 'Available after the route requirements are verified' : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {unavailable ? 'Not available yet' : 'Start application'} {!unavailable && <ArrowRight size={15} />}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400"><Icon size={12} /> {label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}