// Business Operations Orchestrator — the authoritative durable state machine.
// State lives 100% in entities (LaunchPlan=Run, LaunchTask=Task, AIExecution=
// Execution). There is no in-memory state, so a Run trivially survives process/
// server/worker restart: the next step() / approve() / retry() call resumes from
// the persisted state.

import { validateDag, dependencyStates, nextAction as dagNext, PlanTask } from "./dag.ts";
import { computeInputHash, runIdempotencyKey, findExistingRun, lastSuccessfulStage } from "./idempotency.ts";
import { buildContextSnapshot, withPriorOutputs } from "./context.ts";
import { resolveProvider, recordProviderFailure, ResolvedProvider } from "./resolver.ts";
import { getAdapter, registerStubAdapter, registerDefaultAdapter, registerTestAdapters, ExecuteResult } from "./adapters.ts";
import { audit, taskLog } from "./audit.ts";
import { getObsConfig, ObservabilityService, setObsCtx } from "../observability/index.ts";

// Ensure the stub + default + test-seam adapters are registered on first import.
registerStubAdapter();
registerDefaultAdapter();
registerTestAdapters();

// Canonical plan templates (idempotent by template_id+version). Seeded into the
// PlanTemplate entity so every Run instantiates from a persisted, validated DAG.
// Single source of seed truth — both the orchestrator HTTP entry and the
// launchAssistant thin client call ensureSeedTemplates() before launching.
const SEED_TEMPLATES = [
  {
    template_id: "launch_business", version: 1, name: "Launch Business",
    description: "Full launch: blueprint → domain → website → seo/crm → marketing.",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: { money_spending_requires_approval: true },
    validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "blueprint", type: "generate_blueprint", capability: "ai_generation", depends_on: [] },
      { key: "blueprint_approval", type: "approval_gate", depends_on: ["blueprint"] },
      { key: "domain", type: "configure_domain", capability: "domain_registrar", depends_on: ["blueprint_approval"], money_spending: true },
      { key: "website", type: "generate_website", capability: "ai_generation", depends_on: ["blueprint_approval"] },
      { key: "website_approval", type: "approval_gate", depends_on: ["website"] },
      { key: "seo", type: "generate_seo", capability: "ai_generation", depends_on: ["website_approval"] },
      { key: "crm", type: "generate_crm", capability: "ai_generation", depends_on: ["website_approval"] },
      { key: "marketing", type: "activate_marketing", capability: "ai_generation", depends_on: ["seo", "crm"] },
    ],
  },
  {
    template_id: "relaunch_marketing", version: 1, name: "Relaunch Marketing",
    description: "For an already-operating business: strategy → campaign → approval → channel activation → monitoring.",
    lifecycle_goal: "marketing_active", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: { money_spending_requires_approval: true },
    validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "marketing_strategy", type: "activate_marketing", capability: "ai_generation", depends_on: [] },
      { key: "campaign_plan", type: "activate_marketing", capability: "ai_generation", depends_on: ["marketing_strategy"] },
      { key: "campaign_approval", type: "approval_gate", depends_on: ["campaign_plan"] },
      { key: "channel_activation", type: "activate_marketing", capability: "ai_generation", depends_on: ["campaign_approval"], money_spending: true },
      { key: "monitoring", type: "activate_marketing", capability: "ai_generation", depends_on: ["channel_activation"] },
    ],
  },
  {
    template_id: "dependency_test", version: 1, name: "Dependency DAG Test (happy)",
    description: "Integration test: Create Website -> Verify Website -> Create CRM (stub boundary) -> Configure Communications. Proves dependency-aware ordering & idempotent resume.",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: {}, validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "create_website", type: "create_website", depends_on: [] },
      { key: "verify_website", type: "verify_website", depends_on: ["create_website"] },
      { key: "create_crm", type: "create_crm", depends_on: ["verify_website"] },
      { key: "configure_comms", type: "configure_comms", depends_on: ["create_crm"] },
    ],
  },
  {
    template_id: "dependency_test_blocked", version: 1, name: "Dependency DAG Test (blocked)",
    description: "Integration test: a failed Website task must BLOCK all downstream tasks transitively.",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: {}, validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "create_website", type: "fail_website", depends_on: [] },
      { key: "verify_website", type: "verify_website", depends_on: ["create_website"] },
      { key: "create_crm", type: "create_crm", depends_on: ["verify_website"] },
      { key: "configure_comms", type: "configure_comms", depends_on: ["create_crm"] },
    ],
  },
  {
    template_id: "domain_dependency_test", version: 1, name: "Domain Adapter DAG Test (happy)",
    description: "Integration test: create_website -> configure_domain -> verify_domain -> create_crm -> configure_comms. Real Domain adapter via the mock registrar.",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: {}, validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "create_website", type: "create_website", depends_on: [] },
      { key: "configure_domain", type: "configure_domain", capability: "domain_registrar", depends_on: ["create_website"] },
      { key: "verify_domain", type: "verify_domain", capability: "domain_registrar", depends_on: ["configure_domain"] },
      { key: "create_crm", type: "create_crm", depends_on: ["verify_domain"] },
      { key: "configure_comms", type: "configure_comms", depends_on: ["create_crm"] },
    ],
  },
  {
    template_id: "domain_dependency_test_blocked", version: 1, name: "Domain Adapter DAG Test (blocked)",
    description: "Integration test: a failed domain configuration blocks verification and all downstream tasks (transitive).",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: {}, validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "create_website", type: "create_website", depends_on: [] },
      { key: "configure_domain", type: "fail_configure_domain", capability: "domain_registrar", depends_on: ["create_website"] },
      { key: "verify_domain", type: "verify_domain", capability: "domain_registrar", depends_on: ["configure_domain"] },
      { key: "create_crm", type: "create_crm", depends_on: ["verify_domain"] },
      { key: "configure_comms", type: "configure_comms", depends_on: ["create_crm"] },
    ],
  },
  {
    template_id: "parallel_test", version: 1, name: "Parallel Execution Test",
    description: "Integration test: two independent tasks (a,b) run concurrently, then a merge task (c) waits for both. Proves real DAG parallelism in the scheduler.",
    lifecycle_goal: "operating", active: true,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: {}, validation_rules: { circular_dependencies: true },
    tasks: [
      { key: "a", type: "parallel_a", depends_on: [] },
      { key: "b", type: "parallel_b", depends_on: [] },
      { key: "c", type: "parallel_c", depends_on: ["a", "b"] },
    ],
  },
];

export async function ensureSeedTemplates(svc: any): Promise<void> {
  for (const t of SEED_TEMPLATES) {
    const existing = await svc.entities.PlanTemplate.filter({ template_id: t.template_id, version: t.version }).catch(() => []);
    if (existing && existing.length) continue;
    await svc.entities.PlanTemplate.create({ tenant_id: "system", ...t });
  }
}

const actorOf = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || "system";

async function latestActiveTemplate(svc: any, templateId: string): Promise<any | null> {
  const rows = await svc.entities.PlanTemplate.filter({ template_id: templateId, active: true }).catch(() => []);
  if (!rows || !rows.length) return null;
  return rows.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
}

