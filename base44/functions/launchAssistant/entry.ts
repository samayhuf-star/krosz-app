// Launch Assistant (Business Copilot) — thin client over the Operations Orchestrator.
//
// Architectural contract (Step 2 — Orchestrator cutover):
//   • No longer executes factory workflows or calls recordStep.
//   • Every launch creates/continues an Orchestrator Run (launch_business DAG).
//   • Every factory operation is an Orchestrator Task dispatched via the DAG:
//       UI → launchAssistant → Orchestrator Run → dispatchTask → Factory Adapter
//         → Factory Service → TaskOutput → Checkpoint → Orchestrator → Next Task
//   • launchAssistant retains ONLY its genuine non-factory responsibilities:
//     the AI assessment, AI recommendations, deterministic Business Health, and the
//     compiled Business Launch Report. All are read-only — they never execute a
//     factory. The single authoritative execution path is the Orchestrator.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { orchestrate } from '../../shared/orchestration/engine.ts';
import { getBusinessContext, getGraph, rebuildGraph } from '../../shared/knowledge-graph/index.ts';
import { ensureLaunchPrompts } from '../../shared/launch/prompts.ts';
import { launchRun, advanceRun, approveTask, rejectTask, skipTask, retryTask, cancelRun } from '../../shared/operations/engine.ts';

const actorName = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || 'system';

const MODULE_LABELS: Record<string, string> = {
  blueprint: 'Blueprint Factory', blueprint_approval: 'Approval',
  domain: 'Domain Engine', website: 'Website Factory', website_approval: 'Approval',
  seo: 'SEO Factory', crm: 'CRM Factory', marketing: 'Marketing',
};

// Map an orchestrator Task to the UI's expected task shape (UI keys off step_id).
function mapTask(t: any): any {
  return {
    ...t,
    step_id: t.task_key || t.step_id,
    module_label: t.module_label || MODULE_LABELS[t.task_key] || 'Orchestrator',
    result: t.output || t.result || null,
    error_message: t.error_detail || t.error_message || '',
  };
}

async function latestRun(svc: any, businessId: string): Promise<any | null> {
  const plans = (await svc.entities.LaunchPlan.filter({ business_id: businessId }))
    .sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
  return plans.find((p: any) => p.status !== 'cancelled') || plans[0] || null;
}

// Derive the next runnable / awaiting task for the UI from orchestrator Tasks.
function nextRunnable(tasks: any[]): { next: any | null; awaiting: any | null } {
  const order = [...tasks].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  const done = (s: string) => s === 'completed' || s === 'skipped';
  const depMet = (t: any) => (t.depends_on || []).every((d: string) => order.some((x: any) => (x.task_key || x.step_id) === d && done(x.status)));
  for (const t of order) {
    if (done(t.status) || t.status === 'failed' || t.status === 'rejected' || t.status === 'cancelled') continue;
    if (!depMet(t)) break;
    if (t.status === 'awaiting_approval') return { next: null, awaiting: t };
    return { next: t, awaiting: null };
  }
  return { next: null, awaiting: null };
}

// Shape the Orchestrator Run + Tasks for the UI (replaces the local recompute logic).
async function statusShape(svc: any, launchId: string): Promise<any> {
  const run: any = await svc.entities.LaunchPlan.get(launchId);
  const tasks = (await svc.entities.LaunchTask.filter({ launch_id: launchId }))
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0)).map(mapTask);
  const { next, awaiting } = nextRunnable(tasks);
  return { plan: run, tasks, progress: run.progress || 0, completed: tasks.filter((t: any) => t.status === 'completed' || t.status === 'skipped').length, total: tasks.length, next, awaiting, nextApproval: awaiting };
}

// ---------- Knowledge-graph helpers (read-only; used by Health/Report) ----------
const svOf = (g: any) => g?.source_versions || {};
const covOf = (g: any) => g?.module_coverage || {};
const statsOf = (g: any) => g?.stats || {};

async function tasksFor(svc: any, launchId: string): Promise<any[]> {
  const rows = await svc.entities.LaunchTask.filter({ launch_id: launchId });
  return rows.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
}

