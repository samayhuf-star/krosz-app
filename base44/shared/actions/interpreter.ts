// Action Execution — intent classification + REAL reads.
// The AI decides WHAT; existing systems decide HOW. Classification is
// deterministic-first (reliable + honest), with the LLM only adding nuance for
// ambiguous phrasings. The classifier may only return a registered capability
// key or `not_available` — it can never invent a capability.

import { CAPABILITIES, CAPABILITY_KEYS, UNAVAILABLE_INTENTS } from "./capabilities.ts";

export interface Classification {
  capability: string;            // a CAPABILITY_KEYS value or "not_available"
  confidence: number;            // 0-1
  params: any;
  missing_info?: string;         // when we need one clarification
  reply_understanding: string;  // "I understand you want …"
}

function norm(s: string): string { return (s || "").toLowerCase().trim(); }

// Cheap, decisive keyword match. The registry `intents` are the canonical
// phrasings; we also accept substring matches for robustness.
export function matchIntent(request: string): { capability: string; confidence: number } | null {
  const r = norm(request);
  if (!r) return null;
  // Direct, explicit unavailable intents first (honest not-available).
  for (const u of UNAVAILABLE_INTENTS) {
    if (r.includes(norm(u))) return { capability: "not_available", confidence: 0.9 };
  }
  let best: { capability: string; score: number } | null = null;
  for (const key of CAPABILITY_KEYS) {
    const cap = CAPABILITIES[key];
    for (const intent of cap.intents || []) {
      const i = norm(intent);
      if (r === i) return { capability: key, confidence: 1 };
      if (r.includes(i)) {
        const score = i.length;
        if (!best || score > best.score) best = { capability: key, score };
      }
    }
  }
  if (best) return { capability: best.capability, confidence: 0.8 };
  return null;
}

// LLM classifier — only invoked when the deterministic pass found nothing.
// Strict: must return one of CAPABILITY_KEYS or "not_available".
export async function llmClassify(svc: any, business: any, request: string, ctx: string): Promise<Classification> {
  const options = [...CAPABILITY_KEYS, "not_available"];
  const schema = {
    type: "object",
    properties: {
      capability: { type: "string", enum: options },
      confidence: { type: "number" },
      params: { type: "object", additionalProperties: true },
      missing_info: { type: "string" },
      reply_understanding: { type: "string" },
    },
    required: ["capability", "reply_understanding"],
  };
  const prompt = `You are the intent engine of a Business Operating System. Classify the customer's request into EXACTLY ONE capability. Use ONLY the provided capability list; if none fits, return "not_available". One sentence (<25 words) describing what you understood, plain text, no jargon, no task ids, no provider names.

Business: "${business.name}" (${business.industry || "unknown"} in ${business.city || "—"}).
Current business state:\n${ctx}

Available capabilities:
${CAPABILITY_KEYS.map((k) => `- ${k}: ${CAPABILITIES[k].summary}.`).join("\n")}
- not_available: the platform cannot automate this yet.

Customer request: """${request}"""`;

  try {
    const res = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
    if (res && CAPABILITY_KEYS.includes(res.capability)) {
      return { capability: res.capability, confidence: res.confidence ?? 0.6, params: res.params || {}, missing_info: res.missing_info, reply_understanding: res.reply_understanding || "Let me work on that." };
    }
    if (res && res.capability === "not_available") {
      return { capability: "not_available", confidence: res.confidence ?? 0.6, params: {}, reply_understanding: res.reply_understanding || "I can't automate that yet." };
    }
    return { capability: "not_available", confidence: 0.4, params: {}, reply_understanding: "I'm not sure I can automate that yet." };
  } catch {
    return { capability: "not_available", confidence: 0.3, params: {}, reply_understanding: "I couldn't interpret that right now." };
  }
}

export async function classify(svc: any, business: any, request: string, ctx: string): Promise<Classification> {
  const det = matchIntent(request);
  if (det) {
    const cap = CAPABILITIES[det.capability] || null;
    return {
      capability: det.capability,
      confidence: det.confidence,
      params: {},
      reply_understanding: det.capability === "not_available"
        ? "I understand — but I can't fully automate that yet."
        : cap ? `I'll ${cap.label.toLowerCase()} for you.` : "Let me handle that.",
    };
  }
  return llmClassify(svc, business, request, ctx);
}

// ============================================================
// REAL READS — no mocks, no fabricated data.
// ============================================================

