// Factory adapter registry + the dispatch contract.
// Factories are registered by task `type`. The orchestrator calls
//   adapt.execute({ svc, task, context, resume_from_stage })
// and the factory returns a structured result:
//   { status: 'completed'|'failed', output, error?: {code, message, retryable}, last_stage }
// Factories receive the immutable context snapshot; they NEVER select a vendor
// (the orchestrator already resolved the provider and may pass it in for provenance).
//
// For the foundation phase only a STUB adapter is registered, so the substrate
// can be proven independently before any real factory is integrated. The stub
// records per-stage checkpoint Executions and supports forced stage failure +
// resume-from-checkpoint — exactly the contract real factories will implement.

export interface ExecuteInput {
  svc: any;
  run: any;
  task: any;
  context: any;
  resolvedProvider: any;
  resumeFromStage?: string;
  actor?: string;
}

export interface ExecuteResult {
  status: "completed" | "failed";
  output?: any;
  error?: { code: string; message: string; retryable: boolean };
  last_stage?: string;
  executionIds?: string[];
}

export type Adapter = (input: ExecuteInput) => Promise<ExecuteResult>;

const REGISTRY: Record<string, Adapter> = {};

export function registerAdapter(type: string, fn: Adapter): void {
  REGISTRY[type] = fn;
}

export function getAdapter(type: string): Adapter | undefined {
  return REGISTRY[type];
}

// Per-factory stage definitions (orchestrator-visible checkpoints).
const STAGES_BY_TYPE: Record<string, string[]> = {
  generate_website: ["architecture", "sitemap", "pages", "components", "media", "validation"],
  generate_seo: ["keywords", "clusters", "page_seo", "schema", "internal_links", "validation"],
  generate_crm: ["business_analysis", "crm_blueprint", "pipeline", "lead_scoring", "automations", "tasks", "email_templates", "validation"],
  generate_blueprint: ["generate", "validate"],
  activate_marketing: ["strategy", "campaign_plan", "channel_activation", "monitoring"],
  configure_domain: ["register", "dns"],
  default: ["execute"],
};

function stagesFor(type: string): string[] {
  return STAGES_BY_TYPE[type] || STAGES_BY_TYPE.default;
}

// Helper: list successful stage Executions already recorded for a task.
async function completedStages(svc: any, taskId: string): Promise<string[]> {
  const rows = await svc.entities.AIExecution.filter({ task_id: taskId, success: true }).catch(() => []);
  return (rows || []).map((r: any) => r.stage).filter(Boolean);
}

// Helper: create a stage checkpoint Execution row.
async function checkpoint(svc: any, opts: {
  run: any; task: any; attempt: number; stage: string; operation: string;
  resolvedProvider: any; inputHash: string; outputHash: string;
  success: boolean; errorCode?: string; errorMessage?: string; retryable?: boolean;
  durationMs: number; actor?: string;
}): Promise<string> {
  const row = await svc.entities.AIExecution.create({
    tenant_id: opts.run.tenant_id,
    business_id: opts.run.business_id,
    module_id: "orchestrator",
    capability: opts.task.provider_capability || "ai_generation",
    stage: opts.stage,
    prompt_id: `orchestrator.${opts.task.type}`,
    prompt_version: 1,
    run_id: opts.run.id,
    task_id: opts.task.id,
    attempt: opts.attempt,
    operation: opts.operation,
    provider: opts.resolvedProvider?.name || "(stub)",
    provider_capability: opts.task.provider_capability || null,
    model: opts.resolvedProvider?.adapter_key || "(stub)",
    input_hash: opts.inputHash,
    input_snapshot: { task_key: opts.task.task_key, stage: opts.stage },
    output_hash: opts.outputHash,
    success: opts.success,
    failure_reason: opts.errorMessage || "",
    error_code: opts.errorCode || "",
    retryable: !!opts.retryable,
    duration_ms: opts.durationMs,
    completed_at: opts.success ? new Date().toISOString() : null,
    actor: opts.actor || "system",
  });
  return row?.id || null;
}

