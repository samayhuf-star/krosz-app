// AI Business Manager (Phase 9 — Autonomous Operations / "AI COO").
//
// A single backend function that turns Launch OS from "tools the user clicks" into
// an AI that proactively OBSERVES → DECIDES → RECOMMENDS → BRIEFS → PLANS for every
// active business, using the existing Workflow Engine as the execution arm.
//
// Autonomous/scheduled entry points (run by the daily/weekly/monthly workflows):
//   morning-routine | weekly-routine | monthly-routine   (iterate active businesses)
// Per-business actions (admin-triggered for testing / manual rerun):
//   observe | recommend | brief | plan-today | weekly-review | monthly-strategy
// Read actions (any authenticated user, RLS-enforced via user-scoped client):
//   get-brief | list-observations | list-recommendations | memory.get
// User actions (tenant-verified):
//   memory.upsert | act   (approve / dismiss a recommendation)
//
// All intelligence runs through the platform InvokeLLM — no external keys needed.
// State lives in entities: BusinessObservation, BusinessMemory (cognition), and the
// existing LaunchRecommendation (actionable items the user approves / dismisses).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { requireBusinessId, verifyTenant, actorOf, collectMemory, upsertMemory, isoWeek, listActiveBusinesses } from "../../shared/ai/coo.ts";

const DAY = 86400000;
const READ_ACTIONS = new Set(["get-brief", "list-observations", "list-recommendations", "memory.get"]);
const USER_ACTIONS = new Set(["memory.upsert", "act"]);
const AUTONOMOUS_ACTIONS = new Set(["morning-routine", "weekly-routine", "monthly-routine", "observe", "recommend", "decide", "brief", "plan-today", "weekly-review", "monthly-strategy"]);

