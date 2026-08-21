import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Globe2, MapPin } from 'lucide-react';
import { useSeo } from '@/lib/seo';

export default function About() {
  useSeo({
    title: 'About Krosz — Visas made simple for Indian travellers',
    description: 'Krosz is a visa application platform built by the Arrivals team for Indian passport holders. Learn what we do, who we serve, and how we verify every rule.',
    canonical_path: '/about',
    robots: 'index,follow',
  });

  return (
    <div className="min-h-screen bg-[#f8faf9] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="text-base font-semibold text-slate-900">Krosz</Link>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            Back to home <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
          About Krosz
        </h1>

        <p className="mt-6 text-lg leading-relaxed text-slate-700">
          Krosz is a visa application platform built for Indian passport holders who want a clearer, faster way to travel abroad. We combine verified visa intelligence, document automation, and a guided wizard so travellers can check eligibility, prepare documents, and submit applications without the guesswork and back-and-forth typical of government portals. From eVisas to embassy visas, Krosz surfaces the right route for each destination, reads passports and supporting documents automatically, and tracks every application through to a decision.
        </p>

        <p className="mt-4 text-lg leading-relaxed text-slate-700">
          We never approve visas — we make the path to one transparent, auditable, and calm. Each rule is grounded in official sources with two-source verification for critical fields, and we keep what we know and what we infer strictly separate. Travellers stay in control of their data and their decisions at every step, and incomplete or uncertain information is gated instead of being silently pushed forward.
        </p>

        <p className="mt-4 text-lg leading-relaxed text-slate-700">
          Krosz is built and operated by the Arrivals team — engineers, immigration specialists, and operations staff who have spent years moving paperwork online across South Asia and the Gulf. We work with official portals, vetted visa intelligence providers, and human operators only where automation is not yet possible, and we publish the execution capability for each destination honestly rather than overpromising. Our mission is to make the journey from “do I need a visa?” to a stamped passport feel less like paperwork and more like a concierge.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Card icon={Globe2} title="For Indian travellers" body="Discovery, eligibility and document workflows tuned for the Indian passport and Indian departures." />
          <Card icon={ShieldCheck} title="Verified intelligence" body="Visa rules cross-checked against two independent sources before they ever reach a traveller." />
          <Card icon={MapPin} title="Built by Arrivals" body="A team of engineers and immigration specialists operating from India with global coverage." />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
            Explore destinations <ArrowRight size={16} />
          </Link>
          <Link to="/contact" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Contact us
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div><span className="font-bold text-slate-900">Krosz</span> · Visa guidance and application workspace</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link to="/about" className="hover:text-slate-900">About</Link>
            <Link to="/contact" className="hover:text-slate-900">Contact</Link>
            <span>© {new Date().getFullYear()} Krosz</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Card({ icon: Icon, title, body }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <Icon className="h-5 w-5 text-emerald-600" />
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}