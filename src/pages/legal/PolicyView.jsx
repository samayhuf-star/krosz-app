import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Loader2, AlertTriangle, ArrowLeft, ChevronRight } from 'lucide-react';
import { getPolicyPublic } from '@/lib/trustApi';
import { POLICIES, POLICY_BY_SLUG } from '@/lib/policyRegistry';
import VisaServiceDisclaimer from '@/components/visa/VisaServiceDisclaimer';

const PH = (v, label) => (v && String(v).trim() ? v : `[ACTION REQUIRED: ${label} — not yet configured]`);

export default function PolicyView({ slug: propSlug }) {
  const params = useParams();
  const slug = propSlug || params.slug;
  const meta = POLICY_BY_SLUG[slug];
  const q = useQuery({ queryKey: ['policy', slug], queryFn: () => getPolicyPublic(slug), enabled: !!slug });
  const policy = q.data?.policy;
  const cfg = q.data?.config || {};

  const substitute = (body) => (body || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const val = cfg[k];
    if (k === 'brand_name') return val || 'Krosz';
    return PH(val, k.replace(/_/g, ' '));
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
      <aside className="hidden lg:block">
        <Link to="/legal" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> All policies</Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Policies</p>
        <ul className="mt-2 space-y-0.5">
          {POLICIES.map((p) => (
            <li key={p.slug}>
              <Link to={p.path} className={`block rounded-lg px-3 py-1.5 text-sm ${p.slug === slug ? 'bg-[#006CEC]/10 font-medium text-[#006CEC]' : 'text-slate-600 hover:bg-slate-50'}`}>{p.title}</Link>
            </li>
          ))}
        </ul>
      </aside>

      <article>
        <nav className="flex items-center gap-1 text-xs text-slate-400">
          <Link to="/legal" className="hover:text-slate-700">Legal</Link>
          <ChevronRight size={12} />
          <span className="text-slate-600">{meta?.title || slug}</span>
        </nav>

        {q.isLoading ? <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : q.isError || !policy ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              This policy is not available yet. It is being prepared. <Link to="/legal" className="text-[#006CEC] hover:underline">Return to Legal</Link>.
            </div>
          ) : (
            <>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{policy.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{policy.version}</span>
                {policy.effective_from && <span>Effective {new Date(policy.effective_from).toLocaleDateString('en-IN')}</span>}
                {policy.status !== 'published' && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{policy.status}</span>}
              </div>

              {policy.needs_legal_review && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>This policy text is a template under preparation and should be reviewed by a qualified Indian legal/compliance professional. It is not legal advice and may change before it becomes final.</span>
                </div>
              )}

              <div className="policy-body mt-6 max-w-3xl text-sm leading-7 text-slate-700 [&_a]:text-[#006CEC] [&_a]:underline [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3">
                <ReactMarkdown>{substitute(policy.body)}</ReactMarkdown>
              </div>

              {slug === 'ai-transparency' && <VisaServiceDisclaimer className="mt-8" />}
            </>
          )}
      </article>
    </div>
  );
}