// Observability backend — Langfuse control + platform health metrics.
//
// Actions:
//   probe   → report AsyncLocalStorage availability + config status (NO secrets).
//   health  → Langfuse connection state (non-blocking; never affects app health).
//   metrics → platform health metrics from the EXISTING database (LaunchPlan,
//             LaunchTask, AIExecution, UsageLog, CostLog). Does NOT duplicate the
//             Langfuse dashboard — answers "is my orchestrator healthy?".
//   test    → emit a synthetic trace + span + generation(s) to Langfuse and
//             return the ingestion result. Used for acceptance verification.
//
// Admin-only. Never returns secret values.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  getObsConfig,
  checkLangfuseHealth,
  ObservabilityService,
  hasAsyncLocalStorage,
} from "../../shared/observability/index.ts";

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function p95(vals: number[]): number | null {
  const xs = vals.filter((v) => typeof v === "number" && v >= 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1);
  return xs[Math.max(0, idx)];
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden: platform administrators only" }, { status: 403 });

    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const cfg = getObsConfig();

    if (action === "probe") {
      return Response.json({
        asyncLocalStorage: await hasAsyncLocalStorage(),
        configured: cfg.configured,
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl,
        sampleRate: cfg.sampleRate,
        captureInput: cfg.captureInput,
        captureOutput: cfg.captureOutput,
      });
    }

    if (action === "health") {
      const health = await checkLangfuseHealth(cfg);
      return Response.json({ langfuse: health, configured: cfg.configured, enabled: cfg.enabled, baseUrl: cfg.baseUrl });
    }

    if (action === "metrics") {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const ts = (r: any) => (r && (r.occurred_at || r.created_date)) || "";
      const runs: any[] = await svc.entities.LaunchPlan.filter({}, "-created_date", 200).catch(() => []);
      const tasks: any[] = await svc.entities.LaunchTask.filter({}, "-created_date", 500).catch(() => []);
      const execs: any[] = await svc.entities.AIExecution.filter({}, "-created_date", 500).catch(() => []);
      const usage: any[] = await svc.entities.UsageLog.filter({ service: "ai" }).catch(() => []);
      const costs: any[] = await svc.entities.CostLog.filter({ service: "ai" }).catch(() => []);

      const activeRuns = runs.filter((r) => ["running", "awaiting_approval", "paused", "paused_approval", "ready"].includes(r.status)).length;
      const runsToday = runs.filter((r) => ts(r) && ts(r) >= startToday).length;
      const completedRuns = runs.filter((r) => r.status === "completed").length;
      const failedRuns = runs.filter((r) => r.status === "failed").length;
      const totalRuns = completedRuns + failedRuns;
      const successRate = totalRuns ? Math.round((completedRuns / totalRuns) * 100) : null;
      const errorRate = totalRuns ? Math.round((failedRuns / totalRuns) * 100) : null;

      const tasksToday = tasks.filter((t) => ts(t) && ts(t) >= startToday).length;
      const toolCalls = tasks.filter((t) => t.status === "completed").length + tasksToday;

      const lat = execs.map((e) => e.latency_ms).filter((x) => typeof x === "number" && x >= 0);
      const avgLatency = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
      const p95Latency = p95(lat);

      const aiUsageToday = usage.filter((u) => ts(u) && ts(u) >= startToday);
      const aiRequestsToday = aiUsageToday.length;
      const aiSpendToday = costs.filter((c) => ts(c) && ts(c) >= startToday).reduce((n, c) => n + (c.cost_amount || c.estimated_amount || 0), 0);
      const aiSpendMonth = costs
        .filter((c) => ts(c) && ts(c) >= new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
        .reduce((n, c) => n + (c.cost_amount || c.estimated_amount || 0), 0);

      // Provider failures (today): failed AIExecutions grouped by provider.
      const failsToday = execs.filter((e) => !e.success && ts(e) && ts(e) >= startToday);
      const providerFailures: Record<string, number> = {};
      for (const e of failsToday) {
        const k = e.provider || "(unknown)";
        providerFailures[k] = (providerFailures[k] || 0) + 1;
      }

      return Response.json({
        runs: { active: activeRuns, today: runsToday, completed: completedRuns, failed: failedRuns, successRate, errorRate },
        tasks: { today: tasksToday, toolCalls },
        ai: { requestsToday: aiRequestsToday, tokensToday: aiUsageToday.reduce((n, u) => n + (u.usage_quantity || 0), 0), spendToday: aiSpendToday, spendMonth: aiSpendMonth },
        latency: { avg: avgLatency, p95: p95Latency },
        providerFailures,
        langfuse: { configured: cfg.configured, enabled: cfg.enabled },
      });
    }

    if (action === "test") {
      // Emit a synthetic trace: workflow span + a FAILING generation (attempt 1)
      // then a SUCCESS generation (attempt 2 = failover) + a tool span, then flush.
      // `force` lets acceptance tests prove event creation + flush mechanics even
      // when Langfuse credentials are not yet populated (flush then fails auth,
      // which itself proves the pipeline is wired and non-fatal).
      const testCfg = body.force ? { ...cfg, enabled: true } : cfg;
      const obs = new ObservabilityService(testCfg, { kind: "test", tenant_id: body.tenant_id || "system", actor: user?.email || "system" });
      obs.startTrace("observability:smoke", { purpose: "phase-12.6 acceptance", probe_id: uuid() });
      const wf = obs.startSpan({ name: "workflow", parentObservationId: null, metadata: { template_id: "observability_smoke", version: 1, task_count: 1 } });
      const task = obs.startSpan({ name: "launch_task:smoke", parentObservationId: wf.id, metadata: { task_key: "smoke", task_type: "generate_smoke" } });
      obs.recordGeneration({
        parentObservationId: task.id, name: "llm:smoke.attempt-1",
        provider: "smoke-provider-a", providerId: "a", adapterKey: "openai_compatible", model: "smoke-model",
        attempt: 1, success: false, tokens: { prompt: 10, completion: 0, total: 10 },
        estimatedCost: 0, currency: "USD", latencyMs: 120, retryable: true,
        errorCode: "PROVIDER_TIMEOUT", errorMessage: "Simulated provider timeout (acceptance test).",
        requestId: uuid(),
      });
      const gen2 = obs.recordGeneration({
        parentObservationId: task.id, name: "llm:smoke.attempt-2-failover",
        provider: "smoke-provider-b", providerId: "b", adapterKey: "anthropic", model: "smoke-model-b",
        attempt: 2, success: true, tokens: { prompt: 10, completion: 5, total: 15 },
        estimatedCost: 0.0001, currency: "USD", latencyMs: 240, retryable: false,
        requestId: uuid(),
      });
      obs.startTrace; // no-op marker
      obs.recordGeneration({
        parentObservationId: null, name: "llm:smoke.tool",
        provider: "smoke-tool", model: "smoke-tool-model", attempt: 1, success: true,
        tokens: { total: 0 }, latencyMs: 8, metadata: { tool: "sitemap", capability: "tool" }, requestId: uuid(),
      });
      obs.endSpan(task, { status: "completed" });
      obs.endSpan(wf, { status: "completed" });
      const flush = await obs.flush();
      return Response.json({
        ok: true,
        configured: cfg.configured,
        enabled: testCfg.enabled,
        forced: !!body.force,
        events: obs.events.length,
        hasError: obs.hasError,
        sampledOut: obs.sampledOut,
        flush,
        genId: gen2,
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}