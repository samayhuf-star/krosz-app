import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Lock, CreditCard, LifeBuoy, Bot, Globe2, Users } from 'lucide-react';
import { getBusinessConfigPublic } from '@/lib/trustApi';
import VisaServiceDisclaimer from '@/components/visa/VisaServiceDisclaimer';

const PH = (v, label) => (v && String(v).trim() ? v : `[ACTION REQUIRED: ${label}]`);

export default function TrustCenter() {
  const q = useQuery({ queryKey: ['trust-config'], queryFn: getBusinessConfigPublic });
  const c = q.data?.config || {};
  const brand = c.brand_name || 'Krosz';

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-9">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#006CEC]"><ShieldCheck size={16} /> Trust Center</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Why customers trust {brand}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">{brand} is a private visa and travel assistance service. This Trust Center explains who we are, how we work, and the protections built into every application.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card icon={Users} title="Who we are">{brand} is operated by {PH(c.legal_entity_name, 'legal entity name')}, based at {PH(c.registered_address, 'registered address')}. We assist Indian travellers with visa requirements, documents and submission support.</Card>
        <Card icon={Globe2} title="Government independence">{brand} is not a government agency, embassy or immigration authority. Governments decide visa eligibility and approval. We never claim otherwise.</Card>
        <Card icon={CreditCard} title="Transparent pricing">Before you pay, we show the Krosz service fee and the government fee separately, plus applicable taxes. No hidden charges are added at the last moment. See <Link to="/refund-policy" className="text-[#006CEC] hover:underline">refund policy</Link>.</Card>
        <Card icon={Lock} title="Security & privacy">Your documents and data are stored on secured infrastructure. We do not sell your data. You can request access, correction or deletion subject to legal retention. See <Link to="/privacy" className="text-[#006CEC] hover:underline">privacy policy</Link>.</Card>
        <Card icon={Bot} title="How we use AI">AI helps read documents, pre-fill forms and answer support questions. Humans review paid applications before submission. AI never invents visa rules or guarantees approval. See <Link to="/ai-transparency" className="text-[#006CEC] hover:underline">AI transparency</Link>.</Card>
        <Card icon={LifeBuoy} title="Support & grievances">Support: {PH(c.support_email, 'support email')}. Grievance officer: {PH(c.grievance_officer_name, 'grievance officer name')} ({PH(c.grievance_officer_designation, 'designation')}) — {PH(c.grievance_email, 'grievance email')}. See <Link to="/grievance-policy" className="text-[#006CEC] hover:underline">grievance policy</Link>.</Card>
      </div>

      <VisaServiceDisclaimer />
    </div>
  );
}

function Card({ icon: Icon, title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#006CEC]/10 text-[#006CEC]"><Icon size={18} /></span>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-slate-600">{children}</p>
    </div>
  );
}