import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Globe, Rocket, Mail, Users, Sparkles, ArrowRight } from 'lucide-react';

// Deterministically picks the SINGLE most important next action from the
// current business state. The AI prepares everything; the user clicks "Do it"
// to land on the surface where the action is staged (never auto-run).
export function pickNextBestAction(data, counts) {
  const candidates = [];

  const awaiting = (data.launchTasks || []).filter((t) => t.status === 'awaiting_approval');
  if (awaiting.length) {
    candidates.push({ weight: 100, label: `Approve: ${awaiting[0].name || 'pending step'}`, reason: `${awaiting.length} step${awaiting.length > 1 ? 's' : ''} waiting for your approval.`, to: '/launch', icon: CheckCircle2, tone: 'amber' });
  }
  if (!counts.domainActive) {
    candidates.push({ weight: 92, label: 'Register your domain', reason: 'Your business needs a live web address to go online.', to: '/domains', icon: Globe, tone: 'emerald' });
  }
  if (counts.websiteDrafted && !counts.websitePublished) {
    candidates.push({ weight: 86, label: 'Publish your website', reason: 'Your website is drafted and ready to go live.', to: '/website', icon: Rocket, tone: 'sky' });
  }
  if ((counts.needsReply || 0) >= 3) {
    candidates.push({ weight: 80, label: `Reply to ${counts.needsReply} important emails`, reason: 'Customers are waiting for a response.', to: '/communications', icon: Mail, tone: 'violet' });
  }
  const newLeads = (data.leads || []).filter((l) => (l.status || 'new') === 'new').length;
  if (newLeads >= 5) {
    candidates.push({ weight: 72, label: `Follow up with ${newLeads} new leads`, reason: 'Fresh leads cool down fast — reach out today.', to: '/customers', icon: Users, tone: 'rose' });
  }

  if (!candidates.length) {
    return { label: 'Keep the momentum going', reason: "Everything's healthy. Explore AI recommendations to grow further.", to: '/insights', icon: Sparkles, tone: 'slate' };
  }
  return candidates.sort((a, b) => b.weight - a.weight)[0];
}

const TONES = {
  amber: 'bg-amber-100 text-amber-600', emerald: 'bg-emerald-100 text-emerald-600',
  sky: 'bg-sky-100 text-sky-600', violet: 'bg-violet-100 text-violet-600',
  rose: 'bg-rose-100 text-rose-600', slate: 'bg-slate-100 text-slate-600',
};

export default function NextBestAction({ action, loading }) {
  const navigate = useNavigate();
  if (loading || !action) {
    return <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />;
  }
  const Icon = action.icon;
  return (
    <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Next best action</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${TONES[action.tone] || TONES.slate}`}><Icon size={22} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-900">{action.label}</h2>
          <p className="text-sm text-slate-500">{action.reason}</p>
        </div>
        <button onClick={() => navigate(action.to)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700">
          Do it <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}