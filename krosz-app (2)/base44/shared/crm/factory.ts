// AI CRM Factory — shared pipeline stages. Consumes ONLY the approved Business
// Blueprint + the published Website + the approved SEO Version. Never re-reads the
// customer, never regenerates the blueprint/website/SEO. Reusable by future Email /
// Phone / Support / Chatbot engines that depend on the CRM configuration.

import { blueprintContext as bpCtxRaw } from '../website/factory.ts';

export const ACTOR_UNKNOWN = 'system';
export function actorName(u: any): string { return (u && (u.full_name || u.email)) || (u && u.id) || ACTOR_UNKNOWN; }

export const CRM_PROMPT_VERSION = 'crm-prompt-v1';
export const CRM_AI_PROVIDER = 'base44-core';
export const CRM_AI_MODEL = 'automatic';

export type LLM = (prompt: string, schema: any) => Promise<any>;

export function blueprintContext(bp: any): string {
  return bpCtxRaw(bp);
}

export function seoContext(seo: any): string {
  const v = seo?.version || {};
  const sum = v.summary || {};
  const keywords = (seo?.keywords || []).slice(0, 30).map((k: any) => `${k.keyword}[${k.type}/${k.search_intent}]`).join(', ');
  const clusters = (seo?.clusters || []).map((c: any) => c.topic).join(', ');
  const localPages = (sum.location_pages || []).map((l: any) => `${l.slug}(${l.intent})`).join(', ');
  return `APPROVED SEO PROGRAM (v${v.version || 1}, health ${v.health_score || 'n/a'}):
Keywords (${seo?.keywords?.length || 0}): ${keywords}
Content clusters: ${clusters}
Local landing pages: ${localPages || 'none'}
Primary CTAs by page drive lead capture — align CRM lead sourcing and scoring to these intents.`;
}

export function provenance(t0: number, llmCalls: number, status = 'complete') {
  const estimated_tokens = llmCalls * 1500;
  return {
    ai_provider: CRM_AI_PROVIDER,
    ai_model: CRM_AI_MODEL,
    prompt_version: CRM_PROMPT_VERSION,
    generation_time_ms: Date.now() - t0,
    token_usage: { llm_calls: llmCalls, estimated_tokens, is_estimated: true },
    estimated_cost: +(estimated_tokens * 0.0000012).toFixed(4),
    is_estimated: true,
    generation_status: status,
  };
}

const str = { type: 'string' };
const obj = (props: any, required: string[] = []) => ({ type: 'object', additionalProperties: true, properties: props, required });
const arr = (items: any) => ({ type: 'array', items });
const num = { type: 'number' };

// ---------- STAGE 1: BUSINESS ANALYSIS ----------
export const ANALYSIS_SCHEMA = obj({
  industry: str, vertical_segment: str,
  services: arr(str),
  target_audience: arr(str),
  customer_journey: arr(obj({ step: str, description: str, touchpoint: str }, ['step', 'description'])),
  lead_sources: arr(str),
  sales_cycle: obj({ duration: str, complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] }, decision_maker: str }, ['duration']),
  business_goals: arr(str),
  pain_points: arr(str),
  industry_notes: str,
}, ['industry', 'lead_sources', 'sales_cycle']);

export async function stageBusinessAnalysis(llm: LLM, bp: any, seo: any): Promise<any> {
  const data = await llm(
    `You are a senior business analyst translating the approved Business Blueprint into a CRM-ready business analysis. ${blueprintContext(bp)}
${seoContext(seo)}
Use the blueprint's crm_blueprint section (lead_stages, lead_sources, contact_fields, follow_up_pipeline, appointment_requirements) as the authoritative seed — expand it, never contradict it.
Return JSON: industry, vertical_segment (e.g. "Boutique Fitness", "Dental Services", "Enterprise B2B SaaS"); services (list); target_audience (list); customer_journey (5-8 ordered steps each {step, description, touchpoint}); lead_sources (specific to this industry — website forms, calls, walk-ins, referrals, ads, SEO landing pages, partners); sales_cycle {duration (e.g. "1-7 days"), complexity, decision_maker}; business_goals (3-5); pain_points (3-5); industry_notes (one-line on what makes this industry's CRM special). Ground everything in the blueprint. No placeholders.`,
    ANALYSIS_SCHEMA,
  );
  if (!data || !data.industry || !Array.isArray(data.lead_sources)) throw new Error('Business Analysis stage returned incomplete data.');
  return data;
}