// ---------- Deterministic Business Health (unchanged — read-only analytics) ----------
async function computeHealth(svc: any, plan: any, tasks: any[]): Promise<any> {
  const businessId = plan.business_id;
  const graph: any = await getGraph(svc, businessId);
  const sv = svOf(graph); const cov = covOf(graph); const stats = statsOf(graph);
  const ctx: any = graph?.context_snapshot || null;

  const launch = tasks.length ? Math.round((tasks.filter((t: any) => t.status === 'completed' || t.status === 'skipped').length / tasks.length) * 100) : 0;
  const website = !sv.website_id ? 0 : cov.website?.status === 'published' ? 100 : ctx && Array.isArray(ctx.pages) && ctx.pages.length ? 70 : 30;
  const pageCount = (ctx && Array.isArray(ctx.pages) ? ctx.pages.length : 0) || cov.website?.page_count || 0;
  const seo = !sv.seo_version_id ? 0 : Math.min(100, Math.max(0, cov.seo?.health_score ?? (cov.seo?.validation_status === 'pass' ? 95 : 70)));
  const crm = !sv.crm_version_id ? 0 : Math.min(100, Math.max(0, cov.crm?.health_score ?? (cov.crm?.validation_status === 'pass' ? 90 : 65)));

  let provider = 100;
  try {
    const execs = await svc.entities.AIExecution.filter({ business_id: businessId }, '-created_date', 50);
    if (execs.length) {
      const ok = execs.filter((e: any) => e.success).length;
      provider = Math.round((ok / execs.length) * 100);
    }
  } catch {}

  const overall = Math.round(launch * 0.2 + website * 0.2 + seo * 0.2 + crm * 0.2 + provider * 0.2);
  const reasons: Record<string, string> = {
    launch: launch === 100 ? 'All launch steps completed' : `${launch}% of launch steps completed`,
    website: !sv.website_id ? 'No website generated yet' : cov.website?.status === 'published' ? `Published website with ${pageCount} pages` : 'Website drafted — not yet published',
    seo: !sv.seo_version_id ? 'No SEO edition generated yet' : `SEO health ${cov.seo?.health_score ?? 'n/a'} (${cov.seo?.validation_status ?? 'n/a'})`,
    crm: !sv.crm_version_id ? 'No CRM program generated yet' : `CRM health ${cov.crm?.health_score ?? 'n/a'} (${cov.crm?.validation_status ?? 'n/a'})`,
    provider: `AI runtime ${provider}% success rate (last 50 executions)`,
  };
  return {
    scores: { launch_readiness: launch, website_completeness: website, seo_readiness: seo, crm_readiness: crm, provider_health: provider, overall },
    reasons,
    coverage: { has_blueprint: cov.blueprint?.status === 'approved', blueprint_version: sv.blueprint_version, has_website: !!sv.website_id, website_status: cov.website?.status, has_seo: !!sv.seo_version_id, seo_status: cov.seo?.status, has_crm: !!sv.crm_version_id, crm_status: cov.crm?.status, has_domain: !!sv.domain_id, kg_version: graph?.version ?? null, page_count: pageCount, node_count: stats.node_count ?? null, relationship_count: stats.relationship_count ?? null },
  };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    // Stash the full base44 client on svc so factory adapters can reach the truthful
    // provider runtime (executeAIChat needs base44.asServiceRole + secrets + integrations).
    // launchAssistant dispatches Run execution in-process (launchRun/advanceRun), so it
    // must provide the same runtime the orchestrator HTTP entry does.
    try { (svc as any).__base44 = base44; } catch { try { Object.defineProperty(svc, "__base44", { value: base44, enumerable: false, writable: false, configurable: false }); } catch {} }
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const actor = actorName(user);

    // ---------- PREPARE ----------
    // Create/continue an Orchestrator Run, then run the AI assessment (a genuine
    // assistant responsibility — reads the KG, executes no factory).
    if (action === 'prepare') {
      if (!body.business_id) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const goal = (body.goal || '').toString().trim();
      if (!goal) return Response.json({ error: 'goal is required' }, { status: 400 });
      const brief = (body.brief || '').toString();
      const business: any = await base44.entities.Business.get(body.business_id);

      let run: any;
      try {
        const res = await launchRun(svc, { businessId: body.business_id, templateId: 'launch_business', goal, requestedBy: actor });
        run = res.run;
      } catch (e: any) {
        return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.code === 'BUSINESS_NOT_FOUND' || e.code === 'PLAN_INVALID' || e.code === 'TEMPLATE_NOT_FOUND' ? 400 : 500 });
      }

      // AI assessment of the goal vs the knowledge graph (no embedded prompts — via OKE).
      await ensureLaunchPrompts(svc, business.tenant_id);
      try { await getBusinessContext(svc, body.business_id); } catch {}
      let graph: any = null; try { graph = await getGraph(svc, body.business_id); } catch {}
      const ctxSummary = graph ? JSON.stringify({ has_blueprint: covOf(graph).blueprint?.status === 'approved', has_website: !!svOf(graph).website_id, has_seo: !!svOf(graph).seo_version_id, has_crm: !!svOf(graph).crm_version_id, has_domain: !!svOf(graph).domain_id, kg_version: graph?.version ?? null }) : '{}';
      const assessmentRes = await orchestrate(base44, {
        capability: 'LaunchAssistant', moduleId: 'launch_assistant', promptId: 'launch.assessment',
        businessId: body.business_id, tenantId: business.tenant_id, actor,
        variables: { goal, brief, current_state: ctxSummary },
        stage: 'launch.assessment',
      });
      const assessment = assessmentRes.ok ? assessmentRes.data : { goal_understood: goal, readiness: { score: 0, label: 'Needs info' }, clarifying_questions: [], summary: 'Assessment unavailable — the business knowledge graph could not be loaded.' };
      run = await svc.entities.LaunchPlan.update(run.id, { assessment, brief, provenance: { ...(run.provenance || {}), module: 'launch_assistant', assessment_execution_id: assessmentRes.executionId ?? null } });

      const tasks = (await tasksFor(svc, run.id)).map(mapTask);
      return Response.json({ plan: run, tasks, assessment });
    }

    // ---------- GET STATUS ----------
    if (action === 'getStatus') {
      let run: any = body.launch_id ? await svc.entities.LaunchPlan.get(body.launch_id).catch(() => null) : await latestRun(svc, body.business_id);
      if (!run) return Response.json({ plan: null, tasks: [], next: null, awaiting: null, progress: 0 });
      return Response.json(await statusShape(svc, run.id));
    }

    // ---------- START (advance the Orchestrator Run) ----------
    if (action === 'start') {
      await advanceRun(svc, { runId: body.launch_id, actor });
      return Response.json(await statusShape(svc, body.launch_id));
    }

    // ---------- APPROVE / REJECT / SKIP / RETRY / CANCEL ----------
    // Delegated to the Orchestrator — the single owner of task/run state.
    if (action === 'approve') {
      try { await approveTask(svc, { runId: body.launch_id, taskId: body.step_id, decision: 'approved', actor }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
      return Response.json(await statusShape(svc, body.launch_id));
    }
    if (action === 'reject') {
      try { await rejectTask(svc, { runId: body.launch_id, taskId: body.step_id, reason: body.reason, actor }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
      return Response.json(await statusShape(svc, body.launch_id));
    }
    if (action === 'skip') {
      try { await skipTask(svc, { runId: body.launch_id, taskId: body.step_id, actor }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
      return Response.json(await statusShape(svc, body.launch_id));
    }
    if (action === 'retry') {
      try { await retryTask(svc, { runId: body.launch_id, taskId: body.step_id, actor }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
      return Response.json(await statusShape(svc, body.launch_id));
    }
    if (action === 'cancel') {
      const run = await cancelRun(svc, { runId: body.launch_id, actor });
      return Response.json({ plan: run });
    }

    // ---------- RECOMMENDATIONS (AI, via OKE; read-only) ----------
    if (action === 'recommendations') {
      const recs = await ensureRecommendations(base44, await svc.entities.LaunchPlan.get(body.launch_id), true);
      return Response.json({ recommendations: recs });
    }

    // ---------- HEALTH (deterministic; read-only) ----------
    if (action === 'health') {
      const plan: any = await svc.entities.LaunchPlan.get(body.launch_id);
      const tasks = await tasksFor(svc, plan.id);
      const health = await computeHealth(svc, plan, tasks);
      return Response.json({ health });
    }

    // ---------- REPORT (compile; refreshes KG first, read-only) ----------
    if (action === 'report') {
      const plan: any = await svc.entities.LaunchPlan.get(body.launch_id);
      try { await rebuildGraph(svc, plan.business_id, `launch:${actor}`); } catch {}
      const tasks = await tasksFor(svc, plan.id);
      const health = await computeHealth(svc, plan, tasks);
      const recs = await ensureRecommendations(base44, plan, true);
      const report = { health, recommendations: recs.map((r: any) => ({ key: r.key, title: r.title, category: r.category, priority: r.priority, rationale: r.rationale, action_label: r.action_label, action_target: r.action_target })), completed_steps: tasks.filter((t: any) => t.status === 'completed' || t.status === 'skipped').length, total_steps: tasks.length, goal: plan.goal, generated_at: new Date().toISOString() };
      await svc.entities.LaunchPlan.update(plan.id, { result_summary: report, status: plan.status === 'running' || plan.status === 'awaiting_approval' ? 'completed' : plan.status, completed_at: new Date().toISOString() });
      return Response.json({ report, plan: await svc.entities.LaunchPlan.get(plan.id) });
    }

    // ---------- HISTORY ----------
    if (action === 'history') {
      const plans = (await svc.entities.LaunchPlan.filter({ business_id: body.business_id })).sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      return Response.json({ plans: plans.map((p: any) => ({ id: p.id, goal: p.goal, status: p.status, progress: p.progress, completed_steps: p.completed_steps, total_steps: p.total_steps, created_date: p.created_date, completed_at: p.completed_at })) });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}

// ---------- Recommendations helper (AI, via OKE; read-only; cached per launch) ----------
async function ensureRecommendations(base44: any, plan: any, regenerate: boolean): Promise<any[]> {
  const svc = base44.asServiceRole;
  const existing = await svc.entities.LaunchRecommendation.filter({ launch_id: plan.id });
  if (existing.length && !regenerate) return (existing as any[]).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
  const tasks = await tasksFor(svc, plan.id);
  const health = await computeHealth(svc, plan, tasks);
  const res = await orchestrate(base44, {
    capability: 'LaunchAssistant', moduleId: 'launch_assistant', promptId: 'launch.recommendations',
    businessId: plan.business_id, tenantId: plan.tenant_id, actor: plan.created_by || 'assistant',
    variables: { goal: plan.goal || '', health_json: JSON.stringify(health.scores) },
    stage: 'launch.recommendations',
  });
  let recs: any[] = res.ok && Array.isArray(res.data?.recommendations) ? res.data.recommendations : [];
  if (!recs.length) recs = deterministicRecommendations(health, tasks);
  if (existing.length) try { await svc.entities.LaunchRecommendation.deleteMany({ launch_id: plan.id } as any); } catch {}
  const rows = await (svc.entities).LaunchRecommendation.bulkCreate(recs.map((r: any, i: number) => ({
    tenant_id: plan.tenant_id, business_id: plan.business_id, launch_id: plan.id,
    key: r.key || `rec_${i + 1}`, title: r.title || 'Recommendation', category: r.category || 'other',
    priority: typeof r.priority === 'number' ? r.priority : 50, rationale: r.rationale || '',
    action_label: r.action_label || '', action_target: r.action_target || '',
    status: 'open', generated_at: new Date().toISOString(),
    provenance: { module: 'launch_assistant', prompt_version: res.promptVersion, execution_id: res.executionId ?? null, fallback: !res.ok },
  })));
  return (rows as any[]).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
}

// Deterministic fallback recommendations grounded in the health gaps — used if the AI
// call is unavailable. Keeps the launch report useful even with no AI provider configured.
function deterministicRecommendations(health: any, tasks: any[]): any[] {
  const s = health.scores; const out: any[] = [];
  const push = (key: string, title: string, category: string, priority: number, rationale: string, label: string, target: string) => out.push({ key, title, category, priority, rationale, action_label: label, action_target: target });
  if (s.seo_readiness < 90) push('improve_seo', 'Strengthen your SEO edition', 'seo', 88, `SEO readiness is ${s.seo_readiness}/100 — improve meta, schema and internal links.`, 'Open SEO Factory', '/seo');
  if (s.website_completeness < 100) push('publish_website', 'Publish your website', 'website', 92, 'Your website is not yet published — publish to go live.', 'Open Website Factory', '/website');
  if (s.crm_readiness < 90) push('enable_crm', 'Activate your CRM playbook', 'crm', 80, `CRM readiness ${s.crm_readiness}/100 — review pipeline and automations.`, 'Open CRM Factory', '/crm');
  push('premium_domain', 'Consider a premium domain', 'domain', 60, 'A short, brandable domain strengthens recall and SEO.', 'Open Domain Engine', '/domains');
  push('start_blog', 'Create a blog', 'growth', 65, 'Content marketing drives organic traffic over time.', 'Open SEO Factory', '/seo');
  push('enable_chatbot', 'Enable a support AI agent', 'support', 55, 'An AI assistant can deflect common questions and capture leads.', 'Open AI Runtime', '/ai-providers');
  push('invite_team', 'Invite your team', 'team', 70, 'Add collaborators so the business can operate after launch.', 'Open Integrations', '/integrations');
  return out.sort((a: any, b: any) => b.priority - a.priority);
}