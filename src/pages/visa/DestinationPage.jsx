import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle,
  Loader2, ArrowRight, ChevronRight, Sparkles, HelpCircle,
} from 'lucide-react';
import DiscoveryHeader from '@/components/visa/discovery/DiscoveryHeader';
import VisaOptionCard from '@/components/visa/discovery/VisaOptionCard';
import RelatedDestinations from '@/components/visa/discovery/RelatedDestinations';
import FaqAccordion from '@/components/visa/discovery/FaqAccordion';
import SaveDestinationButton from '@/components/visa/discovery/SaveDestinationButton';
import VisaDeepDive from '@/components/visa/discovery/VisaDeepDive';
import CountryTravelHub from '@/components/visa/CountryTravelHub';
import {
  publishDestinationPage, listNationalities, listTravelPurposes, accountListTravelers, getTravelEntry,
} from '@/lib/visaApi';
import { applicationCaseCreate } from '@/lib/applicationCaseApi';
import TravelEntryResult from '@/components/visa/entry/TravelEntryResult';
import { useSeo, useJsonLd } from '@/lib/seo';
import { trackDiscovery, setDiscoveryIntent, getDiscoveryIntent, pushRecentlyViewed } from '@/lib/discoveryIntent';
import { useAuth } from '@/lib/AuthContext';

const PURPOSE_SLUG = { tourist: 'tourism', business: 'business', student: 'study', transit: 'transit' };
const NAT_SLUG = { 'indian-citizens': 'IN', 'british-citizens': 'GB', 'us-citizens': 'US', 'emirati-citizens': 'AE' };

// Guessed/short destination slugs → canonical DestinationContent slug. Prevents
// a generic 404 when someone lands on /visa/uae or /visa/dubai by redirecting to
// the canonical /visa/united-arab-emirates (item 9 of launch-readiness report).
const SLUG_ALIASES = {
  uae: 'united-arab-emirates', emirates: 'united-arab-emirates', dubai: 'united-arab-emirates',
  'united-arab-emirate': 'united-arab-emirates', 'united-arab-emirats': 'united-arab-emirates',
  vietnam: 'vietnam', 'viet-nam': 'vietnam', viet: 'vietnam', vn: 'vietnam',
  indonesia: 'indonesia', bali: 'indonesia', id: 'indonesia',
};

