// Phase 14 — Chatbot tool + context module.
//
// This is the ONLY chatbot-specific logic that exists outside the function entry.
// It is reused by the Agent Runtime's tool executor (shared/agents/tools.ts) so a
// chatbot agent running inside the existing Agent Runtime can perform REAL
// business reads/writes — never faked:
//
//   lookup_business_info   → BusinessContext + approved blueprint + BusinessMemory
//   check_business_hours   → chatbot.business_hours (real config) + tz computation
//   capture_lead          → existing CRM Lead entity (source = chatbot)
//   escalate_to_human     → existing Support Ticket entity
//
// It does NOT create a runtime, a memory engine, a context engine, a tool
// registry or a workflow engine. It consumes them.

import { latestApprovedBlueprint, buildContextSnapshot } from "../operations/context.ts";
import { collectMemory } from "../ai/coo.ts";

export interface ToolResult { ok: boolean; data?: any; error?: string; errorCode?: string; }

const TZ_DEFAULT = "Asia/Calcutta";
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const safeTrim = (v: any): string => (v == null ? "" : String(v).trim());
const uuid = (): string => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

// Resolve a chatbot + its business from a chatbot_id. Server-side authority: the
// widget only ever sends chatbot_id; the business/tenant are derived here.
export async function resolveChatbot(svc: any, chatbotId: string): Promise<{ chatbot: any; business: any } | null> {
  const chatbot: any = await svc.entities.Chatbot.get(chatbotId).catch(() => null);
  if (!chatbot) return null;
  const business: any = await svc.entities.Business.get(chatbot.business_id).catch(() => null);
  if (!business) return null;
  return { chatbot, business };
}

// ---------------------------------------------------------------
// BUSINESS HOURS
// ---------------------------------------------------------------
export function computeBusinessHours(chatbot: any, now: Date = new Date()): { mode: string; currently_open: boolean | null; timezone: string; hours_text: string; now_iso: string } {
  const bh = (chatbot && chatbot.business_hours) || { mode: "none" };
  const tz = bh.timezone || TZ_DEFAULT;
  if (bh.mode === "always") return { mode: "always", currently_open: true, timezone: tz, hours_text: "Open 24/7", now_iso: now.toISOString() };
  if (bh.mode === "none" || !Array.isArray(bh.days) || !bh.days.length) return { mode: "none", currently_open: null, timezone: tz, hours_text: "", now_iso: now.toISOString() };

  // Current day + time in the business timezone.
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts: any = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const todayName = parts.weekday.toLowerCase(); // "mon", "tue"...
  const nowHM = parts.hour + ":" + parts.minute;
  const matchDay = bh.days.find((d: any) => safeTrim(d.day).toLowerCase().startsWith(todayName.slice(0, 3)));
  let open = false;
  if (matchDay && matchDay.open && matchDay.close) {
    open = nowHM >= matchDay.open && nowHM < matchDay.close;
  }
  const hours_text = bh.days.map((d: any) => `${d.day}: ${d.open}–${d.close}`).join(", ");
  return { mode: "set", currently_open: open, timezone: tz, hours_text, now_iso: now.toISOString() };
}