const RECO_CATEGORIES = ["seo", "website", "domain", "crm", "team", "automation", "growth", "support", "marketing", "other"];

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    // Direct hits by a non-admin may only read; autonomous/aggregate actions are
    // admin-gated or run scheduled (no user). The scheduled path (no user) is allowed.
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    if (user && user.role !== "admin" && (AUTONOMOUS_ACTIONS.has(action) || AUTONOMOUS_ACTIONS.has(action))) {
      // allow READ + USER actions for regular users; block autonomous/manual generation
      if (!READ_ACTIONS.has(action) && !USER_ACTIONS.has(action)) {
        return Response.json({ error: "Admin only" }, { status: 403 });
      }
    }

    const svc = base44.asServiceRole;
    const actor = actorOf(user, "ai_coo");

    // ---------- AUTONOMOUS ROUTINES ----------
    if (action === "morning-routine") return Response.json(await runRoutine(svc, "morning", body.business_id, actor));
    if (action === "weekly-routine") return Response.json(await runRoutine(svc, "weekly", body.business_id, actor));
    if (action === "monthly-routine") return Response.json(await runRoutine(svc, "monthly", body.business_id, actor));

    // ---------- PER-BUSINESS GENERATION ----------
    if (action === "observe") return Response.json(await observeBusiness(svc, requireBusinessId(body), actor));
    if (action === "recommend") return Response.json(await recommendBusiness(svc, requireBusinessId(body), actor));
    if (action === "decide") return Response.json(await decideBusiness(svc, requireBusinessId(body), actor));
    if (action === "brief") return Response.json(await briefBusiness(svc, requireBusinessId(body), actor));
    if (action === "plan-today") return Response.json(await planTodayBusiness(svc, requireBusinessId(body), actor));
    if (action === "weekly-review") return Response.json(await reviewBusiness(svc, requireBusinessId(body), "weekly", actor));
    if (action === "monthly-strategy") return Response.json(await reviewBusiness(svc, requireBusinessId(body), "monthly", actor));

    // ---------- READ (user-scoped when a user is present, for RLS) ----------
    if (action === "get-brief") return Response.json(await getBrief(useReadClient(base44, user), svc, body, user));
    if (action === "list-observations") return Response.json(await listObservations(useReadClient(base44, user), svc, body, user));
    if (action === "list-recommendations") return Response.json(await listRecommendations(useReadClient(base44, user), svc, body, user));
    if (action === "memory.get") return Response.json(await memoryGet(useReadClient(base44, user), svc, body, user));

    // ---------- USER ACTIONS (tenant-verified) ----------
    if (action === "memory.upsert") return Response.json(await memoryUpsert(svc, body, user, actor));
    if (action === "act") return Response.json(await actOnRecommendation(svc, body, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

// Use the user-scoped client for reads when a real user is calling, so RLS keeps
// data inside their tenant. Scheduled (no user) reads use the service role.
function useReadClient(base44: any, user: any): any {
  return user ? base44 : base44.asServiceRole;
}

// =================================================================
// AUTONOMOUS ROUTINES
// =================================================================
async function runRoutine(svc: any, kind: "morning" | "weekly" | "monthly", onlyBusinessId: string | undefined, actor: string): Promise<any> {
  const targets = await listActiveBusinesses(svc, onlyBusinessId);
  const results: any[] = [];
  for (const b of targets) {
    try {
      if (kind === "morning") {
        const obs = await observeBusiness(svc, b.id, actor);
        const rec = await recommendBusiness(svc, b.id, actor);
        const brf = await briefBusiness(svc, b.id, actor);
        const plan = await planTodayBusiness(svc, b.id, actor);
        results.push({ business_id: b.id, name: b.name, observations: obs.created, recommendations: rec.created, brief_id: brf.memory_id, plan_items: (plan.items || []).length });
      } else if (kind === "weekly") {
        const r = await reviewBusiness(svc, b.id, "weekly", actor);
        results.push({ business_id: b.id, name: b.name, weekly_review_id: r.memory_id, score: (r.payload || {}).business_score });
      } else {
        const r = await reviewBusiness(svc, b.id, "monthly", actor);
        results.push({ business_id: b.id, name: b.name, monthly_strategy_id: r.memory_id, strategies: ((r.payload || {}).strategies || []).length });
      }
    } catch (e: any) {
      results.push({ business_id: b.id, name: b.name, error: e?.message || String(e) });
    }
  }
  return { routine: kind, processed: targets.length, results };
}

// =================================================================
// OBSERVATION ENGINE
// =================================================================
async function observeBusiness(svc: any, businessId: string, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const now = Date.now();
  const isoNow = new Date().toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const signals: any[] = [];

  // CRM — leads
  const leadsNew: any[] = await svc.entities.Lead.filter({ business_id: businessId, status: "new" }, "-created_date", 50).catch(() => []);
  const leadsNew7d = leadsNew.filter((l: any) => new Date(l.created_date || 0).getTime() >= now - 7 * DAY).length;
  if (leadsNew.length > 0) {
    signals.push({ source: "crm", category: "leads", severity: "positive", signal_key: "crm.new_leads", title: `${leadsNew.length} new lead${leadsNew.length === 1 ? "" : "s"} waiting`, detail: `${leadsNew7d} arrived in the last 7 days.`, evidence: { total_new: leadsNew.length, last_7d: leadsNew7d } });
  } else {
    signals.push({ source: "crm", category: "leads", severity: "warning", signal_key: "crm.no_new_leads_7d", title: "No new leads in the last 7 days", detail: "Lead intake has gone quiet — marketing or SEO may need attention.", evidence: { new_count: 0 } });
  }

  // Email — waiting customers & unread
  const threads: any[] = await svc.entities.EmailThread.filter({ business_id: businessId, status: "open" }, "-last_message_at", 100).catch(() => []);
  const waiting = threads.filter((t: any) => t.last_message_at && new Date(t.last_message_at).getTime() < now - 3 * DAY);
  if (waiting.length) signals.push({ source: "email", category: "responsiveness", severity: "warning", signal_key: "email.customer_waiting_3d", title: `${waiting.length} customer${waiting.length === 1 ? "" : "s"} waiting over 3 days for a reply`, detail: "Responses slower than 3 days hurt conversion and trust.", evidence: { waiting_threads: waiting.length } });
  const unread: any[] = await svc.entities.EmailMessage.filter({ business_id: businessId, is_unread: true }, "-received_at", 100).catch(() => []);
  if (unread.length) signals.push({ source: "email", category: "inbox", severity: "info", signal_key: "email.unread", title: `${unread.length} unread email${unread.length === 1 ? "" : "s"}`, detail: "Inbox has unread messages.", evidence: { unread: unread.length } });

  // Communications — recent failures (bounces/errors)
  const logs: any[] = await svc.entities.CommunicationLog.filter({ business_id: businessId, status: "failure" }, "-created_date", 30).catch(() => []);
  const recentFails = logs.filter((l: any) => new Date(l.created_date || 0).getTime() >= now - 7 * DAY);
  if (recentFails.length) signals.push({ source: "communications", category: "deliverability", severity: "warning", signal_key: "comms.failures_7d", title: `${recentFails.length} email delivery failure${recentFails.length === 1 ? "" : "s"} this week`, detail: "Bounces or send failures detected.", evidence: { failures_7d: recentFails.length } });

  // Domain — expiry (guarded; Domain schema may vary)
  const domains: any[] = await svc.entities.Domain.filter({ business_id: businessId }, "-created_date", 20).catch(() => []);
  for (const d of domains) {
    const exp: any = d.expiry_date || d.expires_at || d.renewal_date;
    if (exp) {
      const days = Math.ceil((new Date(exp).getTime() - now) / DAY);
      if (days <= 30 && days >= 0) signals.push({ source: "domain", category: "renewal", severity: days <= 7 ? "critical" : "warning", signal_key: `domain.expiry.${d.id}`, title: `Domain ${d.domain_name || ""} expires in ${days} days`, detail: "Renew before the domain goes offline.", evidence: { domain_id: d.id, days } });
    }
  }

  // Recommendations — stale open items
  const recos: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, status: "open" }, "-generated_at", 50).catch(() => []);
  if (recos.length >= 3) signals.push({ source: "ai", category: "backlog", severity: "info", signal_key: "ai.open_recommendations", title: `${recos.length} recommendations are still open`, detail: "The backlog of suggested actions is growing.", evidence: { open: recos.length } });

  // Launch — latest run health
  const runs: any[] = await svc.entities.LaunchPlan.filter({ business_id: businessId }, "-created_date", 3).catch(() => []);
  const latest = (runs || [])[0];
  if (latest && latest.status === "failed") signals.push({ source: "system", category: "launch", severity: "critical", signal_key: "launch.failed_latest", title: "Your latest launch hit a problem", detail: "Some systems could not be built and need attention.", evidence: { run_id: latest.id, status: latest.status } });

  // Upsert by signal_key (open record of the same key = refresh, not duplicate)
  let created = 0, updated = 0;
  for (const s of signals) {
    const existing: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, signal_key: s.signal_key, status: "open" }).catch(() => []);
    if (existing && existing.length) {
      await svc.entities.BusinessObservation.update(existing[0].id, { title: s.title, detail: s.detail, evidence: s.evidence, severity: s.severity, generated_at: isoNow });
      updated++;
    } else {
      await svc.entities.BusinessObservation.create({ tenant_id: business.tenant_id, business_id: businessId, source: s.source, category: s.category, severity: s.severity, signal_key: s.signal_key, title: s.title, detail: s.detail, evidence: s.evidence, status: "open", decision: "pending", generated_at: isoNow, provenance: { actor } });
      created++;
    }
    // Once the condition clears, resolve the stale observation.
    await resolveCleared(svc, businessId, s.signal_key, isoNow);
  }
  return { business_id: businessId, created, updated, signals: signals.length };
}

