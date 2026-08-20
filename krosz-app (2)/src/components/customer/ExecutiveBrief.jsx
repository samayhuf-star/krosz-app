import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sun, Users, Mail, Globe, AlertCircle, Clock, Sparkles, Loader2, RefreshCw } from 'lucide-react';

function within24h(ts) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < 24 * 3600 * 1000;
}

function todayLabel() {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return { greeting: `Good ${part}`, date };
}

export default function ExecutiveBrief({ business, data, counts, health, userName }) {
  const newLeads = data.leads.filter((l) => within24h(l.created_date)).length;
  const newEmails = data.messages.filter((m) => within24h(m.received_at || m.created_at)).length;
  const pendingApprovals = data.launchTasks.filter((t) => t.status === 'awaiting_approval').length;
  const openPipeline = data.leads.filter((l) => !['won', 'lost'].includes(l.status || 'new')).reduce((s, l) => s + (Number(l.value) || 0), 0);
  const websiteStatus = counts.websitePublished ? 'Published' : counts.websiteDrafted ? 'Drafted' : 'Not built';
  const { greeting, date } = todayLabel();

  const q = useQuery({
    queryKey: ['executive-brief', business?.id, newLeads, newEmails, pendingApprovals, counts.websitePublished, health?.scores?.overall],
    queryFn: async () => {
      const prompt = `You are the AI Executive Assistant inside a Business Operating System. Write a 1-2 sentence morning briefing (plain text, no emoji, no markdown, friendly but concise) for the owner of "${business?.name || 'the business'}".
Today's numbers: ${newLeads} new lead(s), ${newEmails} new email(s), website ${websiteStatus.toLowerCase()}, ${counts.needsReply} email(s) need a reply, ${pendingApprovals} pending approval(s), ${openPipeline ? '$' + openPipeline + ' open pipeline' : 'no open pipeline'}, business health ${health?.scores?.overall ?? 0}/100.
Open with the single most important thing they should know, then the one thing to act on. Max 40 words.`;
      const res = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: { type: 'object', properties: { brief: { type: 'string' } }, required: ['brief'] } });
      return res?.brief || res;
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  const healthScore = health?.scores?.overall ?? 0;
  const chips = [
    { icon: Users, label: 'New leads', value: newLeads, tone: 'text-violet-600' },
    { icon: Mail, label: 'New emails', value: newEmails, tone: 'text-emerald-600' },
    { icon: AlertCircle, label: 'Needs reply', value: counts.needsReply, tone: counts.needsReply ? 'text-amber-600' : 'text-slate-400' },
    { icon: Clock, label: 'Pending approvals', value: pendingApprovals, tone: pendingApprovals ? 'text-amber-600' : 'text-slate-400' },
    { icon: Globe, label: 'Website', value: websiteStatus, tone: websiteStatus === 'Published' ? 'text-emerald-600' : websiteStatus === 'Drafted' ? 'text-amber-600' : 'text-slate-400' },
    { icon: Sparkles, label: 'Business health', value: `${healthScore}/100`, tone: healthScore >= 50 ? 'text-emerald-600' : healthScore > 0 ? 'text-amber-600' : 'text-slate-400' },
  ];

  return (
    <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-600"><Sun size={20} /></span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{greeting}, {date}</p>
            <h1 className="text-2xl font-semibold text-slate-900">{userName}</h1>
            <p className="text-sm text-slate-500">{business?.name}</p>
          </div>
        </div>
        {q.isFetching ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <button onClick={() => q.refetch()} className="text-slate-400 hover:text-slate-600"><RefreshCw size={15} /></button>}
      </div>

      <div className="mt-4 rounded-2xl bg-violet-50/60 p-4">
        <div className="flex items-start gap-2">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-violet-600" />
          {q.isLoading ? <p className="text-sm text-slate-400">Reading your business state…</p>
            : q.isError ? <p className="text-sm text-slate-500">Welcome back. Check below for what needs your attention.</p>
            : <p className="text-sm leading-6 text-slate-700">{q.data}</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {chips.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-slate-100 bg-white p-2.5">
              <Icon size={15} className={c.tone} />
              <p className="mt-1.5 truncate text-base font-semibold text-slate-900">{c.value}</p>
              <p className="truncate text-[11px] text-slate-500">{c.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}