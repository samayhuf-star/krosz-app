import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  const res = await base44.functions.invoke("applicationCaseApi", payload);
  return res?.data ?? res;
}

// Phase 32 — Operations Queue work-management API. All ops-task mutations are
// admin-gated server-side and audited. The frontend never mutates case state.
export const opsTaskList = (filters = {}, sort = "-created_at", limit = 50, offset = 0) => invoke({ action: "ops-task-list", filters, sort, limit, offset });
export const opsTaskDashboard = () => invoke({ action: "ops-task-dashboard" });
export const opsTaskDetail = (id) => invoke({ action: "ops-task-detail", id });
export const opsTaskClaim = (id) => invoke({ action: "ops-task-claim", id });
export const opsTaskAssign = (p = {}) => invoke({ action: "ops-task-assign", ...p });
export const opsTaskRelease = (id) => invoke({ action: "ops-task-release", id });
export const opsTaskTransition = (p = {}) => invoke({ action: "ops-task-transition", ...p });
export const opsTaskPriority = (p = {}) => invoke({ action: "ops-task-priority", ...p });
export const opsTaskAction = (p = {}) => invoke({ action: "ops-task-action", ...p });
export const opsTaskBulk = (p = {}) => invoke({ action: "ops-task-bulk", ...p });
export const opsExceptionCreate = (p = {}) => invoke({ action: "ops-exception-create", ...p });
export const opsExceptionResolve = (p = {}) => invoke({ action: "ops-exception-resolve", ...p });
export const opsTaskExport = (filters = {}, format = "csv") => invoke({ action: "ops-task-export", filters, format });
export const opsTaskNoteCreate = (p = {}) => invoke({ action: "ops-task-note-create", ...p });
export const opsTaskBackfill = (limit) => invoke({ action: "ops-task-backfill", limit });
export const opsTaskMeta = () => invoke({ action: "ops-task-meta" });