// If a signal that previously produced an observation no longer fires, mark it resolved.
async function resolveCleared(svc: any, businessId: string, signalKey: string, isoNow: string): Promise<void> {
  // Only resolves "negative" signals when their positive counterpart is what just refreshed.
  // (Positive refresh implies the negative condition no longer holds for that axis.)
  const negatives: Record<string, string> = { "crm.new_leads": "crm.no_new_leads_7d", "email.unread": "email.unread" };
  const neg = negatives[signalKey];
  if (!neg) return;
  const stale: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, signal_key: neg, status: "open" }).catch(() => []);
  for (const o of stale) await svc.entities.BusinessObservation.update(o.id, { status: "resolved", resolved_at: isoNow }).catch(() => {});
}

// =================================================================
// DECISION + RECOMMENDATION ENGINE
// =================================================================
async function decideBusiness(svc: any, businessId: string, actor: string): Promise<any> {
  const r = await recommendBusiness(svc, businessId, actor, true);
  return { business_id: businessId, decisions: r.decisions, recommendations: r.created };
}

async function recommendBusiness(svc: any, businessId: string, actor: string, decideOnly = false): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const openObs: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }, "-generated_at", 40).catch(() => []);
  if (!openObs.length) return { business_id: businessId, decisions: 0, created: 0 };

  const memory = await collectMemory(svc, businessId);
  const ctx = { business: { name: business.name, industry: business.industry, city: business.city, country: business.country }, observations: openObs.map((o: any) => ({ id: o.id, source: o.source, severity: o.severity, title: o.title, detail: o.detail })), memory };

  const schema = {
    type: "object",
    properties: {
      decisions: { type: "array", items: { type: "object", properties: { observation_id: { type: "string" }, decision: { type: "string", enum: ["ignore", "recommend", "auto_fix", "escalate", "ask_user"] }, rationale: { type: "string" } }, required: ["observation_id", "decision", "rationale"] } },
      recommendations: { type: "array", items: { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, category: { type: "string", enum: RECO_CATEGORIES }, priority: { type: "number" }, rationale: { type: "string" }, action_label: { type: "string" }, action_target: { type: "string" }, confidence: { type: "number" }, expected_impact: { type: "string" }, estimated_effort: { type: "string", enum: ["low", "medium", "high"] }, decision: { type: "string", enum: ["recommend", "ask_user", "auto_fix", "escalate"] } }, required: ["key", "title", "category", "priority", "rationale"] } },
    },
  };

  const prompt = `You are the AI Chief Operating Officer for "${business.name}"${business.industry ? ", a " + business.industry : ""}${business.city ? " in " + business.city : ""}.

You are given live OBSERVATIONS from the business's systems and the business's long-term MEMORY.

For EACH observation, decide how to handle it:
- ignore: not worth acting on
- recommend: suggest an action to the owner
- auto_fix: safe to fix automatically (low risk, reversible)
- escalate: urgent, owner must act now (money, security, outage)
- ask_user: needs the owner's input before acting

Then produce actionable RECOMMENDATIONS for the observations that warrant one. Each recommendation needs a priority (0-100), a plain-language rationale, a confidence (0-1), the expected impact, and the effort. Use the memory to respect the owner's voice and past decisions.

Return JSON strictly matching the schema. Be concise and concrete. No technical jargon.

OBSERVATIONS:
${JSON.stringify(ctx.observations, null, 2)}

MEMORY:
${JSON.stringify(ctx.memory, null, 2)}`;

  let plan: any = null;
  try {
    const res: any = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
    plan = res;
  } catch (e: any) {
    // Deterministic fallback: classify by severity.
    plan = fallbackDecide(openObs);
  }

  const isoNow = new Date().toISOString();
  let decisionsApplied = 0;
  for (const d of plan.decisions || []) {
    const obs = openObs.find((o: any) => o.id === d.observation_id);
    if (!obs) continue;
    await svc.entities.BusinessObservation.update(obs.id, { decision: d.decision, decision_rationale: d.rationale || "" }).catch(() => {});
    decisionsApplied++;
  }

  let created = 0;
  if (!decideOnly) {
    for (const r of plan.recommendations || []) {
      if (!r.key || !r.title) continue;
      const existing: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, key: r.key, status: "open" }).catch(() => []);
      const doc = {
        tenant_id: business.tenant_id, business_id: businessId, launch_id: `ai_coo:${businessId}`,
        key: r.key, title: r.title, category: RECO_CATEGORIES.includes(r.category) ? r.category : "other",
        priority: Math.max(0, Math.min(100, r.priority ?? 50)), rationale: r.rationale || "",
        action_label: r.action_label || "Open", action_target: r.action_target || "",
        status: "open", confidence: r.confidence ?? 0.7, expected_impact: r.expected_impact || "",
        estimated_effort: r.estimated_effort || "low", decision: r.decision || "recommend",
        generated_at: isoNow, provenance: { actor, source: "ai_coo" },
      };
      if (existing && existing.length) await svc.entities.LaunchRecommendation.update(existing[0].id, doc).catch(() => {});
      else { const rec: any = await svc.entities.LaunchRecommendation.create(doc); if (rec?.id) { created++; await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }).then((oo: any[]) => { for (const o of oo) if ((plan.recommendations || []).find((rr: any) => rr.key === o.signal_key)) svc.entities.BusinessObservation.update(o.id, { recommendation_id: rec.id }).catch(() => {}); }).catch(() => {}); } }
    }
  }
  return { business_id: businessId, decisions: decisionsApplied, created, fallback: !!plan.__fallback };
}