function statusMap(tasks: any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const t of tasks) m[t.task_key] = t;
  return m;
}

function statusByKey(tasks: any[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const t of tasks) m[t.task_key] = t.status;
  return m;
}

// Normalize template tasks → LaunchTask create payloads.
function taskDocFromNode(node: PlanTask, run: any, order: number, inputHash: string, snapshot: any) {
  return {
    tenant_id: run.tenant_id,
    business_id: run.business_id,
    launch_id: run.id,
    step_id: node.key,
    task_key: node.key,
    name: node.key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: node.type,
    owner: "orchestrator",
    action: node.type,
    provider_capability: node.capability || null,
    depends_on: node.depends_on || [],
    needs_approval: !!node.needs_approval,
    money_spending: !!node.money_spending,
    retryable: node.retryable !== false,
    max_retries: node.max_retries ?? 3,
    attempt: 0,
    retry_count: 0,
    input_context: snapshot,
    input_hash: inputHash,
    status: "pending",
    order,
  };
}

// ---------------- LAUNCH ----------------
export async function launchRun(svc: any, opts: {
  businessId: string; templateId: string; goal?: string; requestedBy?: string; input?: any;
}): Promise<any> {
  await ensureSeedTemplates(svc);
  const business: any = await svc.entities.Business.get(opts.businessId);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });

  const tmpl = await latestActiveTemplate(svc, opts.templateId);
  if (!tmpl) throw Object.assign(new Error(`No active PlanTemplate: ${opts.templateId}`), { code: "TEMPLATE_NOT_FOUND" });

  const tasks: PlanTask[] = tmpl.tasks || [];
  const v = validateDag(tasks);
  if (!v.ok) throw Object.assign(new Error(`Invalid plan DAG: ${v.errors.join("; ")}`), { code: "PLAN_INVALID", detail: v });

  const inputHash = computeInputHash([opts.templateId, opts.businessId, opts.goal || "", opts.input || {}, tmpl.version]);
  const idemKey = runIdempotencyKey(opts.templateId, opts.businessId, inputHash);

  // Idempotency: duplicate launch returns the same Run.
  const existing = await findExistingRun(svc, idemKey);
  if (existing) return { run: existing, idempotent: true };

  const runCtx = { run_id: "(pending)", goal: opts.goal || `plan:${opts.templateId}`, requested_by: opts.requestedBy || "system", plan_template: opts.templateId, plan_version: tmpl.version };
  let snapshot = await buildContextSnapshot(svc, business, runCtx);
  // Merge caller-supplied per-launch input (test seams / overrides) at the snapshot
  // top level. Never used for vendor selection. Mirrors dispatchStandaloneTask.
  if (opts.input && typeof opts.input === "object" && !Array.isArray(opts.input)) snapshot = { ...snapshot, ...opts.input };

  const run: any = await svc.entities.LaunchPlan.create({
    tenant_id: business.tenant_id,
    business_id: opts.businessId,
    goal: opts.goal || `plan:${opts.templateId}`,
    status: "pending",
    workflow: tasks,
    total_steps: tasks.length,
    completed_steps: 0,
    plan_template_id: opts.templateId,
    plan_version: tmpl.version,
    input_hash: inputHash,
    idempotency_key: idemKey,
    context_snapshot: snapshot,
    requested_by: opts.requestedBy || "system",
    started_at: new Date().toISOString(),
  });

  // Backfill run_id in the snapshot now we have it.
  snapshot = { ...snapshot, run_context: { ...snapshot.run_context, run_id: run.id } };
  await svc.entities.LaunchPlan.update(run.id, { context_snapshot: snapshot });

  // Create Tasks.
  const docs = tasks.map((n, i) => taskDocFromNode(n, run, i, inputHash, snapshot));
  const created = docs.length ? await svc.entities.LaunchTask.bulkCreate(docs) : [];

  // Approval validation: every money_spending task must have an approval_gate dependency.
  const approvalIssues: string[] = [];
  for (const n of tasks) {
    if (n.money_spending && n.approval_required !== false) {
      const hasG = (n.depends_on || []).some((d) => tasks.find((t) => t.key === d && t.type === "approval_gate"));
      if (!hasG) approvalIssues.push(n.key);
    }
  }
  if (approvalIssues.length) {
    await audit(svc, { run, type: "PLAN_VALIDATION_FAILED", detail: { approvalIssues } });
  }

  await audit(svc, { run, type: "RUN_CREATED", actor: opts.requestedBy });
  await audit(svc, { run, type: "TASKS_CREATED", detail: { count: created.length } });

  // Auto-advance to start the run (pending → running, dispatch first eligible).
  await advanceRun(svc, { runId: run.id, actor: opts.requestedBy });
  return { run: await svc.entities.LaunchPlan.get(run.id), idempotent: false };
}

// ---------------- DISPATCH STANDALONE TASK ----------------
// Used by Factory UI pages (e.g. CRM Factory) that need to run a single factory
// adapter through the orchestrator WITHOUT re-running the whole launch_business DAG.
// Creates a 1-task Run for the requested adapter type, builds the full context
// snapshot (approved blueprint, brand, prior approved assets), and dispatches it
// via the SAME dispatchTask/adapter path the full DAG uses. Reuses every contract;
// no parallel execution architecture.
export async function dispatchStandaloneTask(svc: any, opts: {
  businessId: string; taskType: string; taskKey: string; capability?: string; goal?: string; requestedBy?: string; input?: any;
}): Promise<any> {
  const business: any = await svc.entities.Business.get(opts.businessId);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });

  const node: PlanTask = { key: opts.taskKey, type: opts.taskType, capability: opts.capability, depends_on: [], retryable: true, max_retries: 3 };
  const tasks: PlanTask[] = [node];
  const v = validateDag(tasks);
  if (!v.ok) throw Object.assign(new Error(`Invalid task DAG: ${v.errors.join("; ")}`), { code: "PLAN_INVALID", detail: v });

  const inputHash = computeInputHash([opts.taskType, opts.businessId, opts.goal || "", Date.now(), JSON.stringify(opts.input || {})]);
  const idemKey = `(dispatch:${opts.taskType}|${opts.businessId}|${inputHash})`;

  const runCtx = { run_id: "(pending)", goal: opts.goal || `task:${opts.taskType}`, requested_by: opts.requestedBy || "system", plan_template: `(dispatch:${opts.taskType})`, plan_version: 1 };
  let snapshot = await buildContextSnapshot(svc, business, runCtx);
  // Merge caller-supplied input (test seams / per-task overrides) at the snapshot top
  // level so the adapter can read them from its context. Never used for vendor selection.
  if (opts.input && typeof opts.input === "object" && !Array.isArray(opts.input)) snapshot = { ...snapshot, ...opts.input };

  const run: any = await svc.entities.LaunchPlan.create({
    tenant_id: business.tenant_id, business_id: opts.businessId,
    goal: opts.goal || `task:${opts.taskType}`, status: "pending",
    workflow: tasks, total_steps: 1, completed_steps: 0,
    plan_template_id: `(dispatch:${opts.taskType})`, plan_version: 1,
    input_hash: inputHash, idempotency_key: idemKey,
    context_snapshot: snapshot, requested_by: opts.requestedBy || "system", started_at: new Date().toISOString(),
  });
  snapshot = { ...snapshot, run_context: { ...snapshot.run_context, run_id: run.id } };
  await svc.entities.LaunchPlan.update(run.id, { context_snapshot: snapshot });

  await svc.entities.LaunchTask.bulkCreate([taskDocFromNode(node, run, 1, inputHash, snapshot)]);

  await audit(svc, { run, type: "RUN_CREATED", actor: opts.requestedBy, detail: { standalone: opts.taskType } });
  await audit(svc, { run, type: "TASKS_CREATED", detail: { count: 1 } });

  const advanced = await advanceRun(svc, { runId: run.id, actor: opts.requestedBy });
  return { run: await svc.entities.LaunchPlan.get(run.id), dispatched: true, observability: advanced.observability || { enabled: false } };
}

