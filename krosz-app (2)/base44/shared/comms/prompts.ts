// Communication Hub — AI prompt registry seeds.
//
// The Hub never embeds prompts and never calls an AI provider directly. Every AI
// capability (mailbox recommendation + the email assistant actions) is seeded here
// and executed through the AI Orchestration Engine, which owns prompt versioning,
// Knowledge-Graph context loading, validation and telemetry.

import { latestPrompt, registerPrompt } from '../orchestration/registry.ts';

const summary =
  'You are the Email Assistant for the AI Business Launch OS Communication Hub.\n\n' +
  'Business Knowledge Graph (read-only):\n{{business_context}}\n\n' +
  'EMAIL:\nFrom: {{from_addr}}\nSubject: {{subject}}\nBody:\n{{body}}\n\n' +
  'Summarize this email in 2-3 plain-language sentences for an executive. Return ONLY JSON {summary, urgency (low|normal|high|urgent), needs_reply (boolean), suggested_category (sales|support|finance|hr|general|vip|spam)} grounded strictly in the email contents and the knowledge graph context.';

const draftReply =
  'You are the Email Assistant for the AI Business Launch OS Communication Hub.\n\n' +
  'Business Knowledge Graph (read-only):\n{{business_context}}\n\n' +
  'INBOUND EMAIL:\nFrom: {{from_addr}}\nSubject: {{subject}}\nBody:\n{{body}}\n\n' +
  'Tone guidance: {{tone}}\n\nDraft a reply that is professional, concise and actionable, aligned with the business context. Sign off naturally (do not invent a name; use [Your Team]). Return ONLY JSON {subject, body, tone_assessment}.';

const rewrite =
  'You are the Email Assistant. Rewrite the provided draft for clarity, tone and concision without changing meaning.\n\n' +
  'Business context (read-only):\n{{business_context}}\n\n' +
  'Draft to rewrite:\n{{draft}}\n\n' +
  'Goal: {{tone}}\n\nReturn ONLY JSON {subject, body}.';

const translate =
  'You are the Email Assistant. Translate the provided email body into the target language naturally and professionally.\n\nTarget language: {{target_language}}\nBody:\n{{body}}\n\nReturn ONLY JSON {translated, source_language_guess}.';

const categorize =
  'You are the Email Assistant. Classify the inbound email into a single category and detect urgency.\n\n' +
  'Business context (read-only):\n{{business_context}}\n\n' +
  'Email:\nFrom: {{from_addr}}\nSubject: {{subject}}\nBody:\n{{body}}\n\n' +
  'Return ONLY JSON {ai_category (sales|support|finance|hr|marketing|vip|general|spam), ai_urgency (low|normal|high|urgent), confidence (0-1), rationale}.';

const extractActionItems =
  'You are the Email Assistant. Extract concrete action items from this email.\n\n' +
  'Email:\nSubject: {{subject}}\nBody:\n{{body}}\n\n' +
  'Return ONLY JSON {action_items: [{task, owner_hint, due_hint, priority (low|medium|high)}]}. Empty array if none.';

const extractLead =
  'You are the Email Assistant. Determine whether this email represents a sales lead and extract structured contact data.\n\n' +
  'Business context (read-only):\n{{business_context}}\n\n' +
  'Email:\nFrom: {{from_addr}}\nSubject: {{subject}}\nBody:\n{{body}}\n\n' +
  'Return ONLY JSON {is_lead (boolean), name, email, company, phone, service_interest, intent (informational|commercial|transactional), priority (0-100), notes}. Only populate fields you can see in the email; never invent.';

const suggestNextAction =
  'You are the Email Assistant. Given the email and its current status, suggest the single best next action.\n\n' +
  'Business context (read-only):\n{{business_context}}\n\n' +
  'Email subject: {{subject}}\nCurrent status: {{status}}\nAI category: {{ai_category}}\nBody snippet: {{snippet}}\n\n' +
  'Return ONLY JSON {next_action (one short sentence), suggested_route (crm|support|calendar|kg|reply|none), confidence (0-1)}.';

const mailboxRec =
  'You are the Communication Hub AI. Recommend the mailbox addresses this business should create, based on its approved Blueprint (industry, services, audience).\n\n' +
  'Business Knowledge Graph (read-only):\n{{business_context}}\n\n' +
  'Available standard prefixes: info, contact, support, sales, billing, accounts, admin, careers, hello.\nIndustry-specific examples are illustrative (dental: appointments/insurance/doctor; gym: membership/trainer/nutrition; manufacturer: dispatch/purchase/factory/sales).\n\n' +
  'Return ONLY JSON {mailboxes: [{local_part, label, purpose, category (sales|support|finance|hr|general), is_primary (boolean)}], rationale}. 4-8 items. local_part must be lowercase, no spaces, no domain. Order primary first.';

