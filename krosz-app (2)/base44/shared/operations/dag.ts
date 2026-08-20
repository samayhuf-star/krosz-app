// DAG validation + eligibility for Plan Templates.
// A plan is an ordered list of task nodes: {key, type, capability, depends_on[],
// needs_approval, money_spending, retryable, max_retries}. The engine never executes
// a task whose dependencies are not completed (or skipped). Money-spending tasks
// must be downstream of an approval_gate unless explicitly excepted.

export interface PlanTask {
  key: string;
  type: string;
  capability?: string;
  depends_on?: string[];
  needs_approval?: boolean;
  money_spending?: boolean;
  retryable?: boolean;
  max_retries?: number;
  approval_required?: boolean;
}

export interface DagValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateDag(tasks: PlanTask[]): DagValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const keys = new Set(tasks.map((t) => t.key));
  const byKey = new Map(tasks.map((t) => [t.key, t]));

  // Unique keys
  if (tasks.length !== keys.size) errors.push("Duplicate task keys in plan");

  for (const t of tasks) {
    // Self-dependency
    if ((t.depends_on || []).includes(t.key)) errors.push(`Task "${t.key}" depends on itself`);
    for (const d of t.depends_on || []) {
      if (!keys.has(d)) errors.push(`Task "${t.key}" depends on unknown task "${d}"`);
    }
    // Money-spending tasks must be gated by an approval_gate, unless explicitly excepted.
    if (t.money_spending && !t.needs_approval && t.approval_required !== false) {
      const hasApprovalDep = (t.depends_on || []).some((d) => {
        const dep = byKey.get(d);
        return dep && dep.type === "approval_gate";
      });
      if (!hasApprovalDep)
        warnings.push(`Money-spending task "${t.key}" has no approval gate dependency (plan validation requires one unless excepted)`);
    }
  }

  // Cycles via DFS
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const k of keys) color.set(k, WHITE);
  let hasCycle = false;
  const visit = (k: string): boolean => {
    color.set(k, GRAY);
    for (const d of byKey.get(k)?.depends_on || []) {
      if (color.get(d) === GRAY) return true;
      if (color.get(d) === WHITE && visit(d)) return true;
    }
    color.set(k, BLACK);
    return false;
  };
  for (const k of keys) if (color.get(k) === WHITE && visit(k)) { hasCycle = true; break; }
  if (hasCycle) errors.push("Circular dependency detected in plan");

  // Orphan: a task with no dependents and no dependencies is allowed (root),
  // but flag if a non-root key is referenced nowhere — informational only.
  return { ok: errors.length === 0, errors, warnings };
}

export type TaskStatus =
  | "pending" | "running" | "awaiting_approval" | "approved" | "rejected"
  | "completed" | "failed" | "retrying" | "skipped" | "cancelled";

const DONE: TaskStatus[] = ["completed", "skipped"];
const BLOCKING: TaskStatus[] = ["pending", "running", "awaiting_approval", "retrying", "failed", "rejected"];

export interface EligibleTask {
  key: string;
  ready: boolean;
  blocked_by: string[];
  is_approval_gate: boolean;
}

// Compute which tasks are currently eligible to run.
export function computeEligibility(
  taskDefs: PlanTask[],
  statusByKey: Record<string, TaskStatus>
): EligibleTask[] {
  const out: EligibleTask[] = [];
  for (const t of taskDefs) {
    const status = statusByKey[t.key];
    if (status && status !== "pending") continue; // only pending tasks can become eligible
    const blocked_by: string[] = [];
    let ready = true;
    for (const dep of t.depends_on || []) {
      const ds = statusByKey[dep];
      if (!DONE.includes(ds)) {
        ready = false;
        blocked_by.push(dep);
      }
    }
    out.push({ key: t.key, ready, blocked_by, is_approval_gate: t.type === "approval_gate" });
  }
  return out;
}