async function loadLiveState(svc: any, businessId: string): Promise<any> {
  const [leads, messages, websites, domains, seoVersions, crmVersions, tickets, runs] = await Promise.all([
    svc.entities.Lead.filter({ business_id: businessId }).catch(() => []),
    svc.entities.EmailMessage.filter({ business_id: businessId }).catch(() => []),
    svc.entities.Website.filter({ business_id: businessId }).catch(() => []),
    svc.entities.Domain.filter({ business_id: businessId }).catch(() => []),
    svc.entities.SEOVersion.filter({ business_id: businessId }).catch(() => []),
    svc.entities.CRMVersion.filter({ business_id: businessId }).catch(() => []),
    svc.entities.Ticket.filter({ business_id: businessId }).catch(() => []),
    svc.entities.LaunchPlan.filter({ business_id: businessId }, "-created_date", 10).catch(() => []),
  ]);
  const activeRun = (runs || []).find((r: any) => !["completed", "failed", "cancelled"].includes(r.status)) || null;
  const lastRunComplete = (runs || []).find((r: any) => r.status === "completed") || null;
  return {
    counts: {
      new_leads: (leads || []).filter((l: any) => (l.status || "new") === "new").length,
      total_leads: (leads || []).length,
      unread: (messages || []).filter((m: any) => m.is_unread).length,
      needs_reply: (messages || []).filter((m: any) => m.needs_reply).length,
      open_tickets: (tickets || []).filter((t: any) => !["resolved", "closed", "cancelled"].includes(t.status)).length,
    },
    systems: {
      domain: (domains || []).some((d: any) => d.status === "active" || d.status === "registered"),
      website_published: (websites || []).some((w: any) => w.status === "published"),
      website_drafted: (websites || []).length > 0,
      seo: (seoVersions || []).length > 0,
      crm: (crmVersions || []).length > 0,
    },
    active_run: activeRun ? { id: activeRun.id, template: activeRun.plan_template_id, status: activeRun.status } : null,
    last_complete_run: lastRunComplete ? { id: lastRunComplete.id, template: lastRunComplete.plan_template_id } : null,
    raw: { leads, messages, runs },
  };
}

export async function buildContextSummary(svc: any, business: any): Promise<string> {
  const s = await loadLiveState(svc, business.id);
  return [
    `Launch stage: ${business.launch_stage || "—"}, lifecycle: ${business.lifecycle_stage || "—"}.`,
    `Leads: ${s.counts.total_leads} total (${s.counts.new_leads} new). Emails: ${s.counts.needs_reply} need a reply. Open tickets: ${s.counts.open_tickets}.`,
    `Domain: ${s.systems.domain ? "active" : "not configured"}. Website: ${s.systems.website_published ? "published" : s.systems.website_drafted ? "drafted" : "not built"}. SEO: ${s.systems.seo ? "ready" : "none"}. CRM: ${s.systems.crm ? "ready" : "none"}.`,
    s.active_run ? `Active workflow run: ${s.active_run.template} (${s.active_run.status}).` : "No active workflow run.",
  ].join("\n");
}

export async function readListCustomers(svc: any, businessId: string): Promise<{ data: any; reply: string }> {
  const [leads, contacts] = await Promise.all([
    svc.entities.Lead.filter({ business_id: businessId }, "-created_date", 25).catch(() => []),
    svc.entities.Contact.filter({ business_id: businessId }, "-created_date", 25).catch(() => []),
  ]);
  const news = (leads || []).filter((l: any) => (l.status || "new") === "new").length;
  const reply = `You have ${(leads || []).length} leads${news ? `, ${news} new` : ""} and ${(contacts || []).length} contacts. Open Customers to see the full pipeline.`;
  return { data: { leads: (leads || []).slice(0, 10).map((l: any) => ({ id: l.id, name: l.name || l.full_name, status: l.status || "new", value: l.value })), total: (leads || []).length, new: news, contacts: (contacts || []).length }, reply };
}

export async function readShowStatus(svc: any, business: any): Promise<{ data: any; reply: string }> {
  const s = await loadLiveState(svc, business.id);
  const lines = [
    s.systems.domain ? "• Domain — ready" : "• Domain — not configured yet",
    s.systems.website_published ? "• Website — live" : s.systems.website_drafted ? "• Website — drafted, not published" : "• Website — not built yet",
    s.systems.seo ? "• SEO — ready" : "• SEO — not set up yet",
    s.systems.crm ? "• CRM — ready" : "• CRM — not set up yet",
    `• Leads — ${s.counts.total_leads} (${s.counts.new_leads} new)`,
    `• Inbox — ${s.counts.needs_reply} need a reply`,
  ];
  const blocker = !s.systems.domain ? "Your domain is the first thing stopping you from going live." : !s.systems.website_published ? "Publishing your website will get you live." : s.counts.needs_reply ? "A few customer messages are waiting." : "Everything is online — focus on growth.";
  const reply = `Here's how "${business.name}" is doing:\n${lines.join("\n")}\n\n${blocker}`;
  return { data: s, reply };
}

export async function readAdviceToday(svc: any, business: any): Promise<{ data: any; reply: string }> {
  const s = await loadLiveState(svc, business.id);
  const tasks: any[] = await svc.entities.LaunchTask.filter({ business_id: business.id, status: "awaiting_approval" }).catch(() => []);
  let priority, route;
  if (tasks && tasks.length) {
    priority = `You have ${tasks.length} step${tasks.length > 1 ? "s" : ""} waiting for your approval. Approve it and I'll keep building everything.`;
    route = "/launching";
  } else if (s.counts.needs_reply >= 3) {
    priority = `${s.counts.needs_reply} customers are waiting for your reply — a quick response keeps momentum high.`;
    route = "/communications";
  } else if (s.counts.new_leads > 0) {
    priority = `${s.counts.new_leads} new lead${s.counts.new_leads === 1 ? "" : "s"} just came in. Follow up while they're warm.`;
    route = "/customers";
  } else if (s.systems.website_drafted && !s.systems.website_published) {
    priority = "Your website is drafted and ready to go live. Publish it to start operating.";
    route = "/launching";
  } else if (!s.systems.domain) {
    priority = "Your domain isn't configured yet — that's what's stopping you from going live.";
    route = "/launching";
  } else {
    priority = "Everything is running smoothly. Ask me to grow your business — more leads, a campaign, or better SEO.";
    route = "/assistant";
  }
  return { data: { priority, route, state: s }, reply: priority };
}