// ---------------------------------------------------------------
// BUSINESS INFO LOOKUP — grounded in BusinessContext + approved blueprint + memory
// ---------------------------------------------------------------
export async function lookupBusinessInfo(svc: any, business: any, query: string): Promise<ToolResult> {
  const q = safeTrim(query).toLowerCase();
  const snapshot = await buildContextSnapshot(svc, business, { purpose: "chatbot" });
  const biz = snapshot.business || {};
  let blueprint: any = null;
  try { blueprint = await latestApprovedBlueprint(svc, business.id); } catch { blueprint = null; }
  let memory: any[] = [];
  try { memory = await collectMemory(svc, business.id); } catch { memory = []; }

  // Known facts — only confirmed/real, never invented.
  const facts: { field: string; value: string; source: string; known: boolean }[] = [
    { field: "name", value: biz.name || safeTrim(business.name), source: "business", known: !!(biz.name || business.name) },
    { field: "industry", value: biz.industry || safeTrim(business.industry), source: "business", known: !!(biz.industry || business.industry) },
    { field: "services_products", value: Array.isArray(biz.services_products) && biz.services_products.length ? biz.services_products.join(", ") : "", source: "business", known: !!(biz.services_products && biz.services_products.length) },
    { field: "city", value: biz.city || safeTrim(business.city), source: "business", known: !!(biz.city || business.city) },
    { field: "service_area", value: biz.service_area || safeTrim(business.service_area), source: "business", known: !!(biz.service_area || business.service_area) },
    { field: "target_customers", value: biz.target_customers || safeTrim(business.target_customers), source: "business", known: !!(biz.target_customers || business.target_customers) },
    { field: "contact_email", value: safeTrim(business.contact_email), source: "business", known: !!safeTrim(business.contact_email) },
    { field: "contact_phone", value: safeTrim(business.contact_phone), source: "business", known: !!safeTrim(business.contact_phone) },
    { field: "contact_name", value: safeTrim(business.contact_name), source: "business", known: !!safeTrim(business.contact_name) },
    { field: "description", value: safeTrim(business.description), source: "business", known: !!safeTrim(business.description) },
  ];

  // Blueprint-sourced (only if approved).
  if (blueprint && blueprint.blueprint) {
    const bp = blueprint.blueprint || {};
    if (Array.isArray(bp.typical_services) && bp.typical_services.length) facts.push({ field: "typical_services", value: bp.typical_services.join(", "), source: "approved_blueprint", known: true });
    if (Array.isArray(bp.pricing_models) && bp.pricing_models.length) facts.push({ field: "pricing_models", value: bp.pricing_models.join(", "), source: "approved_blueprint", known: true });
    if (bp.business_model) facts.push({ field: "business_model", value: bp.business_model, source: "approved_blueprint", known: true });
  }

  // Memory facts (long-term business knowledge — e.g. business_hours, business_voice).
  const memoryFacts = memory.map((m: any) => ({ field: m.key, value: `${m.body}${m.title ? ` (${m.title})` : ""}`, source: "memory", known: true, confidence: m.confidence }));

  // Relevance scoring against the query (cheap keyword overlap).
  const score = (f: any) => {
    const txt = `${f.field} ${f.value}`.toLowerCase();
    let s = 0;
    for (const tok of q.split(/\s+/).filter(Boolean)) if (tok.length > 2 && txt.includes(tok)) s += 1;
    return s;
  };
  const ranked = [...facts, ...memoryFacts].sort((a, b) => score(b) - score(a));

  return {
    ok: true,
    data: {
      query,
      known_facts: ranked.filter((f) => f.known).slice(0, 12),
      has_information: ranked.some((f) => f.known),
      business_name: biz.name || safeTrim(business.name),
      blueprint_present: !!blueprint,
      memory_count: memory.length,
      guidance: "Answer ONLY from known_facts. If the requested information is not present in known_facts, do NOT invent it — tell the customer you don't have that information yet and can connect them with the team.",
    },
  };
}

