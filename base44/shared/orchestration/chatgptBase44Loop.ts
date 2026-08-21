// ChatGPT ↔ Base44 Orchestral Loop
// Persistent control-plane state for iterative audit → fix → test → certify work.
// ChatGPT/Base44 tooling performs the actual repository edits and test execution;
// this helper persists loop state so a future turn can resume without copy/paste.

export type LoopState = 'AUDIT' | 'FIX' | 'TEST' | 'CERTIFY' | 'PAUSED' | 'COMPLETED';
export type LoopOutcome = 'PASS' | 'NEEDS_FIX' | 'BLOCKED' | 'DONE';

const LOOP_TEMPLATE_ID = 'chatgpt_base44_mvp_loop';
const MAX_ITERATIONS = 12;
const MAX_BUILDER_MESSAGES_PER_ITERATION = 1;

const now = () => new Date().toISOString();

function nextInstruction(state: LoopState): string {
  switch (state) {
    case 'AUDIT': return 'Inspect the current Base44 app and identify the highest-priority MVP blockers using real source, database state, and tests.';
    case 'FIX': return 'Fix the highest-priority confirmed blocker directly in Base44. Make the smallest root-cause repair; do not add unrelated features.';
    case 'TEST': return 'Run the targeted tests plus the full regression/build checks required by the change. Record exact failures, if any.';
    case 'CERTIFY': return 'Run MVP certification: frontend → backend → database → documents/payment/case/admin/execution/tracking. Mark only evidence-backed gates as passing.';
    case 'PAUSED': return 'Loop is paused on a real external or approval blocker. Resolve the blocker before resuming.';
    case 'COMPLETED': return 'MVP loop is complete. No further automatic engineering step is required until a new goal is opened.';
  }
}

async function tasksFor(svc: any, runId: string) {
  const rows = await svc.entities.LaunchTask.filter({ launch_id: runId }).catch(() => []);
  return (rows || []).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
}

async function findActive(svc: any, businessId: string) {
  const rows = await svc.entities.LaunchPlan.filter({ business_id: businessId, plan_template_id: LOOP_TEMPLATE_ID }).catch(() => []);
  return (rows || [])
    .filter((r: any) => !['completed', 'cancelled'].includes(r.status))
    .sort((a: any, b: any) => String(b.updated_date || b.created_date || '').localeCompare(String(a.updated_date || a.created_date || '')))[0] || null;
}

export async function startChatGPTBase44Loop(svc: any, p: { businessId: string; actor: string; goal?: string }) {
  const existing = await findActive(svc, p.businessId);
  if (existing) return loopStatus(svc, existing.id);

  const run = await svc.entities.LaunchPlan.create({
    tenant_id: 'worldz',
    business_id: p.businessId,
    goal: p.goal || 'Ship the Orizn MVP with a small set of genuinely working visa countries.',
    brief: 'Persistent ChatGPT ↔ Base44 engineering loop. External executor: ChatGPT using Base44 repository/data tools. Control plane: Orchestral LaunchPlan/LaunchTask.',
    status: 'running',
    workflow: ['AUDIT', 'FIX', 'TEST', 'CERTIFY'],
    progress: 0,
    current_step_id: 'AUDIT',
    total_steps: 4,
    completed_steps: 0,
    plan_template_id: LOOP_TEMPLATE_ID,
    plan_version: 1,
    requested_by: p.actor,
    started_at: now(),
    provenance: {
      loop_kind: 'CHATGPT_BASE44',
      target: 'ORIZN_MVP',
      iteration: 1,
      max_iterations: MAX_ITERATIONS,
      max_builder_messages_per_iteration: MAX_BUILDER_MESSAGES_PER_ITERATION,
      credit_strategy: 'DIRECT_REPO_FIRST',
      state: 'AUDIT',
      next_instruction: nextInstruction('AUDIT'),
      last_outcome: null,
      last_summary: null,
      last_evidence: null,
    },
  });

  await svc.entities.LaunchTask.create({
    tenant_id: 'worldz', business_id: p.businessId, launch_id: run.id,
    step_id: 'i1-AUDIT', task_key: 'i1-AUDIT', name: 'MVP audit', description: nextInstruction('AUDIT'),
    owner: 'chatgpt_base44', action: 'audit', type: 'verify_mvp', ai_required: false,
    status: 'ready', order: 1, retryable: true, max_retries: 3,
    logs: [{ ts: now(), level: 'info', message: 'Loop started.' }],
  });

  return loopStatus(svc, run.id);
}