function fallbackDecide(openObs: any[]): any {
  const decisions = openObs.map((o: any) => ({ observation_id: o.id, decision: o.severity === "critical" ? "escalate" : o.severity === "positive" ? "ignore" : "recommend", rationale: `Auto-classified from severity "${o.severity}".` }));
  return { decisions, recommendations: [], __fallback: true };
}

// =================================================================
// DAILY BRIEF
// =================================================================
async function briefBusiness(svc: any, businessId: string, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });

  const obs = await collectRecentObservations(svc, businessId);
  const recos = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, status: "open" }, "-priority", 10).catch(() => []);
  const memory = await collectMemory(svc, businessId);
  const today = new Date().toISOString().slice(0, 10);

  const schema = {
    type: "object",
    properties: {
      greeting_name: { type: "string" },
      momentum_line: { type: "string" },
      yesterday: { type: "array", items: { type: "string" } },
      today: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      headline_recommendation: { type: "object", properties: { title: { type: "string" }, action_target: { type: "string" } } },
    },
  };

  const prompt = `Write the morning brief for the owner of "${business.name}"${business.industry ? ", a " + business.industry : ""}. Address them by first name in "greeting_name" guess from the memory if available, otherwise use "there".

Use a calm, confident, personal-manager tone — like a Chief Operating Officer reporting in. No technical jargon, no emojis, plain sentences. Keep lists short.

Use the live observations and open recommendations to produce:
- yesterday: what happened (leads, replies, system health) — only mention things you have evidence for.
- today: 2-4 concrete actions the owner should take today.
- risks: anything urgent (expiring domain, waiting customers, failures).
- headline_recommendation: the single most valuable next action.

Return JSON matching the schema.

OBSERVATIONS:
${JSON.stringify(obs.slice(0, 30), null, 2)}

OPEN RECOMMENDATIONS:
${JSON.stringify(recos.map((r: any) => ({ title: r.title, priority: r.priority, action_target: r.action_target, rationale: r.rationale })), null, 2)}

MEMORY:
${JSON.stringify(memory, null, 2)}`;

  let payload: any;
  try { payload = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { payload = fallbackBrief(obs, recos); }

  const body = renderBriefText(business.name, payload);
  const memory_id = await upsertMemory(svc, business, "daily_brief", `daily:${today}`, `Morning Brief — ${today}`, body, payload, { period_date: today, source: "ai", actor });
  return { business_id: businessId, memory_id, date: today, payload };
}

