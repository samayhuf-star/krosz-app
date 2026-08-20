// Audit trail. Every important state transition is appended to the Run's
// audit_trail (kept on LaunchPlan.result_summary.audit_trail) AND to the Task's
// logs[]. A dedicated AuditLog entity integration is the next phase; this keeps
// the trail durable and agent-inspectable today.

export async function audit(svc: any, opts: {
  run: any; type: string; actor?: string; task_id?: string; detail?: any;
}): Promise<void> {
  const ts = new Date().toISOString();
  const entry = { ts, type: opts.type, actor: opts.actor || "system", task_id: opts.task_id || null, detail: opts.detail || null };
  try {
    const summary = opts.run.result_summary || {};
    const trail = Array.isArray(summary.audit_trail) ? summary.audit_trail : [];
    trail.push(entry);
    await svc.entities.LaunchPlan.update(opts.run.id, { result_summary: { ...summary, audit_trail: trail } });
  } catch {}
}

export async function taskLog(svc: any, taskId: string, level: string, message: string): Promise<void> {
  try {
    const t: any = await svc.entities.LaunchTask.get(taskId);
    if (!t) return;
    const logs = Array.isArray(t.logs) ? t.logs : [];
    logs.push({ ts: new Date().toISOString(), level, message });
    await svc.entities.LaunchTask.update(taskId, { logs });
  } catch {}
}