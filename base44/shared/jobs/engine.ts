// Shared Job Engine — one framework for long/background work (website gen,
// SEO gen, blog, localization, marketing campaigns, email campaigns, imports).
//
// Lifecycle: queued → running → completed | failed | cancelled.
// Tracks progress %, attempts/retries, estimated completion, and provenance.
//
// Durability note (honest): a single backend-function invocation is short-lived.
// TRULY long-running or scheduled jobs are submitted to Base44 Workflows, which
// invoke this engine to create the Job row, call updateProgress, and finalize.
// Sync (in-function) jobs are supported directly via runJob for short work.
// No fake queue is simulated — status transitions are the contract.

import { bus } from '../events/bus.ts';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobInput {
  tenant_id?: string;
  business_id?: string;
  type: string;
  payload?: any;
  total_amount?: number;
  created_by?: string;
  max_attempts?: number;
}

export interface JobRecord {
  id: string; tenant_id?: string; business_id?: string;
  type: string; status: JobStatus; progress: number;
  total_amount?: number; processed_amount?: number;
  attempts: number; max_attempts: number;
  started_at?: string; completed_at?: string; estimated_completion_at?: string;
  created_by?: string; error_message?: string; payload?: any; result?: any;
}

const svc = (base44: any) => base44.asServiceRole ?? base44;

function estCompletion(startMs: number, progress: number, total: number | undefined): string | undefined {
  if (!total || progress <= 0) return undefined;
  const elapsed = Date.now() - startMs;
  const fraction = Math.min(1, progress / total);
  if (fraction <= 0) return undefined;
  const eta = elapsed / fraction;
  return new Date(startMs + eta).toISOString();
}

export async function createJob(base44: any, input: JobInput): Promise<JobRecord> {
  const rec: any = await svc(base44).entities.Job.create({
    tenant_id: input.tenant_id ?? null, business_id: input.business_id ?? null,
    type: input.type, status: 'queued', progress: 0,
    total_amount: input.total_amount, processed_amount: 0,
    attempts: 0, max_attempts: input.max_attempts ?? 1,
    payload: input.payload ?? {}, created_by: input.created_by ?? null,
  });
  return rec;
}

export async function updateProgress(base44: any, jobId: string, processed: number, message?: string): Promise<void> {
  const start = Date.now();
  // read current to compute progress + estimate
  const cur: any = await svc(base44).entities.Job.get(jobId);
  const total = cur.total_amount || 0;
  const progress = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  await svc(base44).entities.Job.update(jobId, {
    progress, processed_amount: processed,
    estimated_completion_at: estCompletion(start, progress, total),
    error_message: message ?? null,
  });
}

export async function startJob(base44: any, jobId: string): Promise<void> {
  await svc(base44).entities.Job.update(jobId, { status: 'running', started_at: new Date().toISOString(), attempts: 1 });
}

export async function completeJob(base44: any, jobId: string, result?: any): Promise<JobRecord> {
  const updated = await svc(base44).entities.Job.update(jobId, { status: 'completed', progress: 100, completed_at: new Date().toISOString(), result: result ?? {} });
  await bus.dispatch('JobCompleted', { tenantId: updated.tenant_id, businessId: updated.business_id, payload: { jobId, type: updated.type } });
  return updated;
}

export async function failJob(base44: any, jobId: string, error: string, result?: any): Promise<JobRecord> {
  const updated = await svc(base44).entities.Job.update(jobId, { status: 'failed', completed_at: new Date().toISOString(), error_message: error, result: result ?? {} });
  await bus.dispatch('JobFailed', { tenantId: updated.tenant_id, businessId: updated.business_id, payload: { jobId, type: updated.type, error } });
  return updated;
}

export async function cancelJob(base44: any, jobId: string): Promise<JobRecord> {
  return await svc(base44).entities.Job.update(jobId, { status: 'cancelled', completed_at: new Date().toISOString() });
}

/**
 * Run a synchronous (in-function) job with progress reporting and retries.
 * The `runner` receives (report) where report(processed) updates progress.
 * On failure within max_attempts, the job is retried; final failure marks failed.
 */
export async function runJob(base44: any, input: JobInput, runner: (report: (processed: number, message?: string) => Promise<void>) => Promise<any>): Promise<JobRecord> {
  const job = await createJob(base44, input);
  await startJob(base44, job.id);
  const maxAttempts = input.max_attempts ?? 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await svc(base44).entities.Job.update(job.id, { attempts: attempt, error_message: `retry ${attempt}` });
    try {
      const report = async (processed: number, message?: string) => { await updateProgress(base44, job.id, processed, message); };
      const result = await runner(report);
      return await completeJob(base44, job.id, result);
    } catch (err: any) {
      if (attempt === maxAttempts) return await failJob(base44, job.id, String(err?.message || err));
      // else loop to retry
    }
  }
  return await failJob(base44, job.id, 'Unknown job failure');
}