// ---------- STAGE 2: CRM BLUEPRINT ----------
const fieldDef = obj({ key: str, label: str, type: str, required: { type: 'boolean' }, options: arr(str), hint: str }, ['key', 'label']);

export const CRM_BP_SCHEMA = obj({
  lead_types: arr(str), contact_types: arr(str), deal_types: arr(str),
  pipeline_stages: arr(str), activity_types: arr(str), appointment_types: arr(str),
  customer_statuses: arr(str), tags: arr(str), labels: arr(str), owner_roles: arr(str),
  lead_fields: arr(fieldDef),
  contact_profile: obj({ sections: arr(obj({ name: str, fields: arr(fieldDef) }, ['name'])) }, ['sections']),
}, ['lead_types', 'pipeline_stages', 'owner_roles', 'lead_fields', 'contact_profile']);

export async function stageCrmBlueprint(llm: LLM, bp: any, analysis: any): Promise<any> {
  const crmSeed = (bp?.blueprint || bp || {})?.crm_blueprint || {};
  const data = await llm(
    `You are a CRM architect designing the concrete data model for this business. ${blueprintContext(bp)}
Business analysis: ${JSON.stringify({ industry: analysis.industry, sales_cycle: analysis.sales_cycle, lead_sources: analysis.lead_sources, customer_journey: analysis.customer_journey })}
Blueprint CRM seed (authoritative — ${JSON.stringify(crmSeed)}):
Return JSON: lead_types (e.g. ["Trial","Membership Inquiry","Consultation","Referral"]), contact_types (e.g. ["Prospect","Member","Patient","Patient","Client","Vendor"]), deal_types (e.g. ["Membership","Treatment Plan","Retainer","Subscription"]), pipeline_stages (ordered human stage names — derive from the blueprint's lead_stages/follow_up_pipeline), activity_types (e.g. ["Call","Email","Meeting","Trial Session","Appointment","Follow-up","Note"]), appointment_types (e.g. ["Trial Booking","Consultation","Follow-up","Review","Renewal"]), customer_statuses (e.g. ["Lead","Active","Churned","Lost","Champion"]), tags (industry-specific), labels, owner_roles (e.g. ["Sales Rep","Membership Advisor","Front Desk","Dentist","Account Executive","CSM"]). Also generate lead_fields: an array of custom lead fields SPECIFIC to this industry (e.g. Gym→["membership_plan","preferred_location","fitness_goal"], Real Estate→["property_type","budget","preferred_city","possession"], Dentist→["treatment_interest","insurance_provider","preferred_slot"], Auto→["vehicle_model","insurance_renewal"], B2B→["company_size","annual_revenue"]). Each field: {key (snake_case), label (human), type ("text"|"number"|"select"|"multiselect"|"date"|"phone"|"email"|"boolean"), required (bool), options (for select/multiselect, [] otherwise), hint}. Generate 5-9 fields.
Also generate contact_profile: { sections: [ {name, fields:[...]} ] } grouping the customer profile into sections (Personal, Business, Communication, Preferences, History, Tags). Each field same shape as lead_fields. Cover personal (name, phone, email, address), business (company, designation), communication (preferred_channel, best_time), preferences (opt_in, language), history (lifetime_value, last_contact), tags (interest tags). Everything editable later — be specific to THIS industry, not generic CRM boilerplate.`,
    CRM_BP_SCHEMA,
  );
  if (!data || !Array.isArray(data.lead_types) || !Array.isArray(data.pipeline_stages) || !Array.isArray(data.lead_fields)) throw new Error('CRM Blueprint stage returned incomplete data.');
  return data;
}