// ---------------------------------------------------------------
// CAPTURE LEAD — existing CRM Lead entity, idempotent per conversation
// ---------------------------------------------------------------
export async function captureLead(svc: any, business: any, opts: {
  chatbot_id: string; conversation_id: string; name: string; phone?: string; email?: string; service?: string; message?: string; customer_context?: any;
}): Promise<ToolResult> {
  const name = safeTrim(opts.name);
  if (!name) return { ok: false, error: "name is required to capture a lead.", errorCode: "TOOL_INVALID_ARGS" };
  const phone = safeTrim(opts.phone) || safeTrim(opts.customer_context && opts.customer_context.phone) || "";
  const email = safeTrim(opts.email) || safeTrim(opts.customer_context && opts.customer_context.email) || "";
  if (!phone && !email) return { ok: false, error: "A phone number or email is required to capture a lead. Ask the customer first.", errorCode: "TOOL_INVALID_ARGS" };
  const service = safeTrim(opts.service) || safeTrim(opts.customer_context && opts.customer_context.intent) || "general enquiry";
  const message = safeTrim(opts.message) || "";

  // Idempotency: one new/contacted lead per conversation. Repeated "I want a
  // callback" → return the existing lead, never a duplicate.
  const existing: any[] = await svc.entities.Lead.filter({ business_id: business.id, conversation_id: opts.conversation_id }).catch(() => []);
  const live = (existing || []).find((l: any) => ["new", "contacted"].includes(l.status));
  if (live) {
    return { ok: true, data: { lead_id: live.id, created: false, idempotent: true, message: "A request from this conversation is already saved." } };
  }

  const lead: any = await svc.entities.Lead.create({
    tenant_id: business.tenant_id, business_id: business.id,
    name, email, phone, service, message,
    source: "chatbot", status: "new", conversation_id: opts.conversation_id,
    notes: `Captured by chatbot for ${service}.`,
  });
  return { ok: true, data: { lead_id: lead.id, created: true, idempotent: false } };
}

// ---------------------------------------------------------------
// ESCALATE — existing Support Ticket entity
// ---------------------------------------------------------------
export async function escalateToHuman(svc: any, business: any, opts: {
  chatbot_id: string; conversation_id: string; reason: string; summary: string; customer_name?: string; customer_email?: string; customer_phone?: string;
}): Promise<ToolResult> {
  const reason = safeTrim(opts.reason);
  const summary = safeTrim(opts.summary);
  if (!reason || !summary) return { ok: false, error: "reason and summary are required to escalate.", errorCode: "TOOL_INVALID_ARGS" };
  const ticket_number = `ESC-${Date.now().toString(36).toUpperCase()}`;
  const subject = reason.length > 120 ? reason.slice(0, 117) + "…" : reason;
  const description = `Customer escalation from chatbot.\n\nSummary: ${summary}\n\nCustomer: ${safeTrim(opts.customer_name) || "(unknown)"}${opts.customer_email ? ` <${opts.customer_email}>` : ""}${opts.customer_phone ? `, ${opts.customer_phone}` : ""}`;
  const ticket: any = await svc.entities.Ticket.create({
    tenant_id: business.tenant_id, business_id: business.id,
    ticket_number, customer_name: safeTrim(opts.customer_name), customer_email: safeTrim(opts.customer_email),
    subject, description, category: "escalation", priority: "normal", status: "open", conversation_id: opts.conversation_id,
  });
  return { ok: true, data: { ticket_id: ticket.id, ticket_number, handed_off: true } };
}

