import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Users, Globe, LayoutTemplate, Search, Mail,
  MessageCircle, Bot, ListChecks, CheckCircle2, Circle, ChevronRight,
} from 'lucide-react';

function within24h(ts) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < 24 * 3600 * 1000;
}

function Row({ label, ok }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className={ok ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
      {ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className="text-slate-200" />}
    </div>
  );
}

function Card({ title, icon: Icon, to, span, children }) {
  const navigate = useNavigate();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(to)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(to)}
      className={`group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md ${span || ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
            <Icon size={18} />
          </span>
          <span className="text-sm font-semibold text-slate-900">{title}</span>
        </span>
        <ChevronRight size={16} className="text-slate-300 group-hover:text-emerald-600" />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <span className="flex flex-col">
      <b className="text-sm font-semibold text-slate-900">{value}</b>
      <span className="text-[11px] text-slate-500">{label}</span>
    </span>
  );
}

export default function BusinessOsBento({ data, counts }) {
  const newEmails = (data.messages || []).filter((m) => within24h(m.received_at || m.created_at)).length;
  const approvals = (data.launchTasks || []).filter((t) => t.status === 'awaiting_approval').length;
  const tasks = (data.launchTasks || []).slice(0, 5);

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Business OS</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Analytics" icon={BarChart3} to="/insights" span="sm:col-span-2 lg:col-span-2">
          <div className="mb-3 flex gap-5 border-b border-slate-100 pb-3">
            <Stat value={counts.leads} label="New leads" />
            <Stat value={counts.needsReply} label="Needs reply" />
            <Stat value={approvals} label="Pending approvals" />
          </div>
          <div className="grid grid-cols-2 gap-x-5">
            <Row label="Visitors" ok={false} />
            <Row label="Leads" ok={(counts.leads || 0) > 0} />
            <Row label="Calls" ok={false} />
            <Row label="Emails" ok={(counts.messages || 0) > 0} />
            <Row label="Conversion rate" ok={false} />
          </div>
        </Card>

        <Card title="Leads" icon={Users} to="/customers">
          <div className="mb-3 border-b border-slate-100 pb-3">
            <Stat value={newEmails} label="New emails" />
          </div>
          <Row label="CRM" ok={(counts.leads || 0) > 0} />
          <Row label="Lead scoring" ok={(counts.leads || 0) > 0} />
          <Row label="Pipeline" ok={(counts.leads || 0) > 0} />
        </Card>

        <Card title="Domain" icon={Globe} to="/domains">
          <Row label="Domain" ok={counts.domainActive} />
          <Row label="DNS" ok={counts.domainActive} />
          <Row label="SSL" ok={counts.domainActive} />
          <Row label="Renewals" ok={false} />
        </Card>

        <Card title="Website" icon={LayoutTemplate} to="/website">
          <Row label="Edit website" ok={counts.websiteDrafted} />
          <Row label="AI redesign" ok={counts.websiteDrafted} />
        </Card>

        <Card title="SEO" icon={Search} to="/seo">
          <Row label="Landing pages" ok={(counts.seoPages || 0) > 0} />
        </Card>

        <Card title="Email" icon={Mail} to="/communications" span="lg:col-span-2">
          <Row label="Inbox" ok={(counts.messages || 0) > 0} />
          <Row label="AI replies" ok={(counts.aiExecs || 0) > 0} />
          <Row label="Follow-ups" ok={(counts.needsReply || 0) > 0} />
          <Row label="Email campaigns" ok={false} />
        </Card>

        <Card title="WhatsApp" icon={MessageCircle} to="/communications">
          <Row label="Connect channel" ok={false} />
        </Card>

        <Card title="AI Agents" icon={Bot} to="/assistant" span="lg:col-span-2">
          <div className="grid grid-cols-2 gap-x-5">
            <Row label="Sales agent" ok={(counts.aiExecs || 0) > 0} />
            <Row label="Email agent" ok={(counts.aiExecs || 0) > 0} />
            <Row label="Support agent" ok={(counts.aiExecs || 0) > 0} />
            <Row label="SEO agent" ok={(counts.aiExecs || 0) > 0} />
          </div>
        </Card>

        <Card title="Checklist" icon={ListChecks} to="/launch" span="sm:col-span-2 lg:col-span-2">
          {tasks.length ? (
            tasks.map((t) => <Row key={t.id || t.step_id} label={t.name} ok={t.status === 'completed'} />)
          ) : (
            <p className="text-sm text-slate-400">No launch tasks yet.</p>
          )}
        </Card>
      </div>
    </section>
  );
}