import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck, Scale, LifeBuoy, FileText } from 'lucide-react';
import { listPoliciesPublic } from '@/lib/trustApi';
import { POLICIES } from '@/lib/policyRegistry';
import VisaServiceDisclaimer from '@/components/visa/VisaServiceDisclaimer';

export default function LegalDirectory() {
  const q = useQuery({ queryKey: ['legal-policies'], queryFn: listPoliciesPublic });
  const live = new Map((q.data?.policies || []).map((p) => [p.policy_key, p]));

  return (
    <div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-9">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#006CEC]"><Scale size={16} /> Legal & Policies</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to trust Krosz</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
          Krosz is a private visa and travel assistance service. These pages explain what Krosz does, what it does not do, how fees and refunds work, and your rights as a customer in India.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Tile icon={ShieldCheck} title="Trust Center" to="/trust" body="Who Krosz is, how it works, security, AI use and your rights." />
          <Tile icon={LifeBuoy} title="Support & grievances" to="/grievance-policy" body="How to get help and how complaints are handled." />
          <Tile icon={FileText} title="Refunds" to="/refund-policy" body="Krosz fee, government fee and what is refundable." />
        </div>
      </div>

      {q.isLoading ? <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div> : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Section title="Legal policies" items={POLICIES.filter((p) => p.category === 'legal').map((p) => ({ ...p, ...(live.get(p.slug) || {}) }))} />
          <Section title="Trust & transparency" items={POLICIES.filter((p) => p.category !== 'legal').map((p) => ({ ...p, ...(live.get(p.slug) || {}) }))} />
        </div>
      )}

      <VisaServiceDisclaimer className="mt-8" />
    </div>
  );
}

function Tile({ icon: Icon, title, to, body }) {
  return (
    <Link to={to} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-[#006CEC]/40 hover:shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#006CEC]/10 text-[#006CEC]"><Icon size={18} /></span>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
    </Link>
  );
}

function Section({ title, items }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="mt-3 divide-y divide-slate-50">
        {items.map((p) => (
          <li key={p.slug} className="flex items-center justify-between py-2.5">
            <div>
              <Link to={p.path} className="text-sm font-medium text-slate-800 hover:text-[#006CEC]">{p.title}</Link>
              {p.summary && <p className="text-xs text-slate-400">{p.summary}</p>}
            </div>
            {p.needs_legal_review && <span className="ml-2 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Draft</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}