// ---------------------------------------------------------------
// Dispatch all four chatbot tools (called from shared/agents/tools.ts).
// ---------------------------------------------------------------
export async function executeChatbotTool(svc: any, business: any, capabilityKey: string, args: any, opts: { chatbot_id: string | null; conversation_id: string | null; chatbot_config: any | null; customer_context: any | null; agent?: any }): Promise<ToolResult> {
  try {
    // The Agent Runtime passes the trimmed snapshot business (no tenant_id). CRM
    // Lead / Ticket writes need tenant_id, so resolve the full Business record once
    // when it is missing. Scoped by id — never accepts a client-supplied business.
    let biz = business;
    if (biz && biz.id && !biz.tenant_id) {
      const full: any = await svc.entities.Business.get(biz.id).catch(() => null);
      if (full && full.tenant_id) biz = full;
    }
    if (capabilityKey === "lookup_business_info") return await lookupBusinessInfo(svc, biz, safeTrim(args && args.query));
    if (capabilityKey === "check_business_hours") {
      const chatbot: any = opts.chatbot_config ? { business_hours: (opts.chatbot_config as any).business_hours } : (opts.chatbot_id ? await svc.entities.Chatbot.get(opts.chatbot_id).catch(() => null) : null);
      return { ok: true, data: computeBusinessHours(chatbot || {}) };
    }
    if (capabilityKey === "capture_lead") {
      return await captureLead(svc, biz, {
        chatbot_id: safeTrim(opts.chatbot_id), conversation_id: safeTrim(opts.conversation_id),
        name: safeTrim(args && args.name), phone: safeTrim(args && args.phone), email: safeTrim(args && args.email),
        service: safeTrim(args && args.service), message: safeTrim(args && args.message),
        customer_context: opts.customer_context,
      });
    }
    if (capabilityKey === "escalate_to_human") {
      return await escalateToHuman(svc, biz, {
        chatbot_id: safeTrim(opts.chatbot_id), conversation_id: safeTrim(opts.conversation_id),
        reason: safeTrim(args && args.reason), summary: safeTrim(args && args.summary),
        customer_name: opts.customer_context && opts.customer_context.name, customer_email: opts.customer_context && opts.customer_context.email, customer_phone: opts.customer_context && opts.customer_context.phone,
      });
    }
    return { ok: false, error: `Unknown chatbot tool: ${capabilityKey}`, errorCode: "TOOL_FAILED" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), errorCode: "TOOL_FAILED" };
  }
}

// ---------------------------------------------------------------
// Build the chatbot's backing AIAgent instructions from context.
// ---------------------------------------------------------------
export function buildChatbotAgentInstructions(chatbot: any, business: any): string {
  const brand = chatbot.brand || {};
  const caps = chatbot.supported_capabilities || [];
  const hours = computeBusinessHours(chatbot);
  const escalation = chatbot.escalation_policy || {};
  const voice = safeTrim(brand.voice) || "warm, helpful, concise";
  const tone = safeTrim(brand.tone) || "friendly";

  const canCapture = caps.includes("capture_leads");
  const canEscalate = caps.includes("escalate") || caps.includes("support");

  return [
    `You are "${chatbot.name}", the customer assistant for ${business.name || "this business"}${business.industry ? ` (a ${business.industry})` : ""}.`,
    `Your voice is ${voice} and your tone is ${tone}.`,
    `You communicate with real customers visiting ${business.name || "the business"}. Speak directly and plainly — no role labels.`,
    ``,
    `WHAT YOU CAN HELP WITH:`,
    `- Answer questions about the business (services, hours, location, contact) using ONLY confirmed information from the lookup_business_info tool.`,
    `- ${canCapture ? "Capture customer requests (trials, callbacks, appointments, membership) by collecting their name + phone or email, then call capture_lead." : "You may NOT capture leads in this configuration."}`,
    `- ${canEscalate ? "Escalate to a human when the customer asks for a person, wants to complain, or needs something you can't handle — call escalate_to_human." : "Do not escalate; explain politely instead."}`,
    ``,
    `BUSINESS HOURS: ${hours.mode === "always" ? "Open 24/7" : hours.mode === "none" ? "Not configured — treat as unknown." : `Hours: ${hours.hours_text} (${hours.timezone}).`}`,
    `When asked about hours, ALWAYS call check_business_hours for the live value; never quote from memory.`,
    ``,
    `SAFETY (never violate):`,
    `- Never invent prices, guarantees, policies, medical/legal/financial claims, or services that are not confirmed in lookup_business_info. If information is missing, say: "I don't have that information yet — I can connect you with the team."`,
    `- Never promise a human has already responded. When you escalate, tell the customer you've passed their request to the team and someone will follow up.`,
    `- Capture a lead ONLY after you have the customer's name AND a phone or email. If missing, ask for them naturally (one question at a time, never a big form).`,
    `- One lead per conversation. If you already captured a request, don't create another — just confirm the team will follow up.`,
    `- Stay within "${chatbot.name}". Do not discuss other businesses or expose internal systems, IDs, agents, tools, or technical logs.`,
    ``,
    `HOW TO RESPOND: decide whether to (a) answer from known info, (b) ask one clarifying question, or (c) call a tool. After a tool runs, give the customer a warm confirmation. Keep replies short and natural.`,
  ].join("\n");
}