export function registerStubAdapter(): void {
  registerAdapter("__stub__", async (input) => {
    const { svc, run, task, context, resolvedProvider, resumeFromStage, actor } = input;
    const stages = stagesFor(task.type);
    const inputHash = task.input_hash;
    const attempt = task.attempt || 1;
    const forcedFailStage = context?.__sim?.force_fail_stage || task.input_context?.__sim?.force_fail_stage;
    const resumeStage = resumeFromStage ? stages.indexOf(resumeFromStage) : -1;
    const startedAt = Date.now();

    // Skip stages already completed (resume-from-checkpoint). We rely on the
    // persisted successful stage Executions for this task — not in-memory state —
    // so resume is correct across process restarts.
    const doneStages = await completedStages(svc, task.id);
    let startIdx = 0;
    if (doneStages.length) {
      const lastDoneIdx = Math.max(...doneStages.map((s) => stages.indexOf(s)).filter((i) => i >= 0));
      if (lastDoneIdx >= 0) startIdx = lastDoneIdx + 1;
    }

    const execIds: string[] = [];
    const output: any = { stages_completed: [...doneStages], artifacts: {} };

    for (let i = startIdx; i < stages.length; i++) {
      const stage = stages[i];
      // Deterministic synthetic output per stage.
      const stageOutput = { stage, task_key: task.task_key, business_id: run.business_id, simulated: true };
      const outHash = JSON.stringify(stageOutput).length.toString(16);
      const forcedFail = forcedFailStage === stage && !doneStages.includes(stage) && attempt === 1;
      const dur = 50 + Math.floor(Math.random() * 100);

      if (forcedFail) {
        const id = await checkpoint(svc, { run, task, attempt, stage, operation: `${task.type}.${stage}`, resolvedProvider, inputHash, outputHash: outHash, success: false, errorCode: "PROVIDER_TIMEOUT", errorMessage: `Stub forced failure at stage "${stage}"`, retryable: true, durationMs: dur, actor });
        execIds.push(id);
        return { status: "failed", output, error: { code: "PROVIDER_TIMEOUT", message: `Stub failed at stage "${stage}"`, retryable: true }, last_stage: stage, executionIds: execIds };
      }
      const id = await checkpoint(svc, { run, task, attempt, stage, operation: `${task.type}.${stage}`, resolvedProvider, inputHash, outputHash: outHash, success: true, durationMs: dur, actor });
      execIds.push(id);
      output.stages_completed.push(stage);
      output.artifacts[stage] = stageOutput;
    }

    return { status: "completed", output, last_stage: stages[stages.length - 1], executionIds: execIds };
  });
}

// Real factory adapters (Phase 2 of the Orchestrator Integration Cutover).
// Each real adapter retires the __stub__ for its task type. Types without a real
// adapter yet still fall through to __stub__ (to be retired in subsequent slices).
import { createBlueprintAdapter } from "./adapters/blueprint.ts";
import { createWebsiteAdapter } from "./adapters/website.ts";
import { createSeoAdapter } from "./adapters/seo.ts";
import { createCrmAdapter } from "./adapters/crm.ts";
import { createDomainAdapter } from "./adapters/domain.ts";
import { createAgentAdapter } from "./adapters/agent.ts";
import { createAgentTeamAdapter } from "./adapters/agent_team.ts";

export function registerRealAdapters(): void {
  registerAdapter("generate_blueprint", createBlueprintAdapter());
  registerAdapter("generate_website", createWebsiteAdapter());
  registerAdapter("generate_seo", createSeoAdapter());
  registerAdapter("generate_crm", createCrmAdapter());
  // Real Domain factory adapter (Step 4). configure_domain + verify_domain share
  // one adapter that branches on task.type; both resolve the registrar through the
  // provider registry (no hard-coded vendor).
  registerAdapter("configure_domain", createDomainAdapter());
  registerAdapter("verify_domain", createDomainAdapter());
  // Agent Runtime adapter (Phase 13). The engine dispatches this like any factory
  // task; the adapter delegates to executeAgent, which reuses the Provider Runtime
  // + the existing capability registry. The Agent Runtime is NOT an orchestrator.
  registerAdapter("run_agent", createAgentAdapter());
  // Agent Team Runtime adapter (Phase 13C). A team is a controlled execution group
  // of agents run INSIDE a single LaunchTask of type `run_agent_team`. The engine
  // dispatches it like any factory task; the adapter runs the team's internal agent
  // graph reusing executeAgent per agent. It is NOT a second workflow engine.
  registerAdapter("run_agent_team", createAgentTeamAdapter());
}
registerRealAdapters();