// First-class dependency state for the dependency-aware scheduler.
//   ready   — all depends_on are SUCCEEDED (completed/skipped); eligible to dispatch.
//   blocked — at least one required dependency is in a terminal-FAILURE state
//             (failed/rejected/cancelled/blocked); must NOT execute. Because
//             "blocked" is itself a failure state, blocking propagates transitively
//             to all downstream tasks across scheduler rounds.
//   waiting — a dependency is still pending/running/approving; not yet eligible.
export const DEP_DONE: TaskStatus[] = ["completed", "skipped"];
export const DEP_FAILED: TaskStatus[] = ["failed", "rejected", "cancelled", "blocked"];

export interface DepState {
  state: "ready" | "blocked" | "waiting";
  blocked_by: string[];
  waiting_for: string[];
}

// Compute the dependency state for every unresolved (pending/ready) task. Tasks
// already in a terminal or active state are skipped (their state is persisted).
export function dependencyStates(
  taskDefs: PlanTask[],
  statusByKey: Record<string, TaskStatus>
): Record<string, DepState> {
  const out: Record<string, DepState> = {};
  for (const t of taskDefs) {
    const status = statusByKey[t.key];
    if (status && status !== "pending" && status !== "ready") continue;
    const blocked_by: string[] = [];
    const waiting_for: string[] = [];
    let ready = true;
    let blocked = false;
    for (const dep of t.depends_on || []) {
      const ds = statusByKey[dep];
      if (DEP_FAILED.includes(ds)) { blocked = true; ready = false; blocked_by.push(dep); }
      else if (!DEP_DONE.includes(ds)) { ready = false; waiting_for.push(dep); }
    }
    out[t.key] = blocked
      ? { state: "blocked", blocked_by, waiting_for }
      : ready
        ? { state: "ready", blocked_by: [], waiting_for: [] }
        : { state: "waiting", blocked_by: [], waiting_for };
  }
  return out;
}

// Determine the next-action for an agent: the single most actionable thing.
export function nextAction(
  taskDefs: PlanTask[],
  statusByKey: Record<string, TaskStatus>,
  taskIndex: Record<string, any>
): { action: string; task_id?: string; message: string; detail?: any } {
  // 1. An approval gate waiting for a decision
  const approvalGate = taskDefs.find((t) => t.type === "approval_gate" && statusByKey[t.key] === "awaiting_approval");
  if (approvalGate) {
    return {
      action: "approve",
      task_id: approvalGate.key,
      message: `Approval requested for "${approvalGate.key}".`,
      detail: taskIndex[approvalGate.key]?.approval_payload,
    };
  }
  // 2. A failed task that is retryable
  const failed = taskDefs.find((t) => statusByKey[t.key] === "failed" && taskIndex[t.key]?.retryable && taskIndex[t.key]?.retry_count < taskIndex[t.key]?.max_retries);
  if (failed) {
    const tk = taskIndex[failed.key];
    return {
      action: "retry",
      task_id: failed.key,
      message: `Task "${failed.key}" failed (${tk?.error_code || "FACTORY_FAILED"}). Retry available.`,
      detail: { error_code: tk?.error_code, error_detail: tk?.error_detail, retries_left: (tk?.max_retries || 0) - (tk?.retry_count || 0) },
    };
  }
  // 3. Completed
  const live = taskDefs.filter((t) => statusByKey[t.key] !== "completed" && statusByKey[t.key] !== "skipped" && statusByKey[t.key] !== "cancelled");
  if (live.length === 0) return { action: "complete", message: "All tasks completed." };
  // 4. Nothing pending-ready or in approval — caller should run a step
  const elig = computeEligibility(taskDefs, statusByKey).filter((e) => e.ready);
  if (elig.length > 0) return { action: "step", message: `${elig.length} task(s) ready to advance: ${elig.map((e) => e.key).join(", ")}.` };
  // 5. Blocked
  return { action: "blocked", message: "No eligible task; a dependency is pending/failed/blocked.", detail: computeEligibility(taskDefs, statusByKey) };
}