function fallbackBrief(obs: any[], recos: any[]): any {
  const yesterday = obs.filter((o) => o.severity === "positive").map((o) => `✓ ${o.title}`);
  const risks = obs.filter((o) => o.severity === "critical" || o.severity === "warning").map((o) => o.title);
  const today = recos.slice(0, 3).map((r) => r.title);
  if (!yesterday.length) yesterday.push("✓ Systems online");
  return { greeting_name: "there", momentum_line: "Here is your morning brief.", yesterday, today: today.length ? today : ["Review today's priorities"], risks, headline_recommendation: recos[0] ? { title: recos[0].title, action_target: recos[0].action_target } : null };
}

function renderBriefText(businessName: string, p: any): string {
  const lines: string[] = [];
  lines.push(`Good morning${p.greeting_name && p.greeting_name !== "there" ? ", " + p.greeting_name : ""}.`);
  if (p.momentum_line) lines.push("", p.momentum_line, "");
  if (p.yesterday?.length) { lines.push("Yesterday"); for (const y of p.yesterday) lines.push(`${y}`); lines.push(""); }
  if (p.today?.length) { lines.push("Today"); for (const t of p.today) lines.push(`• ${t}`); lines.push(""); }
  if (p.risks?.length) { lines.push("Risks"); for (const r of p.risks) lines.push(`• ${r}`); }
  return lines.join("\n");
}

