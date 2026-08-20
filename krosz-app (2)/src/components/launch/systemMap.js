import {
  FileText, Globe, LayoutTemplate, Search, Users, Megaphone, Mail, CheckCircle2,
} from 'lucide-react';

// Maps raw workflow task_keys → customer-facing "business system" language.
// The customer never sees the engine's task names; they see friendly systems.
export const SYSTEMS = {
  blueprint: { label: 'Business Blueprint', icon: FileText, blurb: 'Mapping your business' },
  domain: { label: 'Domain', icon: Globe, blurb: 'Choosing the best domain' },
  website: { label: 'Website', icon: LayoutTemplate, blurb: 'Creating your website' },
  seo: { label: 'SEO', icon: Search, blurb: 'Setting up SEO' },
  crm: { label: 'CRM', icon: Users, blurb: 'Building your CRM' },
  marketing: { label: 'Marketing', icon: Megaphone, blurb: 'Preparing marketing' },
  email: { label: 'Business Email', icon: Mail, blurb: 'Setting up business email' },
  communications: { label: 'Business Email', icon: Mail, blurb: 'Setting up business email' },
};

export const systemOf = (key) => SYSTEMS[key] || { label: (key || '').replace(/_/g, ' '), icon: CheckCircle2, blurb: 'Getting it ready' };