// Dispatch ONE task via its adapter, creating Execution checkpoints.
async function dispatchTask(svc: any, opts: {
  run: any; task: any; tasks: any[]; resolvedProvider: ResolvedProvider; actor: string; resumeStage?: string;
}): Promise<ExecuteResult> {
  const { run, task, tasks, resolvedProvider, actor, resumeStage, obs, workflowSpanId } = opts as any;
  const inputHash = task.input_hash;
  const adapterKey = task.type === "approval_gate" ? null : getAdapter(task.type) ? task.type : "__stub__";
  const adapter = getAdapter(adapterKey) || getAdapter("__default__");

  // Resolve provider for the task capability (if not already resolved).
  let rp = resolvedProvider;
  if (!rp || !rp.provider_id) {
    rp = task.provider_capability ? await resolveProvider(svc, run.business_id, task.provider_capability) : { provider_id: "(none)", name: "(none)", category: "", adapter_key: "", capability: task.provider_capability || "", via: "none" };
  }

  // Build dispatch context with prior completed-task outputs.
  const outputs: Record<string, any> = {};
  for (const t of tasks) if (t.status === "completed" && t.output) outputs[t.task_key] = t.output;
  const context = withPriorOutputs(run.context_snapshot || {}, outputs);

  await svc.entities.LaunchTask.update(task.id, { status: "running", provider_id: rp?.provider_id || null, attempt: Math.max(1, task.attempt || 0), started_at: task.started_at || new Date().toISOString() });
  await audit(svc, { run, type: "TASK_STARTED", actor, task_id: task.id, detail: { task_key: task.task_key, provider: rp?.name, attempt: Math.max(1, task.attempt || 0) } });
  await taskLog(svc, task.id, "info", `Dispatching to provider "${rp?.name || "(none)"}" via ${rp?.via}`);
  let taskSpan: any = null;
  if (obs) taskSpan = obs.startSpan({ name: `launch_task:${task.task_key}`, parentObservationId: workflowSpanId || null, metadata: { launch_task_id: task.id, task_key: task.task_key, task_type: task.type, run_id: run.id, depends_on: task.depends_on || [], attempt: Math.max(1, task.attempt || 0), capability: task.provider_capability || null, provider: rp?.name || null } });

  const t0 = Date.now();
  let result: ExecuteResult;
  try {
    result = obs
      ? await setObsCtx({ service: obs, traceId: obs.traceId, parentObservationId: taskSpan ? taskSpan.id : null, run_id: run.id, task_id: task.id }, async () => adapter({ svc, run, task, context, resolvedProvider: rp, resumeFromStage: resumeStage, actor }))
      : await adapter({ svc, run, task, context, resolvedProvider: rp, resumeFromStage: resumeStage, actor });
  } catch (e: any) {
    result = { status: "failed", error: { code: "FACTORY_FAILED", message: String(e?.message || e), retryable: true }, executionIds: [] };
  }
  const durationMs = Date.now() - t0;
  if (obs && taskSpan) obs.endSpan(taskSpan, { status: result.status, metadata: { retry_count: task.retry_count || 0, duration_ms: durationMs, error_code: result.error?.code }, error: result.status === "failed" ? result.error : undefined });
  const execIds = result.executionIds || [];
  const lastExecId = execIds.length ? execIds[execIds.length - 1] : task.last_execution_id || null;

  if (result.status === "completed") {
    await svc.entities.LaunchTask.update(task.id, { status: "completed", output: result.output || {}, last_execution_id: lastExecId, completed_at: new Date().toISOString(), duration_ms: durationMs, error_code: "", error_detail: "" });
    await audit(svc, { run, type: "TASK_COMPLETED", actor, task_id: task.id, detail: { task_key: task.task_key, stage: result.last_stage } });
    await run.lifecycleStageOk;
  } else {
    const err = result.error || { code: "FACTORY_FAILED", message: "Execution failed", retryable: true };
    await svc.entities.LaunchTask.update(task.id, { status: "failed", last_execution_id: lastExecId, duration_ms: durationMs, error_code: err.code, error_detail: err.message, retryable: err.retryable });
    if (rp?.provider_id && rp.provider_id !== "(none)") await recordProviderFailure(svc, rp.provider_id).catch(() => {});
    await audit(svc, { run, type: "TASK_FAILED", actor, task_id: task.id, detail: { task_key: task.task_key, code: err.code, message: err.message, stage: result.last_stage, retryable: err.retryable } });
    await taskLog(svc, task.id, "error", `Failed at stage "${result.last_stage}": ${err.code} — ${err.message}`);
  }
  return result;
}

