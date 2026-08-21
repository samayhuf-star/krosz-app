import { Layers, Users, Briefcase, GitBranch, Calendar, Bookmark, Tag, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const SECTIONS = [
  ['lead_types', 'Lead Types', Layers],
  ['contact_types', 'Contact Types', Users],
  ['deal_types', 'Deal Types', Briefcase],
  ['pipeline_stages', 'Pipeline Stages', GitBranch],
  ['activity_types', 'Activity Types', Calendar],
  ['appointment_types', 'Appointment Types', Calendar],
  ['customer_statuses', 'Customer Statuses', Bookmark],
  ['tags', 'Tags', Tag],
  ['labels', 'Labels', Tag],
  ['owner_roles', 'Owner Roles', UserCog],
];

export default function CrmBlueprintPanel({ crmBlueprint }) {
  if (!crmBlueprint) return <p className="text-sm text-slate-500">No CRM blueprint available.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {SECTIONS.map(([key, label, Icon]) => (
        <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2"><Icon size={16} className="text-emerald-700" /><h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{label}</h3></div>
          {(crmBlueprint[key]?.length) ? (
            <div className="flex flex-wrap gap-1.5">{crmBlueprint[key].map((x, i) => <Badge key={i} variant="outline" className="border-slate-300 text-slate-700">{x}</Badge>)}</div>
          ) : <p className="text-sm text-slate-400">—</p>}
        </div>
      ))}
    </div>
  );
}