function fmtMinor(amount, currency) {
  if (amount == null) return '—';
  const n = Number(amount) / 100;
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

export default function DestinationPage() {
  const { slug, seg } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // Resolve purpose/nationality from seg segment or query params (defaults IN/tourism).
  const initialPurpose = (seg && PURPOSE_SLUG[seg]) || params.get('purpose') || 'tourism';
  const initialNationality = 'IN';

  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [purpose, setPurpose] = useState(initialPurpose);
  const [nationality, setNationality] = useState(initialNationality);
  const [nationalities, setNationalities] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const { isAuthenticated: authed, authChecked } = useAuth();
  const [primary, setPrimary] = useState(null);
  const [starting, setStarting] = useState(false);
  const [compare, setCompare] = useState(false);
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    if (!authChecked || !authed) {
      setPrimary(null);
      return;
    }
    accountListTravelers()
      .then((r) => setPrimary((r.travelers || []).find((t) => t.is_primary && t.status !== 'ARCHIVED') || (r.travelers || [])[0] || null))
      .catch(() => setPrimary(null));
  }, [authChecked, authed]);

  useEffect(() => {
    listNationalities().then((r) => setNationalities(r.nationalities || [])).catch(() => {});
    listTravelPurposes().then((r) => setPurposes(r.purposes || [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true); setError('');
    publishDestinationPage(slug, { nationality, purpose }).then((p) => {
      setPage(p);
      setLoading(false);
      if (p?.country) {
        trackDiscovery('DESTINATION_VIEWED', { destination: p.country.code, nationality, purpose });
        pushRecentlyViewed(p.country.code, p.country.name);
        // Phase 22: resolve the normalized Travel Entry result (one engine).
        getTravelEntry({ destination: p.country.code, nationality, purpose }).then((r) => setEntry(r.entry || null)).catch(() => setEntry(null));
      }
    }).catch((e) => { setError(e?.message || 'Failed to load'); setLoading(false); });
  };

  useEffect(load, [slug, nationality, purpose]);

  // SEO + structured data (§18/§19). noindex when not indexable.
  const seo = page?.seo || null;
  useSeo(seo ? { ...seo, robots: page.indexable ? 'index,follow' : 'noindex,follow' } : { title: 'Visa — Krosz', robots: 'noindex,follow' });
  useJsonLd('ld-breadcrumb', page?.country ? {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: window.location.origin + '/' },
      { '@type': 'ListItem', position: 2, name: `${page.country.name} Visa`, item: window.location.href },
    ],
  } : null);
  useJsonLd('ld-faq', page?.content?.faq?.length ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: page.content.faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  } : null);
  useJsonLd('ld-travel-guide', page?.country ? {
    '@context': 'https://schema.org', '@type': 'TravelAction',
    name: `${page.country.name} visa and travel guide for Indian travellers`,
    fromLocation: { '@type': 'Country', name: 'India' },
    toLocation: { '@type': 'Country', name: page.country.name },
    url: window.location.origin + (page.seo?.canonical_path || `/visa/${slug}`),
  } : null);

  const intent = getDiscoveryIntent();
  const pendingIntent = intent && intent.intent === 'start' && intent.slug === slug && authed;

  const startApplication = async (option) => {
    trackDiscovery('APPLICATION_STARTED', { destination: page.country.code, nationality, purpose, visa_option: option?.visa_type_key });
    if (!authed) {
      setDiscoveryIntent({ destination: page.country.code, destinationName: page.country.name, nationality, purpose, slug, visa_type_key: option?.visa_type_key, intent: 'start' });
      navigate(`/login?returnTo=${encodeURIComponent(`/visa/${slug}`)}`);
      return;
    }
    setStarting(true);
    try {
      const res = await applicationCaseCreate({ nationality, destination: page.country.code, purpose, visa_type_key: option?.visa_type_key, traveler_id: primary?.id, idempotency_key: `autopilot_${primary?.id || 'self'}_${page.country.code}_${purpose}_${new Date().toISOString().slice(0,10)}` });
      trackDiscovery('APPLICATION_CREATED', { destination: page.country.code });
      const id = res?.case?.id;
      if (id) navigate(`/wizard/${id}`);
    } catch (e) { setError(e?.message || 'Could not start application'); }
    finally { setStarting(false); }
  };

  if (loading) return <div className="min-h-screen bg-[#fcfbf9]"><DiscoveryHeader /><div className="mx-auto max-w-4xl px-5 py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div></div>;
  if (page?.not_found || !page?.country) {
    const canonical = SLUG_ALIASES[String(slug || '').toLowerCase()];
    if (canonical && canonical !== slug) return <SlugRedirect to={`/visa/${canonical}${seg ? `/${seg}` : ''}`} />;
    return <NotFound slug={slug} />;
  }
  if (error && !page) return <div className="min-h-screen bg-[#fcfbf9]"><DiscoveryHeader /><div className="mx-auto max-w-4xl px-5 py-20 text-center text-rose-600">{error}</div></div>;

  const c = page.country;
  const options = page.options || [];
  const primaryOption = options[0] || null;
  const canStart = entry ? (entry.ready_for_public === true && (entry.options?.length || 0) <= 1) : Boolean(options.length === 1 && primaryOption?.verified_at && primaryOption?.source !== 'dev_seed');

  return (
    <div className="min-h-screen bg-[#fcfbf9]">
      <DiscoveryHeader />
      <nav aria-label="Breadcrumb" className="mx-auto flex max-w-6xl items-center gap-1.5 px-5 pt-5 text-xs text-slate-400">
        <Link to="/" className="hover:text-slate-700">Home</Link><ChevronRight size={12} />
        <span className="text-slate-600">{c.name} Visa</span>
      </nav>

      {pendingIntent && (
        <div className="mx-auto mt-3 max-w-5xl px-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <p className="text-sm text-orange-900"><Sparkles size={14} className="mr-1 inline" /> Continue your {c.name} application — you searched earlier and saved your selection.</p>
            <button onClick={() => startApplication(options[0])} disabled={starting} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight size={14} />} Continue</button>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-4 sm:px-5 sm:pt-6">
        <div className="flex flex-col gap-6 rounded-[32px] border border-slate-200/70 bg-white p-5 shadow-[0_20px_70px_-48px_rgba(15,23,42,.4)] sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:p-7">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="shrink-0 text-4xl sm:text-5xl" aria-hidden>{c.flag_emoji}</span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">{c.name} Visa</h1>
              <p className="text-sm text-slate-500">Visa options for {nationalities.find((n) => n.code === nationality)?.name || nationality + ' citizens'} · {purposes.find((p) => p.key === purpose)?.label || purpose}</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <SaveDestinationButton countryCode={c.code} slug={slug} />
            {canStart ? (
              <button onClick={() => startApplication(primaryOption)} disabled={starting} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 sm:flex-none">{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight size={15} />} Start application</button>
            ) : (
              <Link to={`/apply?destination=${c.code}&nationality=${nationality}&purpose=${purpose}`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 sm:flex-none">Check eligibility <ArrowRight size={15} /></Link>
            )}
          </div>
        </div>

        {/* Nationality / purpose switcher */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <div className="grid grid-cols-[84px_1fr] items-center gap-2 text-sm sm:flex"><span className="text-slate-500">Passport</span><span className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 font-medium text-slate-800">🇮🇳 Indian</span></div>
          <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-sm sm:flex"><span className="text-slate-500">Purpose</span>
            <select value={purpose} onChange={(e) => { setPurpose(e.target.value); const n = new URLSearchParams(params); n.set('purpose', e.target.value); setParams(n, { replace: true }); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {purposes.length ? purposes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>) : <option value="tourism">Tourism</option>}
            </select>
          </label>
        </div>
      </section>

      {/* Phase 22: normalized Travel Entry Result from the one engine */}
      {entry && (
        <section className="mx-auto mt-6 max-w-6xl px-4 sm:px-5">
          <TravelEntryResult entry={entry} country={c} onStart={() => startApplication(entry.options?.[0])} />
        </section>
      )}

      <VisaDeepDive page={page} entry={entry} country={c} />

      <CountryTravelHub country={c} entry={entry} />

      {/* Visa options (§11) + comparison (§12) */}
      {!entry && options.length > 0 && (
        <section className="mx-auto mt-10 max-w-6xl px-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Visa options</h2>
            {options.length > 1 && (
              <button onClick={() => setCompare((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{compare ? 'Show cards' : 'Compare'}</button>
            )}
          </div>
          {compare && options.length > 1 ? (
            <ComparisonTable options={options} onStart={startApplication} />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {options.map((o) => <VisaOptionCard key={o.id} option={o} onStart={startApplication} />)}
            </div>
          )}
        </section>
      )}

      {/* Eligibility CTA (§13) */}
      <section className="mx-auto mt-10 max-w-6xl px-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_50px_-40px_rgba(15,23,42,.35)]">
          <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-orange-600" /><div><p className="text-sm font-semibold text-slate-900">Not sure which visa you need?</p><p className="text-sm text-slate-500">Run a full eligibility check with your details.</p></div></div>
          <Link to={`/apply?destination=${c.code}&nationality=${nationality}&purpose=${purpose}`} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Check eligibility <ArrowRight size={15} /></Link>
        </div>
      </section>

      {/* Route requirements are rendered only from the normalized Travel Entry Engine above. */}
      {/* How it works (from content) */}
      {page.content?.how_it_works?.length > 0 && (
        <section className="mx-auto mt-10 max-w-6xl px-5">
          <h2 className="mb-4 text-xl font-semibold text-slate-900">How it works</h2>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {page.content.how_it_works.map((s, i) => (
              <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-xs font-semibold text-white">{i + 1}</span>
                <h3 className="mt-2 text-sm font-semibold text-slate-900">{/submit|track/i.test(s.title || '') ? 'Submit or track' : s.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{/submit|track|end to end/i.test(`${s.title || ''} ${s.description || ''}`) ? 'Submission support depends on the verified route shown for your application. You can always track confirmed progress in Krosz.' : s.description}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* FAQ (§9) */}
      {page.content?.faq?.length > 0 && (
        <section className="mx-auto mt-10 max-w-6xl px-5">
          <div className="mb-3 flex items-center gap-2"><HelpCircle className="h-4 w-4 text-slate-500" /><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">FAQs</h2></div>
          <FaqAccordion faq={page.content.faq} />
        </section>
      )}

      {/* Related destinations (§16) */}
      <section className="mx-auto mt-10 max-w-6xl px-5">
        <RelatedDestinations related={page.related} sourceName={c.name} />
      </section>

      {/* Final CTA */}
      <section className="mx-auto mt-12 max-w-5xl px-4 pb-28 sm:px-5 sm:pb-16">
        <div className="rounded-3xl bg-slate-950 px-5 py-8 text-center text-white shadow-sm sm:px-6 sm:py-10">
          <h2 className="text-xl font-semibold">{canStart ? `Apply for your ${c.name} visa` : `Check your ${c.name} visa eligibility`}</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-slate-300">{canStart ? 'Start with your passport. Krosz prepares the verified steps available for this route.' : 'Confirm your traveller details first. Krosz will only open an application route when the current visa option is ready.'}</p>
          {canStart ? (
            <button onClick={() => startApplication(primaryOption)} disabled={starting} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50">{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight size={16} />} Start application</button>
          ) : (
            <Link to={`/apply?destination=${c.code}&nationality=${nationality}&purpose=${purpose}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-400">Check eligibility <ArrowRight size={16} /></Link>
          )}
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {canStart ? (
          <button onClick={() => startApplication(primaryOption)} disabled={starting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight size={16} />} Start application</button>
        ) : (
          <Link to={`/apply?destination=${c.code}&nationality=${nationality}&purpose=${purpose}`} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white">Check eligibility <ArrowRight size={16} /></Link>
        )}
      </div>

      <footer className="border-t border-slate-200 px-5 py-8 text-center text-xs text-slate-400">
        <p>Estimates are not guarantees. Unverified requirements are clearly marked until supported by authoritative sources.</p>
        <p className="mt-1">Refunds: the government fee is generally non-refundable once an application is submitted; the Krosz service fee may be refundable before submission, per this route’s refund policy. SLA: typical Krosz internal review ~1 business day; government processing time varies by destination.</p>
      </footer>
    </div>
  );
}

function ComparisonTable({ options, onStart }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">Visa</th>
            <th className="p-3">Entries</th>
            <th className="p-3">Stay</th>
            <th className="p-3">Processing</th>
            <th className="p-3">Cost from</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {options.map((o) => (
            <tr key={o.id}>
              <td className="p-3 font-medium text-slate-900">{o.name}</td>
              <td className="p-3 text-slate-600">{o.entries === -1 ? 'Multiple' : o.entries === 0 ? 'Visa-free' : `${o.entries} entry`}</td>
              <td className="p-3 text-slate-600">{o.max_stay_days ? `${o.max_stay_days} days` : '—'}</td>
              <td className="p-3 text-slate-600">{o.processing?.standard_min != null ? `${o.processing.standard_min}–${o.processing.standard_max}d` : '—'}</td>
              <td className="p-3 font-medium text-slate-900">{o.fees ? fmtMinor(o.fees.total_minor, o.fees.currency) : '—'}</td>
              <td className="p-3"><button onClick={() => onStart(o)} className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">Start <ArrowRight size={12} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlugRedirect({ to }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return <div className="min-h-screen bg-[#fcfbf9]"><div className="mx-auto max-w-4xl px-5 py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div></div>;
}

function NotFound({ slug }) {
  return (
    <div className="min-h-screen bg-[#fcfbf9]">
      <DiscoveryHeader />
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Destination not available</h1>
        <p className="mt-1 text-sm text-slate-500">We couldn't find a visa page for “{slug}”.</p>
        <Link to="/" className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><ArrowLeft size={15} /> Back to home</Link>
      </div>
    </div>
  );
}