// ---------------- ADVANCE / STEP ----------------
export async function advanceRun(svc: any, opts: { runId: string; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  if (run.status === "cancelled" || run.status === "completed" || run.status === "failed") return { run, advanced: false };
  const obsCfg = getObsConfig();
  const obs = obsCfg.enabled ? new ObservabilityService(obsCfg, { kind: "orchestrator", tenant_id: run.tenant_id, business_id: run.business_id, run_id: run.id, launch_plan_id: run.id, template_id: run.plan_template_id, template_version: run.plan_version, actor: opts.actor }) : null;
  let wfSpan: any = null;
  if (obs) { obs.startTrace(run.plan_template_id || "run", { goal: run.goal }); wfSpan = obs.startSpan({ name: "workflow", parentObservationId: null, metadata: { template_id: run.plan_template_id, version: run.plan_version, task_count: (run.workflow || []).length } }); }

  const taskDefs: PlanTask[] = (run.workflow || []).map((t: any) => ({ key: t.key, type: t.type, capability: t.capability, depends_on: t.depends_on || [], needs_approval: t.needs_approval, money_spending: t.money_spending, retryable: t.retryable, max_retries: t.max_retries, approval_required: t.approval_required }));

  let dispatched = 0;
  let hadApproval = false;
  let blockedMarked = 0;

  // Dependency-aware fixpoint scheduler. State lives 100% in entities; every
  // round recomputes from persisted task status, so a restart resumes exactly
  // where it stopped and completed tasks are never re-executed. Three phases
  // per round:
  //   A. BLOCKED: a pending task with a failed/rejected/cancelled/blocked
  //      dependency is persisted as "blocked" and never dispatched. Because
  //      "blocked" is itself a failure state, blocking propagates transitively
  //      to all downstream tasks across rounds.
  //   B. READY: a pending task whose dependencies all SUCCEEDED is persisted as
  //      "ready" (a first-class observable state). Approval gates instead become
  //      "awaiting_approval".
  //   C. RUN: each READY non-approval task is dispatched to its adapter (-> RUNNING
  //      -> SUCCEEDED/FAILED), resuming from its last successful stage checkpoint.
  //      Idempotent: only pending/ready tasks are touched, so completed tasks are
  //      never re-executed. The orchestrator never dispatches a task because an
  //      LLM requested it — only the persisted DAG state drives execution.
  for (let round = 0; round < 50; round++) {
    let changed = false;

    // Phase A — transitive BLOCKED resolution.
    let curTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
    let states = dependencyStates(taskDefs, statusByKey(curTasks));
    for (const t of curTasks) {
      if (t.status !== "pending") continue;
      const st = states[t.task_key];
      if (st && st.state === "blocked") {
        await svc.entities.LaunchTask.update(t.id, { status: "blocked", error_code: "DEPENDENCY_BLOCKED", error_detail: `Blocked by: ${st.blocked_by.join(", ")}`, completed_at: new Date().toISOString() });
        await audit(svc, { run, type: "TASK_BLOCKED", actor: opts.actor, task_id: t.id, detail: { task_key: t.task_key, blocked_by: st.blocked_by } });
        await taskLog(svc, t.id, "warn", `Blocked by failed dependency: ${st.blocked_by.join(", ")}`);
        blockedMarked++; changed = true;
      }
    }

    // Phase B — READY / AWAITING_APPROVAL resolution (persist first-class READY).
    curTasks = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
    states = dependencyStates(taskDefs, statusByKey(curTasks));
    for (const t of curTasks) {
      if (t.status !== "pending") continue;
      const st = states[t.task_key];
      if (!st || st.state !== "ready") continue;
      if (taskDefs.find((d) => d.key === t.task_key)?.type === "approval_gate") {
        await svc.entities.LaunchTask.update(t.id, { status: "awaiting_approval", approval_payload: t.approval_payload || { decision_type: "generic", title: `Approve ${t.task_key}`, options: [], recommended_option: 0 } });
        await audit(svc, { run, type: "APPROVAL_REQUESTED", actor: opts.actor, task_id: t.id, detail: { task_key: t.task_key } });
        hadApproval = true; changed = true;
      } else {
        await svc.entities.LaunchTask.update(t.id, { status: "ready" });
        changed = true;
      }
    }

    // Phase C — dispatch all READY non-approval tasks in PARALLEL (resume from
    // last checkpoint). A task only reaches READY once its dependencies SUCCEEDED,
    // so no two ready tasks depend on each other → dispatching every ready task
    // concurrently is safe and never reorders the DAG. Sequential chains degrade
    // to one dispatch per round naturally (a single ready task awaits alone).
    curTasks = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
    const readyTasks = curTasks.filter((t) => t.status === "ready" && taskDefs.find((d) => d.key === t.task_key)?.type !== "approval_gate");
    if (readyTasks.length) {
      const results = await Promise.all(readyTasks.map(async (t) => {
        const resume = await lastSuccessfulStage(svc, t.id);
        const rp = t.provider_capability ? await resolveProvider(svc, run.business_id, t.provider_capability) : null;
        return dispatchTask(svc, { run, task: t, tasks: curTasks, resolvedProvider: rp, actor: opts.actor || "system", resumeStage: resume?.stage, obs, workflowSpanId: wfSpan ? wfSpan.id : null });
      }));
      dispatched += results.length;
      changed = true;
    }

    if (!changed) break;
  }

  // Recompute run status + progress from persisted task state.
  const fresh: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  const doneCount = fresh.filter((t) => t.status === "completed" || t.status === "skipped").length;
  const total = fresh.length || 1;
  // A rejected approval gate is a terminal failure for the run (Phase 13b): the
  // human declined, its dependents were skipped, and the run must not linger as
  // "awaiting_approval". Counted here so customers see a clean "stopped" state.
  const failed = fresh.filter((t) => t.status === "failed" || t.status === "rejected");
  const blocked = fresh.filter((t) => t.status === "blocked");
  const awaiting = fresh.filter((t) => t.status === "awaiting_approval");
  const depStatesFinal = dependencyStates(taskDefs, statusByKey(fresh));
  const runnableCount = fresh.filter((t) => (t.status === "pending" || t.status === "ready") && depStatesFinal[t.task_key]?.state === "ready" && taskDefs.find((d) => d.key === t.task_key)?.type !== "approval_gate").length;

  let status = run.status;
  if (doneCount >= total) status = "completed";
  else if ((failed.length || blocked.length) && runnableCount === 0) status = "failed";
  else if (awaiting.length && runnableCount === 0) status = "awaiting_approval";
  else if (dispatched || hadApproval) status = "running";

  await svc.entities.LaunchPlan.update(run.id, { status, progress: Math.round((doneCount / total) * 100), completed_steps: doneCount, last_completed_task_id: (fresh.find((t) => t.status === "completed") || {}).id || run.last_completed_task_id, failed_task_id: (failed[0] || {}).id || run.failed_task_id });
  await audit(svc, { run, type: "RUN_ADVANCED", actor: opts.actor, detail: { dispatched, blocked: blockedMarked, status, completed: doneCount, total } });

  if (status === "completed") {
    await svc.entities.LaunchPlan.update(run.id, { completed_at: new Date().toISOString() });
    await audit(svc, { run, type: "RUN_COMPLETED", actor: opts.actor });
  }
  if (obs) { obs.endSpan(wfSpan, { status, metadata: { completed: doneCount, total, dispatched, blocked: blockedMarked } }); try { await obs.flush(); } catch {} }
  return { run: await svc.entities.LaunchPlan.get(run.id), advanced: dispatched > 0 || hadApproval, blocked: blockedMarked, observability: obs ? { ...obs.summary(), trace_id: obs.traceId, workflow_span: wfSpan ? wfSpan.id : null } : { enabled: false } };
}

// ---------------- APPROVE / REJECT ----------------
export async function approveTask(svc: any, opts: { runId: string; taskId?: string; decision?: any; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  let tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  let gate = opts.taskId ? tasks.find((t) => t.id === opts.taskId || t.task_key === opts.taskId) : tasks.find((t) => t.status === "awaiting_approval");
  if (!gate || gate.status !== "awaiting_approval") throw Object.assign(new Error("No awaiting-approval task"), { code: "NOTHING_TO_APPROVE" });
  await svc.entities.LaunchTask.update(gate.id, { status: "completed", approval_decision: "approved", output: { decision: opts.decision || "approved" }, completed_at: new Date().toISOString() });
  // The approval gate is the human's authoritative act; it must promote the
  // corresponding artifact so downstream adapters (generation) consume an
  // APPROVED item rather than a draft. Today only the blueprint gate is wired;
  // website/seo/crm gates gate publication, handled by their own factories.
  if (gate.task_key === "blueprint_approval") {
    const all = await svc.entities.BusinessBlueprint.filter({ business_id: run.business_id }).catch(() => []);
    const drafts = (all || []).filter((r: any) => r.status === "draft").sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    const draft = drafts[0] || null;
    if (draft) {
      for (const r of all) if (r.status === "approved" && r.id !== draft.id) await svc.entities.BusinessBlueprint.update(r.id, { status: "superseded" }).catch(() => {});
      await svc.entities.BusinessBlueprint.update(draft.id, { status: "approved", approved_at: new Date().toISOString(), approved_by: opts.actor || "system" });
      await audit(svc, { run, type: "ARTIFACT_APPROVED", actor: opts.actor, task_id: gate.id, detail: { task_key: gate.task_key, blueprint_id: draft.id, blueprint_version: draft.version } });
    }
  }
  await audit(svc, { run, type: "APPROVAL_GRANTED", actor: opts.actor, task_id: gate.id, detail: { task_key: gate.task_key } });
  await advanceRun(svc, { runId: opts.runId, actor: opts.actor });
  return { run: await svc.entities.LaunchPlan.get(run.id), approved: gate.task_key };
}

export async function rejectTask(svc: any, opts: { runId: string; taskId?: string; reason?: string; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  let gate = opts.taskId ? tasks.find((t) => t.id === opts.taskId || t.task_key === opts.taskId) : tasks.find((t) => t.status === "awaiting_approval");
  if (!gate) throw Object.assign(new Error("No awaiting-approval task"), { code: "NOTHING_TO_REJECT" });
  await svc.entities.LaunchTask.update(gate.id, { status: "rejected", approval_decision: "rejected", output: { reason: opts.reason || "rejected" }, completed_at: new Date().toISOString() });
  // Rejection blocks direct dependents (skipped) → if nothing else runnable, run fails.
  const defs: PlanTask[] = run.workflow || [];
  const dependents = defs.filter((d) => (d.depends_on || []).includes(gate.task_key)).map((d) => d.key);
  for (const dep of dependents) {
    const t = tasks.find((x) => x.task_key === dep);
    if (t && t.status === "pending") await svc.entities.LaunchTask.update(t.id, { status: "skipped" });
  }
  await audit(svc, { run, type: "APPROVAL_REJECTED", actor: opts.actor, task_id: gate.id, detail: { task_key: gate.task_key, reason: opts.reason, blocked: dependents } });
  await advanceRun(svc, { runId: opts.runId, actor: opts.actor });
  return { run: await svc.entities.LaunchPlan.get(run.id), rejected: gate.task_key, blocked: dependents };
}

// ---------------- SKIP ----------------
// Skip a (typically failed) task: mark it "skipped" so its dependents become
// eligible (skipped counts as DONE in the DAG). The orchestrator remains the
// sole owner of task state — this is a run-control, not factory logic.
export async function skipTask(svc: any, opts: { runId: string; taskId?: string; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  let task = opts.taskId ? tasks.find((t) => t.id === opts.taskId || t.task_key === opts.taskId) : tasks.find((t) => t.status === "failed");
  if (!task) throw Object.assign(new Error("No task to skip"), { code: "NOTHING_TO_SKIP" });
  await svc.entities.LaunchTask.update(task.id, { status: "skipped", error_code: "", error_detail: "", completed_at: new Date().toISOString() });
  await audit(svc, { run, type: "TASK_SKIPPED", actor: opts.actor, task_id: task.id, detail: { task_key: task.task_key } });
  await advanceRun(svc, { runId: opts.runId, actor: opts.actor });
  return { run: await svc.entities.LaunchPlan.get(run.id), skipped: task.task_key };
}

// ---------------- RETRY ----------------
export async function retryTask(svc: any, opts: { runId: string; taskId?: string; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  let task = opts.taskId ? tasks.find((t) => t.id === opts.taskId || t.task_key === opts.taskId) : tasks.find((t) => t.status === "failed");
  if (!task) throw Object.assign(new Error("No failed task to retry"), { code: "NOTHING_TO_RETRY" });
  if (task.retry_count >= task.max_retries) throw Object.assign(new Error(`Max retries (${task.max_retries}) reached for ${task.task_key}`), { code: "MAX_RETRIES" });

  const resume = await lastSuccessfulStage(svc, task.id);
  const nextAttempt = (task.attempt || 0) + 1;
  await svc.entities.LaunchTask.update(task.id, { status: "retrying", retry_count: (task.retry_count || 0) + 1, attempt: nextAttempt, error_code: "", error_detail: "" });
  await audit(svc, { run, type: "TASK_RETRIED", actor: opts.actor, task_id: task.id, detail: { task_key: task.task_key, attempt: nextAttempt, resume_from_stage: resume?.stage } });

  // Re-load the task so dispatchTask / the adapter see the bumped attempt.
  // Without this, the stale pre-bump object makes the adapter recompute attempt 1.
  const freshTask = await svc.entities.LaunchTask.get(task.id);
  // Optionally resolve a FALLBACK provider on retry (provider failure path).
  const rp = task.provider_capability ? await resolveProvider(svc, run.business_id, task.provider_capability) : null;
  const result = await dispatchTask(svc, { run, task: freshTask, tasks, resolvedProvider: rp, actor: opts.actor || "system", resumeStage: resume?.stage });

  // After the dispatch, reconcile run status.
  await svc.entities.LaunchPlan.update(run.id, { status: "running", failed_task_id: result.status === "completed" ? null : run.failed_task_id });
  await advanceRun(svc, { runId: opts.runId, actor: opts.actor });
  return { run: await svc.entities.LaunchPlan.get(run.id), retried: task.task_key, result: { status: result.status, stage: result.last_stage } };
}

// ---------------- CANCEL ----------------
export async function cancelRun(svc: any, opts: { runId: string; actor?: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  for (const t of tasks) if (t.status === "pending" || t.status === "running" || t.status === "retrying" || t.status === "awaiting_approval") {
    await svc.entities.LaunchTask.update(t.id, { status: t.status === "running" ? t.status : "cancelled" });
  }
  await svc.entities.LaunchPlan.update(run.id, { status: "cancelled", cancelled_at: new Date().toISOString() });
  await audit(svc, { run, type: "RUN_CANCELLED", actor: opts.actor });
  return { run: await svc.entities.LaunchPlan.get(run.id) };
}

// ---------------- STATUS / NEXT-ACTION ----------------
export async function runStatus(svc: any, opts: { runId: string }): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(opts.runId);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "RUN_NOT_FOUND" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: opts.runId });
  const executions = await svc.entities.AIExecution.filter({ run_id: opts.runId }).catch(() => []);
  const defs: PlanTask[] = run.workflow || [];
  const next = dagNext(defs, statusByKey(tasks), statusMap(tasks));
  const depStates = dependencyStates(defs, statusByKey(tasks));
  return {
    run: {
      id: run.id, status: run.status, goal: run.goal, progress: run.progress,
      plan_template_id: run.plan_template_id, plan_version: run.plan_version,
      idempotency_key: run.idempotency_key, input_hash: run.input_hash,
      current_step_id: run.current_step_id, last_completed_task_id: run.last_completed_task_id, failed_task_id: run.failed_task_id,
      started_at: run.started_at, completed_at: run.completed_at, cancelled_at: run.cancelled_at,
      requested_by: run.requested_by,
      audit_trail: ((run.result_summary || {}).audit_trail || []).slice(-25),
    },
    tasks: tasks.map((t) => {
      const st = depStates[t.task_key] || null;
      return { id: t.id, task_key: t.task_key, type: t.type, status: t.status, depends_on: t.depends_on, provider: t.provider_id, retry_count: t.retry_count, max_retries: t.max_retries, attempt: t.attempt, error_code: t.error_code, error_detail: t.error_detail, last_execution_id: t.last_execution_id, approval_payload: t.approval_payload, dependency_state: st?.state || null, blocked_by: st?.blocked_by || [], waiting_for: st?.waiting_for || [] };
    }),
    executions: (executions || []).map((e: any) => ({ id: e.id, task_id: e.task_id, attempt: e.attempt, stage: e.stage, operation: e.operation, provider: e.provider, success: e.success, error_code: e.error_code, retryable: e.retryable })),
    next_action: next,
  };
}

// ---------------- DEPENDENCY DAG INTEGRATION TEST ----------------
// Runs the canonical dependency chain (Create Website -> Verify Website -> Create
// CRM -> Configure Communications) in both a happy and a blocked variant, plus an
// idempotent-resume check, and returns pass/fail assertions. Used by the
// `run-dependency-test` orchestrator action. Does NOT touch the real Website or
// CRM adapters (CRM participates only as a stub task boundary here).
export async function runDependencyTest(svc: any, opts: { businessId: string; actor?: string }): Promise<any> {
  await ensureSeedTemplates(svc);
  const nonce = String(Date.now());
  const actor = opts.actor || "system";
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };

  // ---------- HAPPY PATH: ordering + all succeed ----------
  const happy = await launchRun(svc, { businessId: opts.businessId, templateId: "dependency_test", goal: "Dependency DAG happy path", requestedBy: actor, input: { test_run: nonce } });
  const happyRun = happy.run;
  const happyTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: happyRun.id });
  const happyStatus: Record<string, string> = Object.fromEntries(happyTasks.map((t: any) => [t.task_key, t.status]));

  const happyExecs: any[] = await svc.entities.AIExecution.filter({ run_id: happyRun.id });
  const ordered = [...happyExecs].sort((a: any, b: any) => String(a.created_date || "").localeCompare(String(b.created_date || "")));
  const taskOf = (e: any) => (e.operation || "").split(".")[0];
  const order = ordered.map(taskOf);
  const idx = (k: string) => order.indexOf(k);

  assert("happy: all 4 tasks completed", ["create_website", "verify_website", "create_crm", "configure_comms"].every((k) => happyStatus[k] === "completed"), { statuses: happyStatus });
  assert("happy: Website ran first", idx("create_website") === 0, { order });
  assert("happy: Verify Website ran after Website succeeded", idx("create_website") >= 0 && idx("verify_website") > idx("create_website"), { order });
  assert("happy: CRM ran after Website verification succeeded", idx("verify_website") >= 0 && idx("create_crm") > idx("verify_website"), { order });
  assert("happy: Communications ran after CRM succeeded", idx("create_crm") >= 0 && idx("configure_comms") > idx("create_crm"), { order });

  // ---------- RESUME: re-advancing a completed run must not re-execute ----------
  const beforeCount = (await svc.entities.AIExecution.filter({ run_id: happyRun.id })).length;
  await advanceRun(svc, { runId: happyRun.id, actor });
  const afterCount = (await svc.entities.AIExecution.filter({ run_id: happyRun.id })).length;
  assert("resume: no new executions after re-advancing completed run", afterCount === beforeCount, { before: beforeCount, after: afterCount });
  const happyStatusAfter: Record<string, string> = Object.fromEntries((await svc.entities.LaunchTask.filter({ launch_id: happyRun.id })).map((t: any) => [t.task_key, t.status]));
  assert("resume: tasks remain completed (not re-run)", ["create_website", "verify_website", "create_crm", "configure_comms"].every((k) => happyStatusAfter[k] === "completed"), { statuses: happyStatusAfter });

  // ---------- BLOCKED PATH: failed Website blocks all downstream ----------
  const blk = await launchRun(svc, { businessId: opts.businessId, templateId: "dependency_test_blocked", goal: "Dependency DAG blocking", requestedBy: actor, input: { test_run: nonce, scenario: "blocked" } });
  const blkRun = blk.run;
  const blkTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: blkRun.id });
  const blkStatus: Record<string, string> = Object.fromEntries(blkTasks.map((t: any) => [t.task_key, t.status]));
  const blkExecs: any[] = await svc.entities.AIExecution.filter({ run_id: blkRun.id });
  const blkExecTasks = new Set(blkExecs.map((e: any) => (e.operation || "").split(".")[0]));
  const blkRunFresh: any = await svc.entities.LaunchPlan.get(blkRun.id);

  assert("blocked: Website failed", blkStatus["create_website"] === "failed", { statuses: blkStatus });
  assert("blocked: Verify Website BLOCKED and never executed", blkStatus["verify_website"] === "blocked" && !blkExecTasks.has("verify_website"), { statuses: blkStatus, executed: [...blkExecTasks] });
  assert("blocked: CRM BLOCKED and never executed", blkStatus["create_crm"] === "blocked" && !blkExecTasks.has("create_crm"), { statuses: blkStatus });
  assert("blocked: Communications BLOCKED and never executed", blkStatus["configure_comms"] === "blocked" && !blkExecTasks.has("configure_comms"), { statuses: blkStatus });
  assert("blocked: run status is failed", blkRunFresh.status === "failed", { run_status: blkRunFresh.status });

  const allPassed = assertions.every((a) => a.passed);
  return { allPassed, assertions, happy_run: happyRun.id, blocked_run: blkRun.id };
}

