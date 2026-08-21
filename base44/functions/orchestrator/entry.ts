// Business Operations Orchestrator — external + internal API surface.
// HTTP actions: launch | step | status | next-action | approve | reject |
// retry | cancel | seed-templates | list-templates. All state is durable in
// entities; functions are stateless so Run state survives every restart.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  launchRun, advanceRun, approveTask, rejectTask, skipTask, retryTask, cancelRun, runStatus,
  dispatchStandaloneTask, ensureSeedTemplates, runDependencyTest, runDomainTest,
  defineTemplate, runParallelTest, runFullRegression,
} from "../../shared/operations/engine.ts";
import { startChatGPTBase44Loop, loopStatus as chatgptLoopStatus, recordLoopStep, resumeLoop } from "../../shared/orchestration/chatgptBase44Loop.ts";

const auth = async (req: Request) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  return { base44, user };
};

const actorOf = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || "system";

export default async function (req: Request): Promise<Response> {
  try {
    const { base44, user } = await auth(req);
    const svc = base44.asServiceRole;
    // Stash the full base44 client on svc so factory adapters can reach the truthful
    // provider runtime (executeAIChat needs base44.asServiceRole + secrets + integrations).
    try { (svc as any).__base44 = base44; } catch { try { Object.defineProperty(svc, "__base44", { value: base44, enumerable: false, writable: false, configurable: false }); } catch {} }
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const actor = actorOf(user);

    // Persistent ChatGPT ↔ Base44 engineering loop. This stores orchestration state
    // inside the app; ChatGPT uses Base44 tools as the executor between steps.
    if (action === "chatgpt-loop-start") {
      if (!body.business_id) return Response.json({ error: "business_id is required" }, { status: 400 });
      return Response.json(await startChatGPTBase44Loop(svc, { businessId: body.business_id, actor, goal: body.goal }));
    }
    if (action === "chatgpt-loop-status") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      return Response.json(await chatgptLoopStatus(svc, body.run_id));
    }
    if (action === "chatgpt-loop-record") {
      if (!body.run_id || !body.outcome || !body.summary) return Response.json({ error: "run_id, outcome and summary are required" }, { status: 400 });
      if (!["PASS", "NEEDS_FIX", "BLOCKED", "DONE"].includes(body.outcome)) return Response.json({ error: "Invalid outcome" }, { status: 400 });
      return Response.json(await recordLoopStep(svc, { runId: body.run_id, actor, outcome: body.outcome, summary: body.summary, evidence: body.evidence }));
    }
    if (action === "chatgpt-loop-resume") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      return Response.json(await resumeLoop(svc, { runId: body.run_id, actor }));
    }

    if (action === "seed-templates") {
      await ensureSeedTemplates(svc);
      return Response.json({ ok: true });
    }
    if (action === "list-templates") {
      const rows = await svc.entities.PlanTemplate.filter({ active: true }).catch(() => []);
      const latest: Record<string, any> = {};
      for (const r of rows || []) { if (!latest[r.template_id] || (r.version || 0) > (latest[r.template_id].version || 0)) latest[r.template_id] = r; }
      return Response.json({ templates: Object.values(latest).map((t) => ({ template_id: t.template_id, version: t.version, name: t.name, lifecycle_goal: t.lifecycle_goal, task_count: (t.tasks || []).length })) });
    }

    if (action === "launch") {
      if (!body.business_id || !body.template_id) return Response.json({ error: "business_id and template_id are required" }, { status: 400 });
      let res: any;
      try {
        res = await launchRun(svc, { businessId: body.business_id, templateId: body.template_id, goal: body.goal, requestedBy: actor, input: body.input });
      } catch (e: any) {
        return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.code === "BUSINESS_NOT_FOUND" || e.code === "PLAN_INVALID" ? 400 : 500 });
      }
      return Response.json(res);
    }

    if (action === "step") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      const res = await advanceRun(svc, { runId: body.run_id, actor });
      return Response.json(res);
    }

    if (action === "status") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      return Response.json(await runStatus(svc, { runId: body.run_id }));
    }

    if (action === "next-action") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      const s = await runStatus(svc, { runId: body.run_id });
      return Response.json(s.next_action);
    }

    if (action === "approve") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      try { return Response.json(await approveTask(svc, { runId: body.run_id, taskId: body.task_id, decision: body.decision, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "NOTHING_TO_APPROVE" ? 400 : 500 }); }
    }

    if (action === "reject") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      try { return Response.json(await rejectTask(svc, { runId: body.run_id, taskId: body.task_id, reason: body.reason, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "NOTHING_TO_REJECT" ? 400 : 500 }); }
    }

    if (action === "skip") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      try { return Response.json(await skipTask(svc, { runId: body.run_id, taskId: body.task_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "NOTHING_TO_SKIP" ? 400 : 500 }); }
    }

    if (action === "retry") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      try { return Response.json(await retryTask(svc, { runId: body.run_id, taskId: body.task_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "NOTHING_TO_RETRY" || e.code === "MAX_RETRIES" ? 400 : 500 }); }
    }

    if (action === "cancel") {
      if (!body.run_id) return Response.json({ error: "run_id is required" }, { status: 400 });
      return Response.json(await cancelRun(svc, { runId: body.run_id, actor }));
    }

    // Dispatch a single factory adapter (e.g. generate_crm) as a 1-task Run through
    // the SAME orchestrator path the full DAG uses. Used by Factory UI pages that
    // must not call factory functions directly.
    if (action === "dispatch-task") {
      if (!body.business_id || !body.task_type || !body.task_key) return Response.json({ error: "business_id, task_type and task_key are required" }, { status: 400 });
      try {
        const res = await dispatchStandaloneTask(svc, { businessId: body.business_id, taskType: body.task_type, taskKey: body.task_key, capability: body.capability, goal: body.goal, requestedBy: actor, input: body.input });
        return Response.json(res);
      } catch (e: any) {
        return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.code === "BUSINESS_NOT_FOUND" || e.code === "PLAN_INVALID" ? 400 : 500 });
      }
    }

    // Run the dependency-DAG integration test (happy ordering + transitive
    // blocking + idempotent resume). Returns pass/fail assertions. Test-only.
    if (action === "run-dependency-test") {
      if (!body.business_id) return Response.json({ error: "business_id is required" }, { status: 400 });
      try { return Response.json(await runDependencyTest(svc, { businessId: body.business_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    // Run the Domain-adapter integration test (real adapter via deterministic mock
    // registrar). Returns pass/fail assertions. Test-only.
    if (action === "run-domain-test") {
      if (!body.business_id) return Response.json({ error: "business_id is required" }, { status: 400 });
      try { return Response.json(await runDomainTest(svc, { businessId: body.business_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    // Generic workflow engine surface (Phase 6). `create-workflow` is an alias of
    // `launch` — any module starts a workflow Run from a registered template_id.
    // `define-template` registers an arbitrary DAG at runtime (engine is
    // workflow-agnostic; launch_business is one template). Legacy launch actions
    // remain unchanged and backward compatible.
    if (action === "create-workflow") {
      if (!body.business_id || !body.template_id) return Response.json({ error: "business_id and template_id are required" }, { status: 400 });
      try { return Response.json(await launchRun(svc, { businessId: body.business_id, templateId: body.template_id, goal: body.goal, requestedBy: actor, input: body.input })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.code === "BUSINESS_NOT_FOUND" || e.code === "PLAN_INVALID" ? 400 : 500 }); }
    }

    if (action === "define-template") {
      try { return Response.json(await defineTemplate(svc, { templateId: body.template_id, name: body.name, tasks: body.tasks, description: body.description, lifecycleGoal: body.lifecycle_goal, overwrite: body.overwrite, tenant: body.tenant })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.code === "PLAN_INVALID" ? 400 : 500 }); }
    }

    if (action === "run-parallel-test") {
      if (!body.business_id) return Response.json({ error: "business_id is required" }, { status: 400 });
      try { return Response.json(await runParallelTest(svc, { businessId: body.business_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    if (action === "run-full-regression") {
      if (!body.business_id) return Response.json({ error: "business_id is required" }, { status: 400 });
      try { return Response.json(await runFullRegression(svc, { businessId: body.business_id, actor })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    if (error?.code === "UNAUTHORIZED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}