const SCHEMAS = {
  summary: { type: 'object', additionalProperties: true, properties: { summary: { type: 'string' }, urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, needs_reply: { type: 'boolean' }, suggested_category: { type: 'string', enum: ['sales', 'support', 'finance', 'hr', 'general', 'vip', 'spam'] } }, required: ['summary', 'urgency', 'needs_reply', 'suggested_category'] },
  draft_reply: { type: 'object', additionalProperties: true, properties: { subject: { type: 'string' }, body: { type: 'string' }, tone_assessment: { type: 'string' } }, required: ['subject', 'body'] },
  rewrite: { type: 'object', additionalProperties: true, properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] },
  translate: { type: 'object', additionalProperties: true, properties: { translated: { type: 'string' }, source_language_guess: { type: 'string' } }, required: ['translated'] },
  categorize: { type: 'object', additionalProperties: true, properties: { ai_category: { type: 'string', enum: ['sales', 'support', 'finance', 'hr', 'marketing', 'vip', 'general', 'spam'] }, ai_urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, confidence: { type: 'number' }, rationale: { type: 'string' } }, required: ['ai_category', 'ai_urgency'] },
  extract_action_items: { type: 'object', additionalProperties: true, properties: { action_items: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { task: { type: 'string' }, owner_hint: { type: 'string' }, due_hint: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['task'] } } }, required: ['action_items'] },
  extract_lead: { type: 'object', additionalProperties: true, properties: { is_lead: { type: 'boolean' }, name: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' }, service_interest: { type: 'string' }, intent: { type: 'string', enum: ['informational', 'commercial', 'transactional'] }, priority: { type: 'number' }, notes: { type: 'string' } }, required: ['is_lead'] },
  suggest_next_action: { type: 'object', additionalProperties: true, properties: { next_action: { type: 'string' }, suggested_route: { type: 'string', enum: ['crm', 'support', 'calendar', 'kg', 'reply', 'none'] }, confidence: { type: 'number' } }, required: ['next_action', 'suggested_route'] },
  mailbox_recommendation: { type: 'object', additionalProperties: true, properties: { mailboxes: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { local_part: { type: 'string' }, label: { type: 'string' }, purpose: { type: 'string' }, category: { type: 'string', enum: ['sales', 'support', 'finance', 'hr', 'general'] }, is_primary: { type: 'boolean' } }, required: ['local_part', 'label', 'purpose'] } }, rationale: { type: 'string' } }, required: ['mailboxes', 'rationale'] },
};

const SEEDS = [
  { prompt_id: 'email.summarize', capability: 'EmailAIAssist', module: 'email', variables: ['from_addr', 'subject', 'body'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.summary, content: summary },
  { prompt_id: 'email.draft_reply', capability: 'EmailAIAssist', module: 'email', variables: ['from_addr', 'subject', 'body', 'tone'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.draft_reply, content: draftReply },
  { prompt_id: 'email.rewrite', capability: 'EmailAIAssist', module: 'email', variables: ['draft', 'tone'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.rewrite, content: rewrite },
  { prompt_id: 'email.translate', capability: 'EmailAIAssist', module: 'email', variables: ['body', 'target_language'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.translate, content: translate },
  { prompt_id: 'email.categorize', capability: 'EmailAIAssist', module: 'email', variables: ['from_addr', 'subject', 'body'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.categorize, content: categorize },
  { prompt_id: 'email.extract_action_items', capability: 'EmailAIAssist', module: 'email', variables: ['subject', 'body'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.extract_action_items, content: extractActionItems },
  { prompt_id: 'email.extract_lead', capability: 'EmailAIAssist', module: 'email', variables: ['from_addr', 'subject', 'body'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.extract_lead, content: extractLead },
  { prompt_id: 'email.suggest_next_action', capability: 'EmailAIAssist', module: 'email', variables: ['subject', 'status', 'ai_category', 'snippet'], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.suggest_next_action, content: suggestNextAction },
  { prompt_id: 'email.mailbox_recommendation', capability: 'EmailGeneration', module: 'email', variables: [], default_model: 'automatic', fallback_models: ['gemini_3_flash'], response_schema: SCHEMAS.mailbox_recommendation, content: mailboxRec },
];

/** Idempotently ensure all Communication Hub prompts exist for a tenant. */
export async function ensureCommsPrompts(svc: any, tenantId: string): Promise<void> {
  if (!tenantId) return;
  for (const s of SEEDS) {
    try {
      const exists = await latestPrompt(svc, s.prompt_id, tenantId);
      if (!exists) await registerPrompt(svc, { ...s, tenant_id: tenantId, status: 'approved' } as any);
    } catch {
      // never block a flow on prompt seeding
    }
  }
}