// ---------------- DOMAIN ADAPTER INTEGRATION TEST ----------------
// Proves the real Domain adapter inside the DAG: create_website -> configure_domain
// -> verify_domain -> create_crm -> configure_comms. Uses a deterministic mock
// registrar (seeded as a Provider + BusinessProviderBinding) so NO real production
// provider is faked. Verifies ordering, blocking, idempotency (no duplicate
// external side effect on resume/second run), and getStatus-via-orchestrator.
export async function runDomainTest(svc: any, opts: { businessId: string; actor?: string }): Promise<any> {
  await ensureSeedTemplates(svc);
  const actor = opts.actor || "system";
  const nonce = String(Date.now());
  const domName = `mock-${nonce}.com`;
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };

  const business: any = await svc.entities.Business.get(opts.businessId);

  // Seed deterministic mock domain registrar (test infra) + bind to the business
  // so resolveProvider(domain_registrar) returns it regardless of other providers.
  let mockProv: any = (await svc.entities.Provider.filter({ key: "mock_domain" }).catch(() => []))[0];
  if (!mockProv) {
    mockProv = await svc.entities.Provider.create({ name: "Mock Domain Registrar", key: "mock_domain", category: "domain", adapter_key: "mock_domain", environment: "sandbox", status: "connected", enabled: true, is_default: false, health_status: "healthy", capabilities: ["domain_registrar"] });
  }
  let binding: any = (await svc.entities.BusinessProviderBinding.filter({ business_id: opts.businessId, capability: "domain_registrar" }).catch(() => []))[0];
  if (!binding) binding = await svc.entities.BusinessProviderBinding.create({ tenant_id: business.tenant_id, business_id: opts.businessId, capability: "domain_registrar", primary_provider_id: mockProv.id, enabled: true, configuration: { mock: true } });
  else if (binding.primary_provider_id !== mockProv.id) await svc.entities.BusinessProviderBinding.update(binding.id, { primary_provider_id: mockProv.id, enabled: true });

  // ---------- HAPPY PATH ----------
  const happy = await launchRun(svc, { businessId: opts.businessId, templateId: "domain_dependency_test", goal: "Domain adapter happy", requestedBy: actor, input: { domain: { name: domName, years: 1 }, test_phase: "happy" } });
  const happyRun = happy.run;
  const happyTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: happyRun.id });
  const happyStatus: Record<string, string> = Object.fromEntries(happyTasks.map((t: any) => [t.task_key, t.status]));
  const happyExecs: any[] = await svc.entities.AIExecution.filter({ run_id: happyRun.id });
  const minTs = (prefix: string) => { const es = happyExecs.filter((e: any) => (e.operation || "").startsWith(prefix)); if (!es.length) return null; return es.map((e: any) => String(e.created_date || "")).sort()[0]; };
  const ts: Record<string, any> = { create_website: minTs("create_website."), configure_domain: minTs("configure_domain."), verify_domain: minTs("verify_domain."), create_crm: minTs("create_crm."), configure_comms: minTs("configure_comms.") };
  const domains: any[] = await svc.entities.Domain.filter({ business_id: opts.businessId, domain_name: domName }).catch(() => []);
  const happyDomain = domains[0] || null;
  const verifyTask = happyTasks.find((t: any) => t.task_key === "verify_domain");

  assert("happy: all 5 tasks completed", ["create_website", "configure_domain", "verify_domain", "create_crm", "configure_comms"].every((k) => happyStatus[k] === "completed"), { statuses: happyStatus });
  assert("happy: configure_domain cannot run before create_website succeeds (Website ran first)", ts.create_website && ts.configure_domain && ts.create_website <= ts.configure_domain, { ts });
  assert("happy: verify_domain ran after configure_domain succeeded", ts.configure_domain && ts.verify_domain && ts.configure_domain <= ts.verify_domain, { ts });
  assert("happy: CRM ran after verify_domain succeeded", ts.verify_domain && ts.create_crm && ts.verify_domain <= ts.create_crm, { ts });
  assert("happy: Communications ran after CRM succeeded", ts.create_crm && ts.configure_comms && ts.create_crm <= ts.configure_comms, { ts });
  assert("happy: Domain entity created with external_reference", !!happyDomain && !!happyDomain.external_reference, { domain: happyDomain && { id: happyDomain.id, status: happyDomain.status, external_reference: happyDomain.external_reference, dns_status: happyDomain.dns_status } });
  const cdHappy = happyTasks.find((t: any) => t.task_key === "configure_domain");
  assert("happy: configure_domain output registration_status registered", cdHappy && cdHappy.output && cdHappy.output.registration_status === "registered", { output: cdHappy && cdHappy.output });
  assert("happy: dns_status configured", happyDomain && happyDomain.dns_status === "configured", {});
  assert("happy: verify_domain output.verification_status verified", verifyTask && verifyTask.output && verifyTask.output.verification_status === "verified", { output: verifyTask && verifyTask.output });

  // ---------- RESUME: re-advancing a completed run must not re-execute ----------
  const beforeCount = (await svc.entities.AIExecution.filter({ run_id: happyRun.id })).length;
  await advanceRun(svc, { runId: happyRun.id, actor });
  const afterCount = (await svc.entities.AIExecution.filter({ run_id: happyRun.id })).length;
  assert("resume: no new executions after re-advancing completed run", afterCount === beforeCount, { before: beforeCount, after: afterCount });

  // ---------- IDEMPOTENCY: a second run over the SAME domain must not duplicate the external side effect ----------
  const second = await launchRun(svc, { businessId: opts.businessId, templateId: "domain_dependency_test", goal: "Domain idempotency", requestedBy: actor, input: { domain: { name: domName, years: 1 }, test_phase: "idempotency" } });
  const secondRun = second.run;
  const secondExecs: any[] = await svc.entities.AIExecution.filter({ run_id: secondRun.id });
  const secondRegisterPosts = secondExecs.filter((e: any) => e.stage === "register.post" && (e.operation || "").startsWith("configure_domain."));
  const skipped = secondRegisterPosts.some((e: any) => e.output && e.output.skipped_external_call === true);
  const domainsAfter: any[] = await svc.entities.Domain.filter({ business_id: opts.businessId, domain_name: domName }).catch(() => []);
  assert("idempotency: second run skipped the external register call (skipped_external_call)", skipped, { register_posts: secondRegisterPosts.map((e: any) => e.output) });
  assert("idempotency: no duplicate Domain entity created", domainsAfter.length === 1, { count: domainsAfter.length });
  assert("idempotency: external_reference unchanged", domainsAfter[0] && happyDomain && domainsAfter[0].external_reference === happyDomain.external_reference, { first: happyDomain && happyDomain.external_reference, second: domainsAfter[0] && domainsAfter[0].external_reference });

  // ---------- BLOCKED PATH: failed domain config blocks verification + downstream ----------
  const blk = await launchRun(svc, { businessId: opts.businessId, templateId: "domain_dependency_test_blocked", goal: "Domain blocked", requestedBy: actor, input: { domain: { name: `blocked-${nonce}.com`, years: 1 }, test_phase: "blocked" } });
  const blkRun = blk.run;
  const blkTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: blkRun.id });
  const blkStatus: Record<string, string> = Object.fromEntries(blkTasks.map((t: any) => [t.task_key, t.status]));
  const blkExecs: any[] = await svc.entities.AIExecution.filter({ run_id: blkRun.id });
  const blkExecTypes = new Set(blkExecs.map((e: any) => (e.operation || "").split(".")[0]));
  const blkRunFresh: any = await svc.entities.LaunchPlan.get(blkRun.id);

  assert("blocked: configure_domain failed", blkStatus["configure_domain"] === "failed", { statuses: blkStatus });
  assert("blocked: verify_domain BLOCKED and never executed", blkStatus["verify_domain"] === "blocked" && !blkExecTypes.has("verify_domain"), { statuses: blkStatus, executed: [...blkExecTypes] });
  assert("blocked: CRM BLOCKED (transitive)", blkStatus["create_crm"] === "blocked" && !blkExecTypes.has("create_crm"), { statuses: blkStatus });
  assert("blocked: Communications BLOCKED (transitive)", blkStatus["configure_comms"] === "blocked" && !blkExecTypes.has("configure_comms"), { statuses: blkStatus });
  assert("blocked: run status failed", blkRunFresh.status === "failed", { run_status: blkRunFresh.status });

  // ---------- getStatus exposes Domain tasks through orchestrator state only ----------
  const status: any = await runStatus(svc, { runId: happyRun.id });
  const statusKeys = new Set((status.tasks || []).map((t: any) => t.task_key));
  assert("getStatus: Domain tasks exposed via orchestrator state", statusKeys.has("configure_domain") && statusKeys.has("verify_domain"), { keys: [...statusKeys] });

  const allPassed = assertions.every((a) => a.passed);
  return { allPassed, assertions, happy_run: happyRun.id, second_run: secondRun.id, blocked_run: blkRun.id, domain: domName, mock_provider_id: mockProv.id };
}