// ---------- STAGE 3: PIPELINE GENERATOR ----------
export const PIPELINE_SCHEMA = obj({
  name: str, description: str,
  stages: arr(obj({
    key: str, name: str, description: str, order: { type: 'number' }, probability: { type: 'number' },
    entry_criteria: str, exit_criteria: str, owner_role: str, automation_hint: str, sla_hours: { type: 'number' },
  }, ['key', 'name', 'order'])),
}, ['name', 'stages']);

export async function stagePipeline(llm: LLM, bp: any, analysis: any, crmBp: any): Promise<any> {
  const data = await llm(
    `You are a sales pipeline architect. Build the ONE primary sales pipeline for this industry's customer journey. ${blueprintContext(bp)}
Business analysis: ${JSON.stringify({ industry: analysis.industry, sales_cycle: analysis.sales_cycle, customer_journey: analysis.customer_journey.map((s: any) => s.step) })}
Available pipeline stage names (from CRM blueprint analysis): ${JSON.stringify(crmBp.pipeline_stages)}
Owner roles available: ${JSON.stringify(crmBp.owner_roles)}
Return JSON: name (e.g. "Membership Pipeline", "Patient Pipeline", "Client Pipeline"), description, and an ordered stages array (4-9 stages). Each stage: key (snake_case), name (human), description, order (1..N), probability (0-100 win probability at this stage), entry_criteria, exit_criteria, owner_role (from the list), automation_hint (one-line on the automation triggered here), sla_hours (max time a lead should linger).
Industry examples to follow literally: Gym → Lead → Trial → Visit → Membership → PT Upsell → Renewal. Dentist → Appointment → Treatment → Follow-up → Review Request. Law Firm → Consultation → Case Review → Proposal → Retainer → Client. Restaurant → Reservation → Visit → Repeat Customer → Loyalty. Keep stages deterministic and grounded in this business's real journey — no generic "Qualified" filler unless it belongs.`,
    PIPELINE_SCHEMA,
  );
  if (!data || !Array.isArray(data.stages) || data.stages.length < 3) throw new Error('Pipeline Generator returned too few stages.');
  data.stages = data.stages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)).map((s: any, i: number) => ({ ...s, order: i + 1 }));
  return data;
}

// ---------- STAGE 4: LEAD SCORING ----------
export const SCORING_SCHEMA = obj({
  thresholds: obj({ hot: { type: 'number' }, warm: { type: 'number' }, cold: { type: 'number' }, qualified: { type: 'number' }, disqualify_below: { type: 'number' } }, ['hot', 'warm', 'cold']),
  rules: arr(obj({
    rule_key: str, field: str, operator: { type: 'string', enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'in_services', 'in_location', 'source_is', 'intent_is'] },
    value: str, points: { type: 'number' }, reason: str,
  }, ['rule_key', 'field', 'operator'])),
}, ['rules']);

export async function stageLeadScoring(llm: LLM, bp: any, analysis: any, pipeline: any): Promise<any> {
  const data = await llm(
    `You are a revenue operations lead designing lead scoring. ${blueprintContext(bp)}
Business: ${analysis.industry} — lead sources: ${JSON.stringify(analysis.lead_sources)} — pipeline stages: ${JSON.stringify(pipeline.stages.map((s: any) => s.name))}
Return JSON: thresholds {hot (e.g. 70), warm (e.g. 40), cold (e.g. 10), qualified (e.g. 50), disqualify_below (e.g. 0)} and a rules array (10-18 rules) each {rule_key (snake_case), field (lead attribute e.g. "source","service_interest","location","budget","intent","page_visited","form_completed"), operator, value, points (positive for good, negative for disqualifiers), reason (one line)}.
Example scoring for a gym: source=referral +25, service_interest=personal_training +20, page_visited=pricing +10, intent=transactional +30, no_email_provided -15. Bind each rule to realistic lead attributes for this industry.`,
    SCORING_SCHEMA,
  );
  if (!data || !Array.isArray(data.rules) || !data.rules.length) throw new Error('Lead Scoring returned no rules.');
  return data;
}