// Convenience: register a default fallback that simply succeeds with one stage.
export function registerDefaultAdapter(): void {
  registerAdapter("__default__", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    const out = { task_key: task.task_key, business_id: run.business_id, default: true };
    const id = await checkpoint(svc, { run, task, attempt, stage: "execute", operation: `${task.type}.execute`, resolvedProvider, inputHash: task.input_hash, outputHash: JSON.stringify(out).length.toString(16), success: true, durationMs: 30, actor });
    return { status: "completed", output: out, last_stage: "execute", executionIds: [id] };
  });
}

// Test-seam adapters for the dependency-DAG integration test. Not used by any
// production launch flow. `fail_website` deterministically fails at its single
// stage so the scheduler's BLOCKED propagation can be exercised WITHOUT touching
// the real Website adapter (which must keep working unchanged).
export function registerTestAdapters(): void {
  registerAdapter("fail_website", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    const id = await checkpoint(svc, {
      run, task, attempt, stage: "execute", operation: "fail_website.execute",
      resolvedProvider, inputHash: task.input_hash, outputHash: "0",
      success: false, errorCode: "FACTORY_FAILED", errorMessage: "Test-seam forced website failure",
      retryable: true, durationMs: 10, actor,
    });
    return { status: "failed", error: { code: "FACTORY_FAILED", message: "Test-seam forced website failure", retryable: true }, last_stage: "execute", executionIds: [id] };
  });

  // Test seam for the Domain-adapter blocked-path test: deterministically fails the
  // configure_domain task so downstream tasks (verify_domain, CRM, comms) become
  // BLOCKED. Does not touch the real Domain adapter.
  registerAdapter("fail_configure_domain", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    const id = await checkpoint(svc, {
      run, task, attempt, stage: "register.post", operation: "fail_configure_domain.register.post",
      resolvedProvider, inputHash: task.input_hash, outputHash: "0",
      success: false, errorCode: "FACTORY_FAILED", errorMessage: "Test-seam forced domain configuration failure",
      retryable: true, durationMs: 10, actor,
    });
    return { status: "failed", error: { code: "FACTORY_FAILED", message: "Test-seam forced domain configuration failure", retryable: true }, last_stage: "register.post", executionIds: [id] };
  });

  // Parallel-execution test seams: a & b each block ~600ms so overlap is
  // measurable; c (merge) completes instantly. Lets runParallelTest prove the
  // scheduler dispatches independent ready tasks concurrently.
  registerAdapter("parallel_a", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    await new Promise((r) => setTimeout(r, 600));
    const id = await checkpoint(svc, { run, task, attempt, stage: "execute", operation: "parallel_a.execute", resolvedProvider, inputHash: task.input_hash, outputHash: "a", success: true, durationMs: 600, actor });
    return { status: "completed", output: { branch: "a" }, last_stage: "execute", executionIds: [id] };
  });
  registerAdapter("parallel_b", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    await new Promise((r) => setTimeout(r, 600));
    const id = await checkpoint(svc, { run, task, attempt, stage: "execute", operation: "parallel_b.execute", resolvedProvider, inputHash: task.input_hash, outputHash: "b", success: true, durationMs: 600, actor });
    return { status: "completed", output: { branch: "b" }, last_stage: "execute", executionIds: [id] };
  });
  registerAdapter("parallel_c", async (input) => {
    const { svc, run, task, resolvedProvider, actor } = input;
    const attempt = (task.attempt || 0) + 1;
    const id = await checkpoint(svc, { run, task, attempt, stage: "execute", operation: "parallel_c.execute", resolvedProvider, inputHash: task.input_hash, outputHash: "c", success: true, durationMs: 5, actor });
    return { status: "completed", output: { branch: "c" }, last_stage: "execute", executionIds: [id] };
  });
}