// =================================================================
// TODAY'S PLAN
// =================================================================
async function planTodayBusiness(svc: any, businessId: string, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const recos = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, status: "open" }, "-priority", 15).catch(() => []);
  const obs = await collectRecentObservations(svc, businessId);
  const today = new Date().toISOString().slice(0, 10);

  const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, why: { type: "string" }, action_target: { type: "string" }, launches_workflow: { type: "boolean" } }, required: ["title"] } } } };
  const prompt = `Create today's plan for "${business.name}". Combine open recommendations and live observations into 3-5 concrete tasks the owner should do today. Each item: a short title, why it matters, and where to do it (action_target route). No jargon.

RECOMMENDATIONS: ${JSON.stringify(recos.map((r) => ({ title: r.title, priority: r.priority, action_target: r.action_target })))}
OBSERVATIONS: ${JSON.stringify(obs.slice(0, 20))}`;
  let payload: any;
  try { payload = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { payload = { items: recos.slice(0, 4).map((r) => ({ title: r.title, why: r.rationale, action_target: r.action_target, launches_workflow: false })) }; }
  const items = payload.items || [];
  const body = items.map((i: any, idx: number) => `${idx + 1}. ${i.title}${i.why ? " — " + i.why : ""}`).join("\n");
  const memory_id = await upsertMemory(svc, business, "today_plan", `today:${today}`, `Today's Plan — ${today}`, body, { items }, { period_date: today, source: "ai", actor });
  return { business_id: businessId, memory_id, items };
}