// ---------- STAGE 5: AUTOMATION ENGINE (definitions only — no emails sent) ----------
export const AUTOMATIONS_SCHEMA = obj({
  automations: arr(obj({
    name: str, trigger: { type: 'string', enum: ['lead_created', 'stage_changed', 'lead_scored', 'form_submitted', 'task_overdue', 'appointment_scheduled', 'appointment_missed', 'inactivity', 'no_progress'] },
    trigger_stage: str, conditions: arr(str), actions: arr(obj({ action: str, detail: str }, ['action'])),
    owner_role: str,
  }, ['name', 'trigger', 'actions'])),
}, ['automations']);

export async function stageAutomations(llm: LLM, bp: any, analysis: any, pipeline: any, scoring: any): Promise<any> {
  const data = await llm(
    `You are a CRM automation designer. Generate automation DEFINITIONS only — do NOT send any messages. ${blueprintContext(bp)}
Pipeline: ${JSON.stringify(pipeline.stages.map((s: any) => s.name))}
Scoring thresholds: ${JSON.stringify(scoring.thresholds)}
Lead sources: ${JSON.stringify(analysis.lead_sources)}
Return a ${pipeline.stages.length > 6 ? '7-12' : '5-9'} automations array. Each: name, trigger, trigger_stage (optional pipeline stage), conditions (list of criteria strings), actions (array of {action, detail} — use action verbs like "assign_owner", "set_stage", "send_welcome_email", "create_task", "notify", "schedule_reminder", "request_review", "update_status" — describe the detail not the literal payload), owner_role.
Cover the full lifecycle: new lead → assignment → welcome → follow-up reminders → no-progress re-engagement → appointment → post-appointment → renewal/referral. All stage references must match the pipeline stage names above.`,
    AUTOMATIONS_SCHEMA,
  );
  if (!data || !Array.isArray(data.automations) || !data.automations.length) throw new Error('Automation Engine returned no rules.');
  return data;
}