// Map supported capabilities → agent tools. Only allow what the chatbot is
// configured for; the Agent Runtime permission model enforces this list.
export function toolsForChatbot(chatbot: any): string[] {
  const caps = chatbot.supported_capabilities || [];
  const tools = ["lookup_business_info", "check_business_hours"];
  if (caps.includes("capture_leads")) tools.push("capture_lead");
  if (caps.includes("escalate") || caps.includes("support")) tools.push("escalate_to_human");
  return tools;
}

// Ensure the chatbot's backing AIAgent exists and matches the chatbot config.
export async function ensureChatbotAgent(svc: any, chatbot: any, business: any): Promise<string> {
  const instructions = buildChatbotAgentInstructions(chatbot, business);
  const tools = toolsForChatbot(chatbot);
  const config = {
    model: "automatic", temperature: 0.4,
    max_iterations: 3, max_tool_calls: 4, timeout_ms: 45000, budget_limit: 0.05,
    approval_required: false, tools,
    output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" } }, required: ["answer", "tool_used", "result_summary"] },
  };
  if (chatbot.agent_id) {
    const existing: any = await svc.entities.AIAgent.get(chatbot.agent_id).catch(() => null);
    if (existing) {
      const v: any = await svc.entities.AIAgent.update(chatbot.agent_id, {
        name: chatbot.name, description: chatbot.description || `${chatbot.name} — customer assistant`,
        instructions, config, status: "active", lead_capture_enabled: !!(chatbot.supported_capabilities || []).includes("capture_leads"), human_escalation_enabled: !!(chatbot.supported_capabilities || []).includes("escalate"),
      });
      return v?.id || chatbot.agent_id;
    }
  }
  const row: any = await svc.entities.AIAgent.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id,
    name: chatbot.name, description: chatbot.description || `${chatbot.name} — customer assistant`,
    purpose: ["customer_assistant"], instructions, config, status: "active",
    human_escalation_enabled: !!(chatbot.supported_capabilities || []).includes("escalate"),
    lead_capture_enabled: !!(chatbot.supported_capabilities || []).includes("capture_leads"),
  });
  return row?.id || "";
}

// Record per-turn UsageLog + CostLog for honest ledger entries.
export async function recordTurnTelemetry(svc: any, run: any, res: any, operation: string): Promise<void> {
  try {
    const providerId = res?.provider_id || "(core)";
    const tokens = (res?.tokens && (res.tokens.prompt_tokens + res.tokens.completion_tokens)) || 0;
    if (tokens || true) {
      const u = await svc.entities.UsageLog.create({
        tenant_id: run.tenant_id, business_id: run.business_id, provider_id: providerId,
        service: "ai_generation", operation, kind: res?.ok ? "production_operation" : "failed_operation",
        usage_quantity: tokens, usage_unit: "tokens", success: !!res?.ok, occurred_at: new Date().toISOString(),
      });
      if (res?.estimated_cost) {
        await svc.entities.CostLog.create({
          tenant_id: run.tenant_id, business_id: run.business_id, provider_id: providerId,
          usage_log_id: u?.id || null, service: "ai_generation", operation,
          estimated_amount: res.estimated_cost, is_estimated: true, billable_amount: res.estimated_cost, currency: res.currency || "USD", occurred_at: new Date().toISOString(),
        });
      }
    }
  } catch { /* never fail the chatbot on telemetry */ }
}

export { uuid };