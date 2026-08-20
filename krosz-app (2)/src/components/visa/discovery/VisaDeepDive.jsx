import { useMemo, useState } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, ShieldCheck, Clock3, FileText,
  Plane, Hotel, Map, BriefcaseBusiness, Landmark, BadgeCheck,
  History, ExternalLink, AlertTriangle, CircleDollarSign, CalendarDays,
  Image as ImageIcon, BookOpenCheck, WalletCards, Building2, UserRound,
  Info, ListChecks, PlaneTakeoff,
} from 'lucide-react';

const topTabs = [
  { key: 'general', label: 'General Information', icon: Info, blurb: 'Quick facts about processing, stay, entry type and fees for this route.' },
  { key: 'eligibility', label: 'Eligibility & Requirements', icon: ShieldCheck, blurb: 'The document checklist and conditions tied to your nationality and purpose.' },
  { key: 'process', label: 'Application Process', icon: ListChecks, blurb: 'Every step from eligibility check to submission and status tracking.' },
  { key: 'entry', label: 'Entry & Exit Regulations', icon: PlaneTakeoff, blurb: 'Border conditions and recommended requirements for arrival and departure.' },
];

const packet = [
  { key: 'cover', title: 'Cover Letter', icon: FileText },
  { key: 'itinerary', title: 'Day-To-Day Itinerary', icon: Map },
  { key: 'hotel', title: 'Accommodation Proof', icon: Hotel },
  { key: 'flight', title: 'Flight / Travel Reservation', icon: Plane },
  { key: 'insurance', title: 'Travel Insurance', icon: ShieldCheck },
  { key: 'sponsor', title: 'Sponsorship / Support Letter', icon: BriefcaseBusiness },
  { key: 'application', title: 'Final Application Review', icon: Landmark },
];

const requirementExamples = [
  { key: 'photo', title: 'Recent Photograph', subtitle: 'Upload a compliant passport-style photograph', icon: ImageIcon, tabs: ['Guidelines', 'Example', 'Size', 'Specs'] },
  { key: 'passport', title: 'Passport', subtitle: 'Valid passport with clear bio and signature pages', icon: BookOpenCheck, tabs: ['Guidelines', 'Example'] },
  { key: 'finance', title: 'Financial Proof', subtitle: 'Recent bank evidence showing adequate funds', icon: WalletCards, tabs: ['Guidelines', 'Example'] },
  { key: 'employment', title: 'Employment Proof', subtitle: 'Employment letter, payslip, leave approval or equivalent', icon: Building2, tabs: ['Guidelines', 'Example'] },
  { key: 'identity', title: 'Identity / Residency Proof', subtitle: 'Supporting identity or residence document when required', icon: UserRound, tabs: ['Guidelines', 'Example'] },
];

function money(amount, currency) {
  if (amount == null || Number(amount) <= 0) return null;
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }).format(Number(amount) / 100); }
  catch { return `${currency || ''} ${(Number(amount) / 100).toFixed(0)}`; }
}