export async function loopStatus(svc: any, runId: string) {
  const run = await svc.entities.LaunchPlan.get(runId);
  if (!run) throw Object.assign(new Error('Loop run not found'), { code: 'LOOP_NOT_FOUND' });
  const tasks = await tasksFor(svc, runId);
  const prov = run.provenance || {};
  const state = (prov.state || run.current_step_id || 'AUDIT') as LoopState;
  return {
    ok: true,
    run_id: run.id,
    business_id: run.business_id,
    status: run.status,
    state,
    iteration: prov.iteration || 1,
    max_iterations: prov.max_iterations || MAX_ITERATIONS,
    max_builder_messages_per_iteration: prov.max_builder_messages_per_iteration || MAX_BUILDER_MESSAGES_PER_ITERATION,
    credit_strategy: prov.credit_strategy || 'DIRECT_REPO_FIRST',
    progress: run.progress || 0,
    goal: run.goal,
    next_instruction: prov.next_instruction || nextInstruction(state),
    last_outcome: prov.last_outcome || null,
    last_summary: prov.last_summary || null,
    last_evidence: prov.last_evidence || null,
    tasks,
  };
}

function transition(current: LoopState, outcome: LoopOutcome): LoopState {
  if (outcome === 'BLOCKED') return 'PAUSED';
  if (outcome === 'DONE') return 'COMPLETED';
  if (current === 'AUDIT') return outcome === 'PASS' ? 'TEST' : 'FIX';
  if (current === 'FIX') return outcome === 'PASS' ? 'TEST' : 'FIX';
  if (current === 'TEST') return outcome === 'PASS' ? 'CERTIFY' : 'FIX';
  if (current === 'CERTIFY') return outcome === 'PASS' ? 'COMPLETED' : 'FIX';
  if (current === 'PAUSED') return outcome === 'PASS' ? 'AUDIT' : 'PAUSED';
  return 'COMPLETED';
}

