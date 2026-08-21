// Agent Lifecycle + Definition Safety (Phase 13b) — configuration validation,
// the standard (auto-seeded) agent catalog, and the customer-safe lifecycle
// projection. Reuses the existing Workflow Engine / LaunchTask / AIAgent
// status; this module NEVER invents a second execution-state system.
//
// Lifecycle (spec step 2) is MAPPED from the engine's real states, not stored:
//   DRAFT            -> AIAgent.status === "draft"
//   READY            -> AIAgent.status === "active" (validated & enabled)
//   RUNNING          -> a LaunchTask(type=run_agent) for this agent is running/retrying
//   WAITING_APPROVAL -> such a task is awaiting_approval (an approval_gate precedes it)
//   COMPLETED        -> the latest such task completed
//   FAILED           -> the latest such task failed
//   PAUSED           -> AIAgent.status === "paused"
//
// The admin UI consumes mapAgentLifecycle(); the customer never sees these codes.

import { CAPABILITIES } from "../actions/capabilities.ts";

// ============================================================
// CONFIGURATION VALIDATION (spec step 3) — an agent cannot become
// READY/active with an invalid config. Friendly errors only.
// ============================================================
export function validateAgentConfig(name: any, instructions: any, cfg: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = cfg || {};
  if (!name || !String(name).trim()) errors.push("Give your agent a name.");
  if (!instructions || !String(instructions).trim()) errors.push("Your agent needs instructions (a system prompt).");
  const tools = Array.isArray(c.tools) ? c.tools : [];
  for (const t of tools) {
    if (!CAPABILITIES[t]) errors.push(`The tool "${t}" isn't available to agents.`);
  }
  if (tools.length !== new Set(tools).size) errors.push("Each tool can only be listed once.");
  const mi = Number(c.max_iterations);
  if (!(!isNaN(mi) && mi >= 1 && mi <= 5)) errors.push("Max iterations must be between 1 and 5.");
  const mt = Number(c.max_tool_calls);
  if (!(!isNaN(mt) && mt >= 0 && mt <= 50)) errors.push("Max tool calls must be between 0 and 50.");
  const to = Number(c.timeout_ms);
  if (!(!isNaN(to) && to >= 1000 && to <= 600000)) errors.push("Timeout must be between 1s and 10 minutes.");
  const bl = Number(c.budget_limit ?? 0);
  if (!(!isNaN(bl) && bl >= 0)) errors.push("Budget limit must be 0 or more (0 = unlimited).");
  const os = c.output_schema;
  if (os && (typeof os !== "object" || os.type !== "object" || !os.properties || !Array.isArray(os.required))) {
    errors.push("Output schema must be a JSON object schema with required fields listed.");
  }
  return { ok: errors.length === 0, errors };
}

// ============================================================
// STANDARD AGENT CATALOG (spec step 12/13) — the zero-touch agents the
// platform auto-seeds per business so customers never name an agent. Each
// entry keys a capability's `agentPurpose`. Idempotent by name.
// ============================================================
export interface StandardAgentDef {
  name: string;
  description: string;
  purpose: string[];
  instructions: string;
  config: any;
}

export const STANDARD_AGENTS: Record<string, StandardAgentDef> = {
  website_analysis: {
    name: "Website Analyzer",
    description: "Fetches a public website and returns a structured analysis (title, summary, technologies, confidence).",
    purpose: ["website_analysis"],
    instructions: "You are the Website Analyzer. Use the website_fetch tool with the URL from the objective, then return a concise structured analysis: what the site is, its title, the technologies it uses, and a confidence score (0-1). Be grounded in the fetched tool result — never invent details.",
    config: {
      tools: ["website_fetch"], max_iterations: 2, max_tool_calls: 3, timeout_ms: 60000,
      temperature: 0.3, budget_limit: 0, approval_required: false,
      output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" }, confidence: { type: "number" } }, required: ["answer", "tool_used", "result_summary"] },
    },
  },
};

// Resolve (or idempotently create) the standard agent for a capability's
// declared agentPurpose. Returns the AIAgent record. Used by the Action Engine
// so a customer saying "analyze my website" gets the real agent — no setup.
export async function resolveStandardAgent(svc: any, business: any, agentPurpose: string): Promise<any> {
  const def = STANDARD_AGENTS[agentPurpose];
  if (!def) throw Object.assign(new Error(`No standard agent for purpose ${agentPurpose}`), { code: "AGENT_NOT_CONFIGURED" });
  const existing: any[] = await svc.entities.AIAgent.filter({ business_id: business.id, name: def.name }).catch(() => []);
  if (existing && existing.length) return existing[0];
  const row = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: def.name, description: def.description,
    purpose: def.purpose, instructions: def.instructions, status: "active",
    human_escalation_enabled: true, lead_capture_enabled: false, config: def.config, last_run_at: null,
  });
  return row;
}

// ============================================================
// LIFECYCLE PROJECTION (spec step 2) — maps the truthful engine/AIAgent state
// to the documented lifecycle for the admin UI. Pure read; no state mutation.
// ============================================================
export function mapAgentLifecycle(agent: any, tasks: any[]): string {
  if (!agent) return "draft";
  if (agent.status === "paused") return "paused";
  if (agent.status === "failed") return "failed";
  if (agent.status !== "active") return "draft"; // draft / training
  const mine = (tasks || []).filter((t) => t.type === "run_agent" && t.input_context && t.input_context.agent_id === agent.id);
  if (!mine.length) return "ready";
  const awaiting = mine.find((t) => t.status === "awaiting_approval");
  if (awaiting) return "waiting_approval";
  const running = mine.find((t) => ["running", "retrying", "ready", "pending"].includes(t.status));
  if (running) return "running";
  const latest = mine.sort((a, b) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime())[0];
  if (latest.status === "completed") return "completed";
  if (["failed", "blocked", "rejected", "cancelled"].includes(latest.status)) return "failed";
  return "ready";
}