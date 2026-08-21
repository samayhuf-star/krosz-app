// Idempotency: deterministic hashing of launch inputs + run-key de-duplication.
// launch_business|<business_id>|<input_hash> is the idempotency key; duplicate
// launches return the same Run instead of creating a second one.

export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Stable JSON stringify: object keys sorted ascending; arrays ordered.
export function stable(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stable).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(obj[k])).join(",") + "}";
}

export function computeInputHash(parts: any[]): string {
  return djb2(parts.map((p) => stable(p)).join("|"));
}

export function runIdempotencyKey(templateId: string, businessId: string, inputHash: string): string {
  return `${templateId}|${businessId}|${inputHash}`;
}

// Find an existing non-cancelled Run with the same idempotency key.
export async function findExistingRun(svc: any, idempotencyKey: string): Promise<any | null> {
  const rows = await svc.entities.LaunchPlan.filter({ idempotency_key: idempotencyKey });
  if (!rows || !rows.length) return null;
  // Prefer a non-cancelled run; else return the latest.
  const live = rows.filter((r: any) => r.status !== "cancelled");
  return (live.length ? live : rows).sort((a: any, b: any) =>
    String(b.created_date || "").localeCompare(String(a.created_date || ""))
  )[0];
}

// Execution-level idempotency: skip dispatch if a successful Execution already
// exists for this (task, input_hash). Used for resume-from-checkpoint.
export async function findSuccessfulExecution(svc: any, taskId: string, inputHash: string): Promise<any | null> {
  const rows = await svc.entities.AIExecution.filter({ task_id: taskId, input_hash: inputHash, success: true });
  if (!rows || !rows.length) return null;
  return rows[0];
}

// Find the last successful STAGE checkpoint Execution for a task (resume pointer).
export async function lastSuccessfulStage(svc: any, taskId: string): Promise<any | null> {
  const rows = await svc.entities.AIExecution.filter({ task_id: taskId, success: true });
  if (!rows || !rows.length) return null;
  return rows.sort((a: any, b: any) => (b.attempt || 0) - (a.attempt || 0) || String(b.created_date || "").localeCompare(String(a.created_date || "")))[0];
}