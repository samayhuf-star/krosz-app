import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import FieldEditor from './FieldEditor';

function summary(value) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') {
    const c = Object.values(value).filter((v) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : true)).length;
    return `${Object.keys(value).length} part${Object.keys(value).length === 1 ? '' : 's'}`;
  }
  return '';
}

export default function BlueprintSection({ sectionKey, title, icon: Icon, value, onChange, readOnly }) {
  return (
    <AccordionItem value={sectionKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <AccordionTrigger className="flex items-center gap-3 px-5 py-4 hover:no-underline hover:bg-slate-50">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon size={18} /></span>
        <span className="flex-1 text-left">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          <span className="block text-xs text-slate-500">{indexLabel(sectionKey)}</span>
        </span>
        {summary(value) && <Badge variant="secondary" className="mr-2">{summary(value)}</Badge>}
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5 pt-1">
        <FieldEditor value={value} onChange={onChange} label={sectionKey} readOnly={readOnly} />
      </AccordionContent>
    </AccordionItem>
  );
}

const LABELS = {
  business_profile: 'Identity, mission, vision & positioning',
  target_audience: 'Who you serve — personas, problems, goals',
  branding: 'Tone, voice, colors & typography',
  services: 'What you offer — each with its own CTA',
  website_blueprint: 'Complete site architecture (no HTML)',
  seo_blueprint: 'Keywords, clusters & content strategy',
  crm_blueprint: 'Pipelines, forms & follow-up',
  email_blueprint: 'Mailboxes & their purposes',
  phone_blueprint: 'Recommended numbers',
  ai_agent_blueprint: 'Agents, knowledge & escalation',
  build_estimate: 'Scope, time & cost',
};
function indexLabel(k) { return LABELS[k] || ''; }