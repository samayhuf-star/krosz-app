import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, CheckCircle2, Clock3, FileCheck2, Globe2,
  LockKeyhole, PlaneTakeoff, ShieldCheck, Sparkles, TimerReset,
} from 'lucide-react';
import DiscoveryHeader from '@/components/visa/discovery/DiscoveryHeader';
import VisaSearchBar from '@/components/visa/discovery/VisaSearchBar';
import PopularDestinations from '@/components/visa/discovery/PopularDestinations';
import TravelerGlobe from '@/components/visa/TravelerGlobe';
import { trackDiscovery } from '@/lib/discoveryIntent';
import { useSeo } from '@/lib/seo';

const QUICK_DESTINATIONS = [
  { code: 'AE', name: 'UAE', flag: '🇦🇪', meta: 'MVP route', slug: 'united-arab-emirates' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', meta: 'MVP route', slug: 'vietnam' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', meta: 'MVP route', slug: 'indonesia' },
];

export default function VisaHomepage() {
  useSeo({
    title: 'Krosz — Visas made simple for Indian travellers',
    description: 'Check visa requirements, eligibility, documents and application routes for Indian passport holders. Start with your destination and continue in one guided journey.',
    canonical_path: '/',
    robots: 'index,follow',
  });

  useEffect(() => { trackDiscovery('LANDING'); }, []);

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-950">
      <DiscoveryHeader />

      <main>
        <section className="relative overflow-hidden border-b border-slate-200/70 bg-[#f5f7fa]">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute left-1/2 top-[-240px] h-[460px] w-[860px] -translate-x-1/2 rounded-full bg-[#E7F0FE]/70 blur-3xl" />
          </div>

          {/* Live rotating globe — right of the hero copy on large screens. */}
          <div className="pointer-events-none absolute right-0 top-1/2 hidden h-[460px] w-[460px] -translate-y-1/2 lg:block" aria-hidden>
            <TravelerGlobe />
          </div>

          <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-12 sm:pt-16">
            <div className="relative max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-[#006CEC]" /> Visa intelligence for Indian travellers
              </span>

              <h1 className="mt-6 text-balance text-[2.4rem] font-semibold leading-[1.03] tracking-[-0.04em] text-slate-950 sm:text-6xl">
                Your visa journey,<br className="hidden sm:block" /> <span className="text-[#006CEC]">beautifully simple.</span>
              </h1>
              <p className="mt-5 max-w-xl text-pretty text-sm leading-7 text-slate-500 sm:text-base">
                Know what you need, prepare every document and follow every step from one calm, trusted workspace.
              </p>

              <div className="mt-8 max-w-2xl rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_24px_70px_-46px_rgba(15,23,42,.28)]">
                <VisaSearchBar autoFocus placeholder="Where do you want to travel?" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-500">
                <span className="inline-flex items-center gap-1.5"><BadgeCheck size={14} className="text-[#006CEC]" /> Verified visa intelligence</span>
                <span className="inline-flex items-center gap-1.5"><LockKeyhole size={14} className="text-[#006CEC]" /> Private document vault</span>
                <span className="inline-flex items-center gap-1.5"><TimerReset size={14} className="text-[#006CEC]" /> Resume anytime</span>
              </div>
            </div>

            {/* Technology feature strip — the hero highlight */}
            <div className="mt-12">
              <div className="flex items-end justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Powered by Krosz technology</p>
                <Link to="/apply" className="text-[11px] font-semibold text-[#003580] hover:text-[#00225A]">How it works →</Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-4">
                {[
                  { icon: Sparkles, label: 'Passport intelligence', detail: 'Upload once, auto-prefill.' },
                  { icon: FileCheck2, label: '20+ readiness checks', detail: 'Checked before submission.' },
                  { icon: ShieldCheck, label: 'Smart doc verification', detail: 'Catch issues early.' },
                  { icon: BadgeCheck, label: 'Readiness score', detail: 'Clear go / review / block.' },
                ].map((t) => (
                  <div key={t.label} className="group bg-white px-5 py-5 transition hover:bg-[#E7F0FE]/40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#003580] text-[#6FA8FF] transition group-hover:bg-[#003580] group-hover:text-white">
                      <t.icon size={17} />
                    </span>
                    <p className="mt-3.5 text-sm font-bold text-slate-950">{t.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-auto mt-12 max-w-5xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Popular from India</p>
                <Link to="/apply" className="text-xs font-semibold text-[#003580] hover:text-[#00225A]">Explore all <span aria-hidden>→</span></Link>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {QUICK_DESTINATIONS.map((d) => (
                  <Link
                    key={d.code}
                    to={`/visa/${d.slug}`}
                    className="group rounded-[22px] border border-slate-200/80 bg-white/85 px-3.5 py-3.5 text-left shadow-[0_8px_30px_-24px_rgba(15,23,42,.3)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-[#D6E4FF] hover:shadow-[0_20px_50px_-28px_rgba(15,23,42,.35)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl" aria-hidden>{d.flag}</span>
                      <ArrowRight size={14} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#006CEC]" />
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-900">{d.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{d.meta}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:py-24">
          <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.17em] text-[#003580]">One guided journey</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">From “do I need a visa?” to “what happens next?”</h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">Krosz keeps visa intelligence, traveler details, documents, review and case tracking in one place. When an execution provider is not verified, we show guidance instead of pretending we can submit.</p>
              <Link to="/apply" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#003580] px-5 py-3 text-sm font-semibold text-white hover:bg-[#00225A]">Check my destination <ArrowRight size={15} /></Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Globe2, n: '01', title: 'Check the route', desc: 'Visa-free, ETA, eVisa, VOA or embassy route — normalized for Indian travellers.' },
                { icon: FileCheck2, n: '02', title: 'Know the documents', desc: 'See the checklist before you start and reuse documents securely.' },
                { icon: ShieldCheck, n: '03', title: 'Review before action', desc: 'Important steps are gated so incomplete or uncertain data does not silently move forward.' },
                { icon: PlaneTakeoff, n: '04', title: 'Follow the case', desc: 'Keep status, next action and application history together in your dashboard.' },
              ].map((item) => (
                <article key={item.n} className="rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_16px_50px_-36px_rgba(15,23,42,.35)]">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E7F0FE] text-[#003580]"><item.icon size={19} /></span>
                    <span className="text-xs font-bold text-slate-300">{item.n}</span>
                  </div>
                  <h3 className="mt-5 text-base font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[#D6E4FF] bg-[#003580] text-white">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div className="lg:sticky lg:top-24">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#006CEC]/20 bg-[#006CEC]/10 px-3 py-1.5 text-xs font-bold text-[#6FA8FF]">
                  <Sparkles size={14} /> Krosz technology
                </div>
                <h2 className="mt-5 max-w-xl text-3xl font-bold tracking-tight sm:text-5xl">Technology that checks before you submit.</h2>
                <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">Most visa journeys tell you what to upload. Krosz is built to check whether your application is actually ready — before avoidable mistakes reach the submission stage.</p>

                <div className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
                    <span className="rounded-full bg-[#006CEC] px-3 py-1.5 text-white">20+ checks</span>
                    <span aria-hidden>→</span>
                    <span className="rounded-full border border-white/10 px-3 py-1.5">Readiness score</span>
                    <span aria-hidden>→</span>
                    <span className="rounded-full border border-white/10 px-3 py-1.5">Human review</span>
                    <span aria-hidden>→</span>
                    <span className="rounded-full border border-white/10 px-3 py-1.5">Submission</span>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-400">Krosz keeps automated checks, uncertainty and human review separate. If something cannot be verified confidently, it is flagged instead of guessed.</p>
                </div>

                <Link to="/apply" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[#003580] px-5 py-3 text-sm font-bold text-white hover:bg-[#006CEC]">Check my visa readiness <ArrowRight size={15} /></Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: FileCheck2, title: '20+ automated checks', desc: 'Passport, travel dates, eligibility, documents, consistency and application quality are checked before submission.' },
                  { icon: Sparkles, title: 'Passport intelligence', desc: 'Upload your passport once. Krosz reads key details, helps prefill the journey and reduces repetitive manual entry.' },
                  { icon: ShieldCheck, title: 'Smart document verification', desc: 'Missing, unclear, inconsistent or review-required documents are surfaced early — when they are still easy to fix.' },
                  { icon: BadgeCheck, title: 'Cross-document checks', desc: 'Passport details, travel information, forms and supporting documents are compared so mismatches do not hide between screens.' },
                  { icon: CheckCircle2, title: 'Visa Readiness Score', desc: 'See whether your application is ready, blocked or needs review instead of relying on a vague “looks good” message.' },
                  { icon: LockKeyhole, title: 'Human safety gate', desc: 'Qualified paid applications receive a final Visa Approver Manager review before the submission workflow continues.' },
                ].map((item) => (
                  <article key={item.title} className="rounded-[26px] border border-white/10 bg-white/[0.045] p-6 transition hover:border-orange-400/30 hover:bg-white/[0.065]">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#006CEC]/15 text-[#6FA8FF]"><item.icon size={19} /></span>
                    <h3 className="mt-5 text-base font-bold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.desc}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-3 border-t border-white/10 pt-8 sm:grid-cols-3">
              {[
                ['Fewer avoidable mistakes', 'Problems are surfaced before they become visa problems.'],
                ['Transparent pricing in ₹', 'Krosz fees and government fees stay clearly separated before payment.'],
                ['Everything in one workspace', 'Traveler details, family applications, documents, progress and next actions stay together.'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl bg-white/[0.035] p-5">
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <div className="mb-7 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.17em] text-[#003580]">Discover</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">Popular visa destinations</h2>
              </div>
              <p className="max-w-lg text-sm text-slate-500">Live catalog cards come from the visa discovery engine, so the home page stays connected to the backend.</p>
            </div>
            <PopularDestinations />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:py-24">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: Clock3, title: 'Fast to start', desc: 'Destination first. No long form before you know what route applies.' },
              { icon: CheckCircle2, title: 'Clear confidence', desc: 'Verified, unknown and review-required states are kept distinct instead of being guessed.' },
              { icon: LockKeyhole, title: 'Built around privacy', desc: 'Traveler and document records use owner/admin access controls and private storage flows.' },
            ].map((item) => (
              <div key={item.title} className="rounded-[28px] bg-[#003580] p-7 text-white shadow-[0_20px_60px_-35px_rgba(15,23,42,.7)]">
                <item.icon size={20} className="text-[#6FA8FF]" />
                <h3 className="mt-5 text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-[36px] border border-[#D6E4FF]/70 bg-gradient-to-br from-[#E7F0FE] via-white to-[#D6E4FF] px-6 py-12 text-center shadow-[0_25px_70px_-45px_rgba(0,108,236,.4)] sm:px-10 sm:py-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-950">Where are you going next?</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">Start with your destination and Krosz will show the visa route available in the current catalog.</p>
            <Link to="/apply" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#003580] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#00225A]">Find my visa <ArrowRight size={15} /></Link>
          </div>
        </section>
      </main>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-xs leading-5 text-slate-600">
            <strong className="text-slate-900">Independent service disclosure:</strong> Krosz is a private visa and travel assistance service. We are not a government website, agency, embassy, consulate or immigration authority and are not affiliated with or endorsed by them unless explicitly stated. Visa decisions are made solely by the relevant government. Krosz service fees and applicable government fees are shown separately before payment. <Link to="/trust" className="font-semibold text-[#006CEC] hover:underline">Trust Center</Link> · <Link to="/legal" className="font-semibold text-[#006CEC] hover:underline">Legal & policies</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div><span className="font-bold text-slate-900">Krosz</span> · Visa guidance and application workspace</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link to="/about" className="hover:text-slate-900">About</Link>
            <Link to="/contact" className="hover:text-slate-900">Contact</Link>
            <Link to="/login" className="hover:text-slate-900">Sign in</Link>
            <Link to="/trust" className="hover:text-slate-900">Trust</Link>
            <Link to="/legal" className="hover:text-slate-900">Legal</Link>
            <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link to="/refund-policy" className="hover:text-slate-900">Refunds</Link>
            <Link to="/support" className="hover:text-slate-900">Support</Link>
            <span>© {new Date().getFullYear()} Krosz</span>
          </div>
        </div>
      </footer>
    </div>
  );
}