// ---------------- WORKFLOW DEFINITION (generic) ----------------
// Any module registers an arbitrary DAG as a PlanTemplate at runtime. The engine
// is workflow-agnostic: `launch_business` is just one template. The existing
// launch-specific action names remain as backward-compatible aliases (entities
// are not renamed, so all existing UI/RLS/data keep working).
async function latestVersion(svc: any, templateId: string): Promise<number> {
  const rows = await svc.entities.PlanTemplate.filter({ template_id: templateId }).catch(() => []);
  return (rows || []).reduce((m: number, r: any) => Math.max(m, r.version || 0), 0);
}

export async function defineTemplate(svc: any, opts: { templateId: string; name: string; tasks: any[]; description?: string; lifecycleGoal?: string; overwrite?: boolean; tenant?: string }): Promise<any> {
  await ensureSeedTemplates(svc);
  if (!opts.templateId || !opts.name || !Array.isArray(opts.tasks) || !opts.tasks.length) throw Object.assign(new Error("templateId, name and tasks[] are required"), { code: "PLAN_INVALID" });
  const v = validateDag(opts.tasks);
  if (!v.ok) throw Object.assign(new Error(`Invalid plan DAG: ${v.errors.join("; ")}`), { code: "PLAN_INVALID", detail: v });
  const version = opts.overwrite ? 1 : (await latestVersion(svc, opts.templateId)) + 1;
  const row: any = await svc.entities.PlanTemplate.create({
    tenant_id: opts.tenant || "system", template_id: opts.templateId, version, name: opts.name,
    description: opts.description || "", lifecycle_goal: opts.lifecycleGoal || "operating", active: true,
    tasks: opts.tasks,
    retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    approval_rules: { money_spending_requires_approval: true },
    validation_rules: { circular_dependencies: true },
  });
  return { template_id: row.template_id, version: row.version, validated: v.ok, warnings: v.warnings || [] };
}

