import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Globe, Loader2, ShieldCheck, AlertTriangle, FileText, Clock, ArrowRight } from 'lucide-react';
import { getDestinationDetail } from '@/lib/visaApi';
import VisaOptionCard from '@/components/visa/discovery/VisaOptionCard';

export default function DestinationDetail() {
  const { code } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDestinationDetail(code)
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!data?.country) return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Destination not found</h1>
      <Link to="/destinations" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-orange-700"><ArrowLeft size={16} /> Back to destinations</Link>
    </div>
  );

  const { country, visa_types, sample_option, requirements, _provenance } = data;
  const unverified = _provenance?.source === 'dev_seed' || !_provenance?.verified;

  return (
    <div>
      <section className="relative overflow-hidden bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
          <Link to="/destinations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white"><ArrowLeft size={16} /> All destinations</Link>
          <div className="flex items-center gap-4">
            <span className="text-5xl">{country.flag_emoji}</span>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{country.name}</h1>
              <p className="mt-1 text-sm text-white/70">{country.official_name || country.region}{country.is_schengen ? ' · Schengen' : ''}</p>
            </div>
          </div>
          {unverified && (
            <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-200">
              <AlertTriangle size={12} /> Requirements not yet independently verified
            </p>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-10 px-5 py-10 sm:px-8">
        {/* Visa requirement summary */}
        <section>
          <h2 className="text-xl font-semibold text-slate-950">Visa requirement summary</h2>
          <p className="mt-1 text-sm text-slate-500">
            {sample_option
              ? `Most travelers need a ${sample_option.name}. ${sample_option.appointment_required ? 'An appointment is required.' : 'Apply online.'}`
              : 'Check the discovery tool for your specific nationality.'}
          </p>
          <Link to="/apply" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">
            Check my eligibility <ArrowRight size={15} />
          </Link>
        </section>

        {/* Available visa options */}
        {sample_option && (
          <section>
            <h2 className="mb-4 text-xl font-semibold text-slate-950">Sample visa option</h2>
            <div className="max-w-xl"><VisaOptionCard option={sample_option} onStart={() => { window.location.href = '/apply'; }} /></div>
          </section>
        )}

        {/* Requirements */}
        {requirements?.requirements?.length > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-950"><FileText size={18} /> Requirements</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {requirements.requirements.map((r, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3">
                  <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${r.mandatory_level === 'mandatory' ? 'bg-rose-500' : r.mandatory_level === 'conditional' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{r.title}</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{r.category} · {r.mandatory_level}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Processing + fees snapshot */}
        {sample_option && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Snapshot icon={Clock} title="Processing" value={sample_option.processing?.standard_min && sample_option.processing?.standard_max ? `${sample_option.processing.standard_min}–${sample_option.processing.standard_max} days` : '—'} />
            <Snapshot icon={FileText} title="Max stay" value={sample_option.max_stay_days ? `Up to ${sample_option.max_stay_days} days` : '—'} />
            <Snapshot icon={Globe} title="Application" value={sample_option.application_method || sample_option.channel || '—'} />
          </section>
        )}

        {/* Provenance */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ShieldCheck size={16} /> Source & verification</h2>
          <p className="mt-2 text-sm text-slate-500">
            {requirements?.version?.last_verified_at
              ? `Last verified ${new Date(requirements.version.last_verified_at).toLocaleDateString()}.`
              : 'This route has not been verified yet.'}{' '}
            Requirements version: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{requirements?.version?.requirements_version || '—'}</code>
          </p>
        </section>
      </div>
    </div>
  );
}

function Snapshot({ icon: Icon, title, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400"><Icon size={12} /> {title}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}