export async function recordLoopStep(svc: any, p: {
  runId: string; actor: string; outcome: LoopOutcome; summary: string; evidence?: any;
}) {
  const current = await loopStatus(svc, p.runId);
  if (current.status === 'completed' || current.state === 'COMPLETED') return current;

  const tasks = current.tasks || [];
  const active = [...tasks].reverse().find((t: any) => ['ready', 'running', 'retrying'].includes(t.status));
  if (active) {
    await svc.entities.LaunchTask.update(active.id, {
      status: p.outcome === 'BLOCKED' ? 'blocked' : (p.outcome === 'NEEDS_FIX' ? 'failed' : 'completed'),
      completed_at: p.outcome === 'BLOCKED' ? null : now(),
      summary: p.summary,
      result: { outcome: p.outcome, evidence: p.evidence || null, actor: p.actor },
      error_code: p.outcome === 'NEEDS_FIX' ? 'MVP_GAP_FOUND' : (p.outcome === 'BLOCKED' ? 'EXTERNAL_BLOCKER' : null),
      error_detail: p.outcome === 'PASS' || p.outcome === 'DONE' ? null : p.summary,
      logs: [...(active.logs || []), { ts: now(), level: p.outcome === 'PASS' ? 'info' : 'warn', message: `${p.outcome}: ${p.summary}` }],
    });
  }

  let next = transition(current.state as LoopState, p.outcome);
  let iteration = current.iteration || 1;
  if (next === 'FIX' && current.state !== 'FIX') iteration += 1;
  if (iteration > (current.max_iterations || MAX_ITERATIONS)) next = 'PAUSED';

  const progressMap: Record<LoopState, number> = { AUDIT: 10, FIX: 35, TEST: 65, CERTIFY: 90, PAUSED: current.progress || 0, COMPLETED: 100 };
  const runPatch: any = {
    current_step_id: next,
    status: next === 'COMPLETED' ? 'completed' : (next === 'PAUSED' ? 'paused' : 'running'),
    progress: progressMap[next],
    completed_at: next === 'COMPLETED' ? now() : null,
    result_summary: next === 'COMPLETED' ? { outcome: p.outcome, summary: p.summary, evidence: p.evidence || null } : null,
    provenance: {
      ...(current.tasks?.length ? {} : {}),
      loop_kind: 'CHATGPT_BASE44', target: 'ORIZN_MVP',
      iteration, max_iterations: current.max_iterations || MAX_ITERATIONS,
      max_builder_messages_per_iteration: current.max_builder_messages_per_iteration || MAX_BUILDER_MESSAGES_PER_ITERATION,
      credit_strategy: current.credit_strategy || 'DIRECT_REPO_FIRST',
      state: next,
      next_instruction: nextInstruction(next),
      last_outcome: p.outcome,
      last_summary: p.summary,
      last_evidence: p.evidence || null,
      last_actor: p.actor,
      last_recorded_at: now(),
    },
  };
  await svc.entities.LaunchPlan.update(p.runId, runPatch);

  if (!['COMPLETED', 'PAUSED'].includes(next)) {
    const order = tasks.length + 1;
    await svc.entities.LaunchTask.create({
      tenant_id: 'worldz', business_id: current.business_id, launch_id: p.runId,
      step_id: `i${iteration}-${next}-${order}`, task_key: `i${iteration}-${next}-${order}`,
      name: `MVP ${next.toLowerCase()}`, description: nextInstruction(next),
      owner: 'chatgpt_base44', action: next.toLowerCase(), type: next === 'FIX' ? 'configure_mvp' : 'verify_mvp',
      ai_required: false, status: 'ready', order, retryable: true, max_retries: 3,
      logs: [{ ts: now(), level: 'info', message: `Activated after ${p.outcome}.` }],
    });
  }

  return loopStatus(svc, p.runId);
}

export async function resumeLoop(svc: any, p: { runId: string; actor: string }) {
  const current = await loopStatus(svc, p.runId);
  if (current.state !== 'PAUSED') return current;
  await svc.entities.LaunchPlan.update(p.runId, {
    status: 'running', current_step_id: 'AUDIT',
    provenance: {
      loop_kind: 'CHATGPT_BASE44', target: 'ORIZN_MVP', iteration: current.iteration,
      max_iterations: current.max_iterations,
      max_builder_messages_per_iteration: current.max_builder_messages_per_iteration || MAX_BUILDER_MESSAGES_PER_ITERATION,
      credit_strategy: current.credit_strategy || 'DIRECT_REPO_FIRST',
      state: 'AUDIT', next_instruction: nextInstruction('AUDIT'),
      last_outcome: 'PASS', last_summary: 'Loop resumed by authorized actor.', last_actor: p.actor, last_recorded_at: now(),
    },
  });
  const tasks = current.tasks || [];
  await svc.entities.LaunchTask.create({
    tenant_id: 'worldz', business_id: current.business_id, launch_id: p.runId,
    step_id: `i${current.iteration}-AUDIT-${tasks.length + 1}`, task_key: `i${current.iteration}-AUDIT-${tasks.length + 1}`,
    name: 'MVP audit', description: nextInstruction('AUDIT'), owner: 'chatgpt_base44', action: 'audit',
    type: 'verify_mvp', ai_required: false, status: 'ready', order: tasks.length + 1, retryable: true, max_retries: 3,
    logs: [{ ts: now(), level: 'info', message: 'Loop resumed.' }],
  });
  return loopStatus(svc, p.runId);
}