// ---------- STAGE 6: TASK ENGINE ----------
export const TASKS_SCHEMA = obj({
  tasks: arr(obj({
    name: str, type: { type: 'string', enum: ['daily', 'follow_up', 'call', 'meeting', 'renewal', 'reminder', 'escalation', 'review_request'] },
    trigger: str, owner_role: str, due_offset_hours: { type: 'number' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, description: str, escalation_hours: { type: 'number' },
  }, ['name', 'type'])),
}, ['tasks']);

export async function stageTasks(llm: LLM, bp: any, analysis: any, pipeline: any): Promise<any> {
  const data = await llm(
    `You are a sales operations task designer. Generate the task templates that keep leads moving through the pipeline. ${blueprintContext(bp)}
Pipeline: ${JSON.stringify(pipeline.stages.map((s: any) => ({ name: s.name, sla_hours: s.sla_hours })))}
Sales cycle: ${analysis.sales_cycle.duration} (${analysis.sales_cycle.complexity})
Return a ${pipeline.stages.length + 3}-to-${pipeline.stages.length + 8} tasks array. Each: name, type (follow_up, call, meeting, renewal, reminder, escalation, review_request, daily), trigger (event or cadence, e.g. "stage:Appointment +24h", "lead_duplicate_in_*"), owner_role, due_offset_hours (when the task becomes due, relative to trigger — 0 for immediate), priority, description (the rep's instructions), escalation_hours (when an overdue task escalates).
Cover every stage boundary — leads must have a clear next action, never idle. Add a daily pipeline-hygiene task and an SLA-escalation task.`,
    TASKS_SCHEMA,
  );
  if (!data || !Array.isArray(data.tasks) || !data.tasks.length) throw new Error('Task Engine returned no templates.');
  return data;
}

// ---------- STAGE 7 + 8: DASHBOARD WIDGETS & REPORTS (deterministic) ----------
export function buildDashboard(pipeline: any, scoring: any, analysis: any): any[] {
  const buckets = [
    { key: 'new_leads', title: 'New Leads', metric: 'new_leads', data_source: 'leads.created', size: 'sm', icon_hint: 'UserPlus', config: { unit: 'count', period: '7d' } },
    { key: 'qualified_leads', title: 'Qualified Leads', metric: 'qualified_leads', data_source: 'leads.score >= qualified', size: 'sm', icon_hint: 'BadgeCheck', config: { unit: 'count', threshold: scoring?.thresholds?.qualified ?? 50 } },
    { key: 'pipeline_value', title: 'Pipeline Value', metric: 'pipeline_value', data_source: 'deals.weighted_value', size: 'sm', icon_hint: 'DollarSign', config: { unit: 'currency' } },
    { key: 'conversion_rate', title: 'Conversion Rate', metric: 'conversion_rate', data_source: 'leads.won / leads.total', size: 'sm', icon_hint: 'TrendingUp', config: { unit: 'percent' } },
    { key: 'tasks_due', title: 'Tasks Due', metric: 'tasks_due', data_source: 'tasks.due_today', size: 'sm', icon_hint: 'CheckSquare', config: { unit: 'count', period: 'today' } },
    { key: 'upcoming_meetings', title: 'Upcoming Meetings', metric: 'upcoming_meetings', data_source: 'appointments.next_7d', size: 'sm', icon_hint: 'CalendarClock', config: { unit: 'count', period: '7d' } },
    { key: 'stage_distribution', title: 'Pipeline Stage Distribution', metric: 'stage_distribution', data_source: 'leads.group_by_stage', size: 'lg', icon_hint: 'Filter', config: { stages: pipeline.stages.map((s: any) => s.name) } },
    { key: 'lead_sources', title: 'Lead Sources', metric: 'lead_sources', data_source: 'leads.group_by_source', size: 'md', icon_hint: 'GitBranch', config: { sources: analysis.lead_sources } },
    { key: 'top_services', title: 'Top Services', metric: 'top_services', data_source: 'leads.group_by_service', size: 'md', icon_hint: 'Award', config: { services: analysis.services } },
  ];
  return buckets.map((w, i) => ({ ...w, order: i + 1 }));
}

export function buildReports(pipeline: any, analysis: any): any[] {
  const stages = pipeline.stages.map((s: any) => s.name);
  return [
    { key: 'lead_source_report', title: 'Lead Source Report', type: 'lead_source', description: 'Leads & conversions grouped by acquisition source for attribution.', schedule: 'weekly', data_source: 'leads.sources', config: { sources: analysis.lead_sources } },
    { key: 'conversion_report', title: 'Conversion Report', type: 'conversion', description: 'Stage-to-stage conversion rates across the pipeline.', schedule: 'weekly', data_source: 'leads.stage_transitions', config: { stages } },
    { key: 'sales_funnel', title: 'Sales Funnel', type: 'sales_funnel', description: 'Pipeline funnel with deal counts and values per stage.', schedule: 'monthly', data_source: 'deals.funnel', config: { stages } },
    { key: 'pipeline_health', title: 'Pipeline Health', type: 'pipeline_health', description: 'Average lead velocity, SLA breaches, and stale-deal detection.', schedule: 'daily', data_source: 'leads.health', config: { stages, sla_hours_default: 48 } },
    { key: 'task_completion', title: 'Task Completion', type: 'task_completion', description: 'Owner task completion rates and overdue backlog.', schedule: 'daily', data_source: 'tasks.completion', config: {} },
    { key: 'service_performance', title: 'Service Performance', type: 'service_performance', description: 'Revenue and win-rate by service line.', schedule: 'monthly', data_source: 'deals.by_service', config: { services: analysis.services } },
  ];
}

// ---------- STAGE 7.5: EMAIL TEMPLATES ----------
export const EMAIL_TEMPLATES_SCHEMA = obj({
  templates: arr(obj({
    key: str, name: str,
    type: { type: 'string', enum: ['welcome', 'quotation', 'reminder', 'follow_up', 'thank_you', 're_engagement', 'appointment_confirmation'] },
    subject: str, body: str,
    channel: { type: 'string', enum: ['email', 'whatsapp', 'sms'] },
    trigger: str, owner_role: str,
  }, ['key', 'name', 'type', 'subject', 'body'])),
}, ['templates']);

export async function stageEmailTemplates(llm: LLM, bp: any, analysis: any, pipeline: any, crmBp: any): Promise<any> {
  const data = await llm(
    `You are a customer communications copywriter generating ready-to-send message templates tailored to THIS business. ${blueprintContext(bp)}
Industry: ${analysis.industry}. Pipeline stages: ${JSON.stringify(pipeline.stages.map((s: any) => s.name))}. Owner roles: ${JSON.stringify(crmBp.owner_roles)}. Lead sources: ${JSON.stringify(analysis.lead_sources)}.
Return JSON: templates (6-10) covering welcome, quotation, reminder, follow-up, thank you, re-engagement, appointment confirmation — industry-specific in tone and content. Each: key (snake_case), name (human), type, subject (with {{first_name}}/{{business_name}} placeholders), body (full ready-to-send text, plain text, with merge fields {{first_name}}, {{business_name}}, {{service}}, {{advisor_name}}, {{appointment_time}}), channel (email by default; whatsapp/sms for short reminders), trigger (event or pipeline stage that fires this, referencing real stage names), owner_role (from the list). Do not invent services outside the blueprint. No placeholders like "lorem" — write real copy.`,
    EMAIL_TEMPLATES_SCHEMA,
  );
  if (!data || !Array.isArray(data.templates) || data.templates.length < 4) throw new Error('Email Templates stage returned too few templates.');
  return data;
}

// ---------- VALIDATION (deterministic) ----------
export type CrmCheck = { id: string; check: string; severity: 'error' | 'warning' | 'info'; status: 'pass' | 'fail'; message: string };

export function validateCRM(analysis: any, crmBp: any, pipeline: any, scoring: any, automations: any, tasks: any, templates?: any): { status: 'pass' | 'warning' | 'fail'; checks: CrmCheck[]; summary: any } {
  const checks: CrmCheck[] = [];
  const add = (id: string, severity: 'error' | 'warning' | 'info', check: string, pass: boolean, message: string) => checks.push({ id, check, severity, status: pass ? 'pass' : 'fail', message });

  const stageNames = pipeline.stages.map((s: any) => s.name);
  const stageKeys = pipeline.stages.map((s: any) => s.key);

  add('pipeline_length', 'error', 'Pipeline has enough stages', pipeline.stages.length >= 3, pipeline.stages.length < 3 ? `Only ${pipeline.stages.length} stages` : `${pipeline.stages.length} stages defined`);
  add('stage_order', 'error', 'Stage order is sequential', pipeline.stages.every((s: any, i: number) => s.order === i + 1), 'Stages numbered 1..N in order');
  add('stage_probabilities', 'warning', 'Stage probabilities increase monotonically', pipeline.stages.every((s: any, i: number) => i === 0 || s.probability >= pipeline.stages[i - 1].probability), 'Probabilities increase from one stage to the next');
  add('stage_keys_unique', 'error', 'Stage keys are unique', new Set(stageKeys).size === stageKeys.length, 'All stage keys unique');

  const stagesWithoutOwner = pipeline.stages.filter((s: any) => !s.owner_role).map((s: any) => s.name);
  add('stage_ownership', 'warning', 'Every stage has an owner role', !stagesWithoutOwner.length, stagesWithoutOwner.length ? `${stagesWithoutOwner.length} stages lack an owner role` : 'All stages assigned');

  add('stage_count_to_journey', 'info', 'Pipeline maps to customer journey', pipeline.stages.length >= (analysis.customer_journey || []).length - 2, `${pipeline.stages.length} stages for ${analysis.customer_journey?.length || 0} journey steps`);

  const orphanRefs = automations.filter((a: any) => a.trigger_stage && !stageNames.includes(a.trigger_stage) && !stageKeys.includes(a.trigger_stage)).map((a: any) => `${a.name}→${a.trigger_stage}`);
  add('automation_stage_refs', 'error', 'Automation stage references are valid', !orphanRefs.length, orphanRefs.length ? `Automations reference unknown stages: ${orphanRefs.slice(0, 3).join(', ')}` : 'All automation stage references valid');

  const stagesWithoutTask = pipeline.stages.filter((s: any) => !tasks.some((t: any) => (t.trigger || '').includes(s.name) || (t.trigger || '').includes(s.key))).map((s: any) => s.name);
  add('task_coverage', 'warning', 'Task coverage per stage', stagesWithoutTask.length <= 1, stagesWithoutTask.length > 1 ? `${stagesWithoutTask.length} stages have no task trigger (e.g. ${stagesWithoutTask.slice(0, 2).join(', ')})` : 'Each stage has a corresponding task');

  const { thresholds } = scoring;
  const thresholdsOrdered = thresholds.hot >= thresholds.warm && thresholds.warm >= thresholds.cold;
  add('scoring_thresholds', 'error', 'Scoring thresholds ordered (hot≥warm≥cold)', thresholdsOrdered, thresholdsOrdered ? `hot=${thresholds.hot} warm=${thresholds.warm} cold=${thresholds.cold}` : `Thresholds out of order: hot=${thresholds.hot} warm=${thresholds.warm} cold=${thresholds.cold}`);

  add('scoring_rules', 'warning', 'Sufficient scoring rules', scoring.rules.length >= 8, `${scoring.rules.length} scoring rules`);
  add('lead_sources', 'warning', 'Multi-source attribution', (analysis.lead_sources || []).length >= 3, `${analysis.lead_sources?.length || 0} lead sources defined`);
  add('renewal_or_review', 'info', 'Retention/renewal automation present', automations.some((a: any) => /renewal|review|retention|referral/i.test(a.name)), 'Renewal/review automation included');

  const leadFields = (crmBp.lead_fields || []).length;
  add('lead_fields', 'warning', 'Custom lead fields generated', leadFields >= 5, `${leadFields} custom lead fields`);
  const contactSections = (crmBp.contact_profile?.sections || []).length;
  add('contact_profile', 'warning', 'Contact profile model generated', contactSections >= 4, `${contactSections} contact profile sections`);
  const templateCount = templates?.length || 0;
  add('email_templates', 'warning', 'Email templates generated', templateCount >= 4, `${templateCount} email templates`);

  const errors = checks.filter((c) => c.severity === 'error' && c.status === 'fail').length;
  const warnings = checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const status: 'pass' | 'warning' | 'fail' = errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass';
  const health = Math.max(0, Math.round(100 - errors * 8 - warnings * 3));
  return { status, checks, summary: { errors, warnings, passed, total: checks.length, health_score: health, stage_count: pipeline.stages.length, automation_count: automations.length, task_count: tasks.length, score_rule_count: scoring.rules.length, lead_field_count: leadFields, contact_section_count: contactSections, email_template_count: templateCount } };
}