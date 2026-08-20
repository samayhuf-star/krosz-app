// AI Mailbox templates — deterministic library of standard + industry-specific
// mailbox sets. Used as a fallback when the AI recommendation is unavailable and
// as the seed list the AI edits (add/remove/rename) for a specific business.

export interface MailboxTemplate { local_part: string; label: string; purpose: string; industry: string; }

export const STANDARD_PREFIXES: MailboxTemplate[] = [
  { local_part: 'info', label: 'Information', purpose: 'General inquiries — primary contact point.', industry: 'standard' },
  { local_part: 'contact', label: 'Contact', purpose: 'Public contact form / website CTA.', industry: 'standard' },
  { local_part: 'support', label: 'Support', purpose: 'Customer support tickets and help requests.', industry: 'standard' },
  { local_part: 'sales', label: 'Sales', purpose: 'Quotations, pricing, new business leads.', industry: 'standard' },
  { local_part: 'billing', label: 'Billing', purpose: 'Invoices, payments, remittance.', industry: 'standard' },
  { local_part: 'accounts', label: 'Accounts', purpose: 'Account management & reconciliation.', industry: 'standard' },
  { local_part: 'admin', label: 'Admin', purpose: 'Internal / administrative.', industry: 'standard' },
  { local_part: 'careers', label: 'Careers', purpose: 'Job applications and recruitment.', industry: 'standard' },
  { local_part: 'hello', label: 'Hello', purpose: 'Friendly front-door alias.', industry: 'standard' },
];

export const INDUSTRY_TEMPLATES: Record<string, MailboxTemplate[]> = {
  dental: [
    { local_part: 'appointments', label: 'Appointments', purpose: 'Booking & rescheduling visits.', industry: 'dental' },
    { local_part: 'insurance', label: 'Insurance', purpose: 'Insurance verification & claims.', industry: 'dental' },
    { local_part: 'doctor', label: 'Doctor Direct', purpose: 'Direct line to the practitioner.', industry: 'dental' },
  ],
  gym: [
    { local_part: 'membership', label: 'Membership', purpose: 'Membership signups, freezes, cancellations.', industry: 'gym' },
    { local_part: 'trainer', label: 'Trainer', purpose: 'Personal-training bookings.', industry: 'gym' },
    { local_part: 'nutrition', label: 'Nutrition', purpose: 'Nutrition planning & meal plans.', industry: 'gym' },
  ],
  manufacturer: [
    { local_part: 'dispatch', label: 'Dispatch', purpose: 'Shipping & logistics coordination.', industry: 'manufacturer' },
    { local_part: 'purchase', label: 'Purchase', purpose: 'Procurement & purchase orders.', industry: 'manufacturer' },
    { local_part: 'factory', label: 'Factory', purpose: 'Production & plant floor comms.', industry: 'manufacturer' },
    { local_part: 'sales', label: 'Sales', purpose: 'B2B wholesale & distributor sales.', industry: 'manufacturer' },
  ],
  hospitality: [
    { local_part: 'reservations', label: 'Reservations', purpose: 'Room/table bookings.', industry: 'hospitality' },
    { local_part: 'concierge', label: 'Concierge', purpose: 'Guest services.', industry: 'hospitality' },
    { local_part: 'events', label: 'Events', purpose: 'Events & banquets.', industry: 'hospitality' },
  ],
  retail: [
    { local_part: 'orders', label: 'Orders', purpose: 'Order status & returns.', industry: 'retail' },
    { local_part: 'returns', label: 'Returns', purpose: 'Returns & exchanges.', industry: 'retail' },
  ],
  legal: [
    { local_part: 'intake', label: 'Intake', purpose: 'New client intake forms.', industry: 'legal' },
    { local_part: 'dockets', label: 'Dockets', purpose: 'Court & filing correspondence.', industry: 'legal' },
  ],
};

export function defaultMailboxSet(industry: string): MailboxTemplate[] {
  const ind = (industry || 'standard').toLowerCase();
  const extra = INDUSTRY_TEMPLATES[ind] || [];
  const seen = new Set(STANDARD_PREFIXES.map((m) => m.local_part));
  const merged = [...STANDARD_PREFIXES];
  for (const m of extra) if (!seen.has(m.local_part)) { merged.push(m); seen.add(m.local_part); }
  return merged;
}

// Default routings feed the Automations + AI categories.
export const MAILBOX_TO_CATEGORY: Record<string, string> = {
  sales: 'sales', purchase: 'sales', orders: 'sales', dispatch: 'sales',
  support: 'support', help: 'support', returns: 'support',
  billing: 'finance', accounts: 'finance', insurance: 'finance',
  careers: 'hr', intake: 'hr', dockets: 'hr',
  info: 'general', contact: 'general', hello: 'general', admin: 'general',
  appointments: 'general', reservations: 'general',
  trainer: 'general', membership: 'general', nutrition: 'general',
  factory: 'general', concierge: 'general', events: 'general',
};