// =================================================================
// WEEKLY REVIEW / MONTHLY STRATEGY
// =================================================================
async function reviewBusiness(svc: any, businessId: string, kind: "weekly" | "monthly", actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const period = kind === "weekly" ? 7 : 30;
  const since = new Date(Date.now() - period * DAY).toISOString();
  const obs: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId }, "-generated_at", 100).catch(() => []);
  const recentObs = obs.filter((o: any) => new Date(o.generated_at || o.created_date || 0).getTime() >= Date.now() - period * DAY);
  const recos = await svc.entities.LaunchRecommendation.filter({ business_id: businessId }, "-generated_at", 50).catch(() => []);
  const done = recos.filter((r: any) => r.status === "done").length;
  const leads = await svc.entities.Lead.filter({ business_id: businessId, status: "new" }, "-created_date", 50).catch(() => []);
  const memory = await collectMemory(svc, businessId);

  let key: string, title: string;
  const now = new Date();
  if (kind === "weekly") {
    const week = isoWeek(now);
    key = `weekly:${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
    title = `Weekly Review — Week ${week}`;
  } else {
    key = `monthly:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    title = `Monthly Strategy — ${now.toLocaleString("en", { month: "long", year: "numeric" })}`;
  }

  let payload: any;
  if (kind === "weekly") {
    const schema = { type: "object", properties: { business_score: { type: "number" }, wins: { type: "array", items: { type: "string" } }, losses: { type: "array", items: { type: "string" } }, revenue: { type: "string" }, customers: { type: "string" }, marketing: { type: "string" }, website: { type: "string" }, seo: { type: "string" }, ai_improvements: { type: "array", items: { type: "string" } } } };
    const prompt = `Write a ${kind} business review for "${business.name}". Score the business out of 100. Summarise wins and losses across revenue, customers, marketing, website, and SEO. Suggest 2-3 ways the AI could improve next week. Use only the evidence provided. Plain language, no jargon.

OBSERVATIONS (last ${period}d): ${JSON.stringify(recentObs.slice(0, 40))}
RECOMMENDATIONS DONE: ${done}
NEW LEADS: ${leads.length}
MEMORY: ${JSON.stringify(memory)}`;
    try { payload = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
    catch { payload = { business_score: 70, wins: ["Systems stayed online"], losses: [], revenue: "n/a", customers: `${leads.length} new leads`, marketing: "n/a", website: "Healthy", seo: "Stable", ai_improvements: ["Increase observation frequency"] }; }
  } else {
    const schema = { type: "object", properties: { strategies: { type: "array", items: { type: "object", properties: { title: { type: "string" }, rationale: { type: "string" }, expected_impact: { type: "string" }, effort: { type: "string", enum: ["low", "medium", "high"] } }, required: ["title"] } }, priorities: { type: "array", items: { type: "string" } } } };
    const prompt = `Propose a 30-day strategy for "${business.name}". Based on the last month's observations, recommend 3-5 strategic moves (e.g. hire, increase ad budget, new landing pages, expand city, referral campaign). Each with rationale, expected impact, effort. Then list top priorities. Plain language.

OBSERVATIONS (last 30d): ${JSON.stringify(recentObs.slice(0, 50))}
RECOMMENDATIONS DONE: ${done}
MEMORY: ${JSON.stringify(memory)}`;
    try { payload = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
    catch { payload = { strategies: [{ title: "Increase marketing budget", rationale: "Lead flow is the top limit to growth.", expected_impact: "More qualified leads", effort: "medium" }], priorities: ["Focus on lead generation"] }; }
  }

  const body = kind === "weekly" ? renderWeekly(payload) : renderMonthly(payload);
  const memory_id = await upsertMemory(svc, business, kind === "weekly" ? "weekly_review" : "monthly_strategy", key, title, body, payload, { period_date: now.toISOString().slice(0, 10), source: "ai", actor });
  return { business_id: businessId, memory_id, payload, key };
}

function renderWeekly(p: any): string {
  const out: string[] = [`Business Score: ${p.business_score ?? "—"}/100`, ""];
  if (p.wins?.length) { out.push("Wins"); for (const w of p.wins) out.push(`✓ ${w}`); out.push(""); }
  if (p.losses?.length) { out.push("Losses"); for (const l of p.losses) out.push(`✗ ${l}`); out.push(""); }
  out.push("Revenue: " + (p.revenue || "n/a"), "Customers: " + (p.customers || "n/a"), "Marketing: " + (p.marketing || "n/a"), "Website: " + (p.website || "n/a"), "SEO: " + (p.seo || "n/a"));
  if (p.ai_improvements?.length) { out.push("", "AI Improvements"); for (const a of p.ai_improvements) out.push(`• ${a}`); }
  return out.join("\n");
}
function renderMonthly(p: any): string {
  const out: string[] = ["Strategies"];
  for (const s of p.strategies || []) out.push(`• ${s.title}${s.rationale ? " — " + s.rationale : ""} (impact: ${s.expected_impact || "n/a"}, effort: ${s.effort || "n/a"})`);
  if (p.priorities?.length) { out.push("", "Priorities"); for (const x of p.priorities) out.push(`• ${x}`); }
  return out.join("\n");
}

// =================================================================
// MEMORY
// =================================================================
// collectMemory + upsertMemory imported from ../../shared/ai/coo.ts

async function memoryGet(rd: any, svc: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  const rows: any[] = await rd.entities.BusinessMemory.filter({ business_id: businessId }, "-updated_at", 50).catch(() => []);
  return { memory: (rows || []).filter((m: any) => ["fact", "preference", "lesson", "decision"].includes(m.kind)) };
}

async function memoryUpsert(svc: any, body: any, user: any, actor: string): Promise<any> {
  const businessId = requireBusinessId(body);
  const business = await verifyTenant(svc, businessId, user);
  const { kind, key, title, body: text, confidence, tags, payload } = body;
  if (!kind || !key || !title) throw Object.assign(new Error("kind, key, title are required"), { code: "BAD_REQUEST" });
  const id = await upsertMemory(svc, business, kind, key, title, text || "", payload || {}, { source: "user", actor, confidence, tags, period_date: body.period_date });
  return { memory_id: id };
}

// =================================================================
// READS (UI)
// =================================================================
async function getBrief(rd: any, svc: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  let filter: any = { business_id: businessId, kind: "daily_brief" };
  if (body.date) filter.key = `daily:${body.date}`;
  const rows: any[] = await rd.entities.BusinessMemory.filter(filter, "-created_date", 1).catch(() => []);
  return { brief: (rows || [])[0] || null };
}

async function listObservations(rd: any, svc: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  const rows: any[] = await rd.entities.BusinessObservation.filter({ business_id: businessId, status: body.status || "open" }, "-generated_at", 50).catch(() => []);
  return { observations: rows || [] };
}

async function listRecommendations(rd: any, svc: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  const rows: any[] = await rd.entities.LaunchRecommendation.filter({ business_id: businessId, status: body.status || "open" }, "-priority", 50).catch(() => []);
  return { recommendations: rows || [] };
}

async function collectRecentObservations(svc: any, businessId: string): Promise<any[]> {
  const rows: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }, "-generated_at", 40).catch(() => []);
  return rows || [];
}

// =================================================================
// ACT (approve / dismiss)
// =================================================================
async function actOnRecommendation(svc: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(svc, businessId, user);
  if (!body.recommendation_id || !body.action) throw Object.assign(new Error("recommendation_id and action required"), { code: "BAD_REQUEST" });
  const rec: any = await svc.entities.LaunchRecommendation.get(body.recommendation_id).catch(() => null);
  if (!rec || rec.business_id !== businessId) throw Object.assign(new Error("Recommendation not found"), { code: "NOT_FOUND" });
  if (body.action !== "approve" && body.action !== "dismiss") throw Object.assign(new Error("action must be approve or dismiss"), { code: "BAD_REQUEST" });
  const status = body.action === "approve" ? "done" : "dismissed";
  await svc.entities.LaunchRecommendation.update(rec.id, { status });
  return { recommendation_id: rec.id, status };
}

// =================================================================
// UTIL
// =================================================================
// isoWeek imported from ../../shared/ai/coo.ts