function EmptyPanel({ icon: Icon, text }) {
  return (
    <div className="grid place-items-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-300 shadow-sm"><Icon size={22} /></span>
      <p className="mt-4 max-w-sm text-sm leading-6 text-slate-500">{text}</p>
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 py-5 text-left">
        <span className="text-base font-semibold text-orange-600 sm:text-lg">{title}</span>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-600 transition ${open ? 'rotate-180 bg-slate-100' : ''}`}><ChevronDown size={19} /></span>
      </button>
      {open && <div className="pb-6 text-sm leading-6 text-slate-600">{children}</div>}
    </div>
  );
}

function InfoGrid({ items }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{items.map(({ icon: Icon, label, value }) => (
    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-600"><Icon size={17} /></span>
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 font-semibold text-slate-900">{value || 'Confirmed during eligibility check'}</p></div>
      </div>
    </div>
  ))}</div>;
}

function PacketDocument({ item, countryName }) {
  const Icon = item.icon;
  return (
    <div className="relative mx-auto aspect-[3/4] w-[72%] max-w-sm rounded-[24px] border-[10px] border-slate-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.10)] sm:w-[60%]">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2"><Icon size={18} className="text-orange-600" /><span className="text-xs font-bold text-slate-900">KROSZ</span></div>
        <span className="text-[9px] font-medium text-slate-400">APPLICATION PACKET</span>
      </div>
      <div className="mt-5 space-y-3">
        <div className="h-3 w-2/3 rounded bg-slate-900" />
        <p className="text-[10px] font-semibold text-slate-700">{item.title}</p>
        <p className="text-[9px] leading-4 text-slate-500">Prepared for your {countryName || 'visa'} application using the traveller details and verified documents you provide.</p>
        <div className="space-y-2 pt-2">{[86,94,72,90,62,84,76,92].map((w,i) => <div key={i} className="h-1.5 rounded-full bg-slate-100" style={{width:`${w}%`}} />)}</div>
        <div className="mt-5 rounded-xl border border-dashed border-orange-200 bg-orange-50/60 p-3"><p className="text-[9px] font-semibold text-orange-700">Illustrative preview</p><p className="mt-1 text-[8px] leading-3.5 text-orange-600/80">Your final packet is generated from your actual application and verified route requirements.</p></div>
      </div>
    </div>
  );
}

function RequirementExample({ item }) {
  const [tab, setTab] = useState(item.tabs[0]);
  const Icon = item.icon;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600"><Icon size={18}/></span><div><h4 className="font-semibold text-slate-900">{item.title}</h4><p className="mt-0.5 text-sm text-slate-500">{item.subtitle}</p></div></div>
      <div className="flex gap-2 overflow-x-auto border-y border-slate-100 px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{item.tabs.map(t => <button key={t} onClick={()=>setTab(t)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${tab===t?'bg-orange-600 text-white':'bg-slate-50 text-slate-600'}`}>{t}</button>)}</div>
      <div className="p-4">
        {tab === 'Guidelines' && <ul className="space-y-2 text-sm text-slate-600"><li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-orange-600"/>Use a clear, recent, unedited document/photo.</li><li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-orange-600"/>All text, edges, stamps and identifiers must be visible where applicable.</li><li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-orange-600"/>Krosz checks route-specific rules before final submission.</li></ul>}
        {tab === 'Example' && <div className="grid min-h-56 place-items-center rounded-2xl bg-slate-50 p-5"><div className="w-full max-w-sm rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]"><div className="mb-4 flex items-center justify-between"><span className="text-sm font-bold text-slate-900">Illustrative Example</span><span className="text-[10px] font-medium text-amber-700">NOT A REAL DOCUMENT</span></div><div className="space-y-2">{[88,70,94,64,82,76].map((w,i)=><div key={i} className="h-2 rounded-full bg-slate-100" style={{width:`${w}%`}} />)}</div><div className="mt-5 rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Example layout only</div></div></div>}
        {tab === 'Size' && <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-900">Photo dimensions</p><p className="mt-1">Exact dimensions vary by destination. Route-specific dimensions are shown only when they are verified for your selected visa route.</p></div>}
        {tab === 'Specs' && <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-900">Technical checks</p><p className="mt-1">Clear face/document, neutral lighting, no blur, no glare, readable details and compliant file format.</p></div>}
      </div>
    </div>
  );
}

export default function VisaDeepDive({ page, entry, country }) {
  const [activeTab, setActiveTab] = useState('general');
  const [packetIndex, setPacketIndex] = useState(0);
  const [reviewTab, setReviewTab] = useState('sources');
  const routeVerified = entry?.ready_for_public === true;
  const checklist = routeVerified ? (entry?.checklist || []).filter((i) => i?.applicable !== false) : [];
  const conditions = (entry?.conditions || []).filter(Boolean);
  const fee = money(entry?.fees?.total_minor, entry?.fees?.currency);
  const governmentFee = money(entry?.fees?.government_minor, entry?.fees?.currency);
  const currentPacket = packet[packetIndex];

  const summary = useMemo(() => {
    const processing = page?.options?.[0]?.processing;
    const p = processing?.standard_min != null ? `${processing.standard_min}${processing.standard_max != null ? `–${processing.standard_max}` : '+'} days` : 'Confirmed for your route';
    return [
      { icon: Clock3, label: 'Processing', value: p },
      { icon: CalendarDays, label: 'Maximum stay', value: entry?.max_stay_days ? `${entry.max_stay_days} days` : 'Route dependent' },
      { icon: Landmark, label: 'Visa / entry type', value: entry?.journey_type?.replaceAll('_', ' ') || page?.options?.[0]?.category?.replaceAll('_', ' ') || 'Confirmed after eligibility' },
      { icon: CircleDollarSign, label: 'Fees', value: fee || governmentFee || 'Shown before payment' },
    ];
  }, [entry, page, fee, governmentFee]);

  const goPacket = (delta) => setPacketIndex((v) => (v + delta + packet.length) % packet.length);

  return (
    <section className="mx-auto mt-10 max-w-5xl px-4 sm:px-5">
      {/* Tabs */}
      <div className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-2">
          {topTabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setActiveTab(key)} aria-pressed={activeTab === key}
              className={`group inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${activeTab === key ? 'bg-slate-950 text-white shadow-[0_12px_30px_-12px_rgba(15,23,42,.6)]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              <Icon size={16} className={activeTab === key ? 'text-orange-400' : 'text-slate-500'} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab panel */}
      <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_-44px_rgba(15,23,42,.4)]">
        <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/60 px-5 py-5 sm:px-7">
          {(() => { const t = topTabs.find((x) => x.key === activeTab); const Icon = t.icon; return (
            <>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-600 ring-1 ring-orange-100"><Icon size={20} /></span>
              <div>
                <h3 className="text-lg font-bold tracking-[-0.02em] text-slate-950 sm:text-xl">{t.label}</h3>
                <p className="mt-0.5 text-sm text-slate-500">{t.blurb}</p>
              </div>
            </>
          ); })()}
        </div>

        <div className="px-5 py-6 sm:px-7">
          {activeTab === 'general' && (
            <>
              <InfoGrid items={summary} />
              <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <p className="text-sm leading-6 text-slate-600">Krosz ties the information on this page to your nationality, destination and travel purpose so generic country-wide assumptions do not replace route-specific rules.</p>
              </div>
            </>
          )}

          {activeTab === 'eligibility' && (
            checklist.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {checklist.slice(0, 10).map((i, idx) => (
                  <div key={i.code || idx} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-26px_rgba(15,23,42,.4)]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600"><BadgeCheck size={16} /></span>
                    <div>
                      <p className="font-semibold text-slate-900">{i.label || i.title || 'Required item'}</p>
                      {i.reason && <p className="mt-0.5 text-sm text-slate-500">{i.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel icon={ShieldCheck} text="We’ll show the exact checklist after this route’s material requirements have been verified." />
            )
          )}

          {activeTab === 'process' && (
            <ol className="space-y-3">
              {['Check eligibility and select the right route', 'Scan or enter passport and traveller details', 'Upload the required supporting documents', 'Krosz reviews completeness and prepares the application packet', 'Review fees and final application before payment / submission', 'Track the confirmed application status in your account'].map((s, i) => (
                <li key={s} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white px-4 py-3.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white">{i + 1}</span>
                  <span className="text-sm font-medium text-slate-700">{s}</span>
                  {i < 5 && <span className="ml-auto hidden text-slate-300 sm:inline"><ChevronDown size={16} className="-rotate-90" /></span>}
                </li>
              ))}
            </ol>
          )}

          {activeTab === 'entry' && (
            conditions.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {conditions.map((c, i) => (
                  <div key={c.code || i} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-orange-600" />
                    <p className="text-sm leading-6 text-slate-700">{c.label}{c.required ? '' : ' (recommended)'}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel icon={PlaneTakeoff} text="Entry conditions are shown after the route is resolved." />
            )
          )}
        </div>
      </div>

      {/* More details — secondary accordions */}
      <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-4 sm:px-6">
        <Accordion title="Refunds, Rejections & Reapplications"><p>Krosz shows the applicable refund rules and payment-stage conditions before checkout. Visa approval remains the decision of the issuing authority. If an application is refused, the application workspace should show the recorded reason when available and whether a correction or reapplication route exists.</p></Accordion>
        <Accordion title="Visa Extension & Overstays"><p>Extension eligibility and overstay consequences are country-specific. Krosz displays only verified route-specific guidance and the official authority route when direct handling is required.</p></Accordion>
        <Accordion title="Status Tracking"><p>After submission, confirmed milestones appear in My Applications. Krosz distinguishes between internal preparation, provider submission, authority processing and final decision so users can see exactly where the application stands.</p></Accordion>
      </div>

      {false && <>
      {routeVerified && entry?.documents?.length > 0 && <div className="mt-10">
        <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">Document guidelines & examples</h2><div className="mt-2 h-0.5 w-16 bg-orange-600"/><p className="mt-4 text-sm text-slate-600">Examples are shown only for document types included in the verified route checklist.</p>
        <div className="mt-5 grid gap-4">{requirementExamples.filter((item) => {
          const text = (entry.documents || []).map((d) => `${d.code || ''} ${d.label || ''}`).join(' ').toLowerCase();
          if (item.key === 'passport') return /passport/.test(text);
          if (item.key === 'photo') return /photo|photograph/.test(text);
          if (item.key === 'finance') return /fund|bank|financial/.test(text);
          if (item.key === 'employment') return /employment|employer|salary|leave/.test(text);
          if (item.key === 'identity') return /identity|residen|aadhaar|national id/.test(text);
          return false;
        }).map(item=><RequirementExample key={item.key} item={item}/>)}</div>
      </div>}

      <div className="mt-12">
        <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">What you get</h2><div className="mt-2 h-0.5 w-16 bg-orange-600"/><p className="mt-4 text-sm text-slate-600">A clear preview of the application packet Krosz can prepare from your information and verified supporting documents.</p>
        <div className="relative mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 sm:p-8">
          <div className="text-center"><p className="text-base font-bold text-slate-950 sm:text-lg">Your Final Application Preview</p><p className="mt-1 text-sm text-slate-500">{currentPacket.title}</p></div>
          <div className="relative mt-6"><button type="button" onClick={()=>goPacket(-1)} aria-label="Previous preview" className="absolute left-0 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white shadow-md"><ChevronLeft size={20}/></button><PacketDocument item={currentPacket} countryName={country?.name}/><button type="button" onClick={()=>goPacket(1)} aria-label="Next preview" className="absolute right-0 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white shadow-md"><ChevronRight size={20}/></button></div>
          <p className="mt-5 text-center text-xs italic text-slate-400">Illustrative preview only; the actual packet reflects your details and the verified requirements for your selected route.</p>
          <div className="mt-4 flex justify-center gap-1.5">{packet.map((p,i)=><button key={p.key} type="button" aria-label={p.title} onClick={()=>setPacketIndex(i)} className={`h-2 rounded-full transition-all ${i===packetIndex?'w-8 bg-orange-600':'w-2 bg-slate-300'}`}/>)}</div>
        </div>
      </div>

      <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-xl font-bold text-slate-950">How we reviewed this page</h2><div className="mt-2 h-0.5 w-16 bg-orange-600"/>
        <div className="mt-5 flex gap-6 border-b border-slate-200"><button onClick={()=>setReviewTab('sources')} className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold ${reviewTab==='sources'?'border-orange-600 text-orange-600':'border-transparent text-slate-500'}`}><ShieldCheck size={16}/> Sources</button><button onClick={()=>setReviewTab('history')} className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold ${reviewTab==='history'?'border-orange-600 text-orange-600':'border-transparent text-slate-500'}`}><History size={16}/> History</button></div>
        {reviewTab==='sources'?<div className="mt-4 text-sm leading-6 text-slate-600"><p>Material visa rules are checked against the authoritative route source before we present them as confirmed.</p>{entry?.source?.name && !/dev|seed|pending research/i.test(entry.source.name) && <p className="mt-3 flex items-center gap-2 font-medium text-slate-800"><ShieldCheck size={15} className="text-orange-600"/> Current source: {entry.source.name}</p>}{entry?.application?.official_portal&&<a href={entry.application.official_portal} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-orange-600">Open official portal <ExternalLink size={14}/></a>}</div>:<div className="mt-4 text-sm leading-6 text-slate-600"><p>Verification history records meaningful rule changes and review dates for the selected route.</p>{entry?.source?.verified_at&&<p className="mt-3 font-medium text-slate-800">Last verified: {new Date(entry.source.verified_at).toLocaleDateString()}</p>}</div>}
      </div>

      <div className="mt-10 rounded-3xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3"><AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600"/><div><p className="font-semibold text-slate-900">Important</p><p className="mt-1 text-sm leading-6 text-slate-600">Examples and packet previews explain the process; they are not evidence that a specific document is required unless the selected route marks it as required. Final visa decisions are made by the issuing authority.</p></div></div></div>
      </>}
    </section>
  );
}