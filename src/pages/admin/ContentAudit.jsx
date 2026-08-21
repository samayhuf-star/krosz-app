import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { base44 } from '@/api/base44Client';

// Deterministic claim + conflict scanner (Phase 2 §13/§14). No AI, no credits.
// Scans published policy bodies, FAQ answers and help-article bodies for risky
// / contradictory phrases. Findings are surfaced for human review — it never
// auto-removes legitimate factual statements without context.
const RISKY = [
  { pat: /guaranteed\s+visa/i, sev: 'Critical', why: 'Implies a guaranteed visa outcome — governments decide.' },
  { pat: /guaranteed\s+approval|100%\s+approval|guarantee(d)?\s+(visa\s+)?approval/i, sev: 'Critical', why: 'Guaranteed approval claim — misleading.' },
  { pat: /official\s+(government\s+)?partner|embassy\s+approved|government\s+approved/i, sev: 'Critical', why: 'Implies government affiliation — Krosz is private.' },
  { pat: /guaranteed\s+processing|guaranteed\s+refund|best\s+visa\s+approval\s+rate|instant\s+visa/i, sev: 'High', why: 'Unsupported guarantee / urgency claim.' },
  { pat: /100%\s+refundable/i, sev: 'High', why: 'Contradicts the refund policy (service fee work performed is generally non-refundable).' },
  { pat: /expedited\s+guarantee/i, sev: 'Medium', why: 'Implies guaranteed faster processing.' },
  { pat: /(no\s+visa\s+required|visa[- ]free)\s+guaranteed/i, sev: 'High', why: 'Visa-free status is set by the destination government, not guaranteed.' },
];

export default function ContentAudit() {
  const [policies, setPolicies] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [pol, fq, ar] = await Promise.all([
          base44.entities.PolicyVersion.filter({ is_current: true }, '-effective_from', 100).catch(() => []),
          base44.entities.HelpFaq.filter({ status: 'published' }, 'order', 500).catch(() => []),
          base44.entities.HelpArticle.filter({ status: 'published' }, 'order', 200).catch(() => []),
        ]);
        setPolicies(pol); setFaqs(fq); setArticles(ar);
      } catch (e) { setErr(e?.message || 'Could not load content'); }
      finally { setLoading(false); }
    })();
  }, []);

  const findings = useMemo(() => {
    const out = [];
    const scan = (text, src, id, label) => {
      if (!text) return;
      for (const r of RISKY) {
        const m = String(text).match(r.pat);
        if (m) out.push({ sev: r.sev, why: r.why, match: m[0], source: src, id, label: label.slice(0, 120), excerpt: String(text).slice(Math.max(0, (m.index || 0) - 40), (m.index || 0) + 60) });
      }
    };
    policies.forEach((p) => scan(p.body, 'Policy', p.id, `${p.policy_key} v${p.version}`));
    faqs.forEach((f) => scan(`${f.question}\n${f.answer}`, 'FAQ', f.id, f.question));
    articles.forEach((a) => scan(`${a.title}\n${a.summary}\n${a.body}`, 'Article', a.id, a.title));
    // Conflict: refund policy vs any "100% refundable" anywhere.
    const refund = policies.find((p) => p.policy_key === 'refund-policy');
    if (refund && /100%\s+refundable/i.test(refund.body)) out.push({ sev: 'High', why: 'Refund policy itself says 100% refundable — contradicts service-fee terms.', match: '100% refundable', source: 'Policy', id: refund.id, label: 'refund-policy v' + refund.version, excerpt: 'within refund policy' });
    return out.sort((a, b) => ({ Critical: 0, High: 1, Medium: 2 }[a.sev] - { Critical: 0, High: 1, Medium: 2 }[b.sev]));
  }, [policies, faqs, articles]);

  const critical = findings.filter((f) => f.sev === 'Critical').length;
  const high = findings.filter((f) => f.sev === 'High').length;
  const score = Math.max(0, 100 - critical * 20 - high * 8);

  return (
    <div>
      <PageHeader eyebrow="Trust & Compliance" title="Content scan" description="Deterministic scan of policies, FAQs and help articles for misleading claims and contradictions. No AI, no credit use — human reviews each finding." />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {err && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-900">Claim & conflict score</p><p className="text-xs text-slate-500">Scanned {policies.length} policies, {faqs.length} FAQs, {articles.length} articles.</p></div>
                <p className={`text-3xl font-bold ${score >= 90 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>{score}</p>
              </div>
              {findings.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={15} /> No risky phrases or contradictions detected.</p>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-sm text-amber-800"><AlertTriangle size={15} /> {critical} critical, {high} high, {findings.length} total findings — review below.</p>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="p-3 font-medium">Severity</th><th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Label</th><th className="p-3 font-medium">Match</th><th className="p-3 font-medium">Why</th><th className="p-3 font-medium">Excerpt</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {findings.map((f, i) => (
                    <tr key={i} className="align-top">
                      <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${f.sev === 'Critical' ? 'bg-rose-50 text-rose-700' : f.sev === 'High' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{f.sev}</span></td>
                      <td className="p-3 text-slate-700">{f.source}</td>
                      <td className="p-3 text-slate-700">{f.label}</td>
                      <td className="p-3"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-800">{f.match}</code></td>
                      <td className="p-3 text-slate-600">{f.why}</td>
                      <td className="p-3 text-[11px] text-slate-400">…{f.excerpt}…</td>
                    </tr>
                  ))}
                  {findings.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-slate-500">Clean.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldAlert size={13} /> This scanner flags phrases for human review. It never auto-edits content or removes legitimate factual statements.</p>
          </div>
        )}
      </div>
    </div>
  );
}