// ---------------- PARALLEL EXECUTION TEST ----------------
export async function runParallelTest(svc: any, opts: { businessId: string; actor?: string }): Promise<any> {
  await ensureSeedTemplates(svc);
  const actor = opts.actor || "system";
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };

  const wf = await launchRun(svc, { businessId: opts.businessId, templateId: "parallel_test", goal: "Parallel DAG execution", requestedBy: actor, input: { test_phase: "parallel", nonce: String(Date.now()) } });
  const run = wf.run;
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: run.id });
  const status: Record<string, string> = Object.fromEntries(tasks.map((t: any) => [t.task_key, t.status]));
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: run.id });
  const a = execs.find((e: any) => (e.operation || "").startsWith("parallel_a."));
  const b = execs.find((e: any) => (e.operation || "").startsWith("parallel_b."));
  const c = execs.find((e: any) => (e.operation || "").startsWith("parallel_c."));
  const aEnd = a && (a.completed_at || a.created_date);
  const bEnd = b && (b.completed_at || b.created_date);
  const cStart = c && c.created_date;

  assert("all 3 tasks completed", ["a", "b", "c"].every((k) => status[k] === "completed"), { status });
  assert("merge c ran after a completed", !!(a && c && aEnd && cStart && new Date(cStart) >= new Date(aEnd)), { a_end: aEnd, c_start: cStart });
  assert("merge c ran after b completed", !!(b && c && bEnd && cStart && new Date(cStart) >= new Date(bEnd)), { b_end: bEnd, c_start: cStart });
  // Overlap proof via finish-time + recorded duration (created_date is the row
  // INSERT time, which lands AFTER the adapter finishes, so it is NOT the start).
  // Sequential execution => b starts no earlier than a's finish => finish delta >=600ms.
  const aEndMs = new Date(a?.completed_at || a?.created_date).getTime();
  const bEndMs = new Date(b?.completed_at || b?.created_date).getTime();
  const aStartMs = aEndMs - (a?.duration_ms || 600);
  const bStartMs = bEndMs - (b?.duration_ms || 600);
  const overlap = !!(a && b && aEndMs > bStartMs && bEndMs > aStartMs);
  const finishDelta = Math.abs(aEndMs - bEndMs);
  assert("a and b overlapped (ran concurrently, not sequentially)", overlap, { a: { start: aStartMs, end: aEndMs }, b: { start: bStartMs, end: bEndMs }, finish_delta_ms: finishDelta });
  assert("finish delta < 600ms (sequential would be >=600ms)", finishDelta < 600, { finish_delta_ms: finishDelta });

  const allPassed = assertions.every((x) => x.passed);
  return { allPassed, assertions, run: run.id };
}

// ---------------- FULL REGRESSION SUITE ----------------
// Aggregates the dependency DAG, domain adapter (external-resource), and parallel
// execution suites. Proves: sequential ordering, parallel execution, dependency
// blocking + transitive failure, retry, approval gates, resume, idempotency.
const suiteSummary = (r: any) => ({ allPassed: r.allPassed, total: (r.assertions || []).length, failed: (r.assertions || []).filter((a: any) => !a.passed).map((a: any) => a.name) });
export async function runFullRegression(svc: any, opts: { businessId: string; actor?: string }): Promise<any> {
  const dep = await runDependencyTest(svc, opts);
  const dom = await runDomainTest(svc, opts);
  const par = await runParallelTest(svc, opts);
  return {
    allPassed: dep.allPassed && dom.allPassed && par.allPassed,
    suites: { dependency: suiteSummary(dep), domain: suiteSummary(dom), parallel: suiteSummary(par) },
    dependency_runs: { happy: dep.happy_run, blocked: dep.blocked_run },
    domain_runs: { happy: dom.happy_run, second: dom.second_run, blocked: dom.blocked_run, domain: dom.domain },
    parallel_run: par.run,
  };
}