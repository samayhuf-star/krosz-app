// Real Orchestrator adapter for `generate_crm`.
//
// Reuses the pure CRM Factory pipeline stages (business_analysis → crm_blueprint →
// pipeline → lead_scoring → automations → tasks → email_templates + the deterministic
// dashboard / reports / validateCRM post-processors) but executes every AI call
// through the orchestrator's truthful provider path (runStructuredAI / executeAIChat).
// The stage logic is UNCHANGED — only the LLM transport + provenance are truthful.
//
// CRM consumes the approved Business Blueprint + the approved/published Website
// THROUGH THE DAG (prior_task_outputs) with a direct fallback, and an APPROVED SEO
// Version as OPTIONAL enrichment (null-safe). This flattens the SEO/CRM circular
// dependency: CRM no longer hard-requires SEO, so the DAG's parallel seo+crm after
// website_approval cannot deadlock.
//
// Records per-stage AIExecution checkpoints, supports retry/resume without
// recomputing completed stages, and writes CRMProject + CRMVersion + every child
// record (Pipeline, PipelineStage, LeadScoreRule, AutomationRule, TaskTemplate,
// DashboardWidget, CRMReport, EmailTemplate) with runtime-truthful provenance —
// the provider that ACTUALLY executed, never the resolved one.
//
// Idempotency: if a CRMVersion already exists for this (run_id, task_id), it is
// returned as-is and no records are re-created — retrying a failed task cannot
// duplicate CRM artifacts.
//
// Only a DRAFT CRMVersion is produced here. Publishing (activating the CRM for the
// workspace) stays behind the separate, approval-gated crmFactory `publish` action.
//
// Returns the dispatch contract shape engine.dispatchTask already expects:
//   { status: 'completed'|'failed', output, error, last_stage, executionIds }

import {
  stageBusinessAnalysis, stageCrmBlueprint, stagePipeline, stageLeadScoring,
  stageAutomations, stageTasks, stageEmailTemplates, buildDashboard, buildReports,
  validateCRM, CRM_PROMPT_VERSION,
} from "../../crm/factory.ts";
import { recordExecution, hashOf } from "../adapterContract.ts";
import { runStructuredAI } from "../ai_provider.ts";
import type { Adapter } from "../adapters.ts";

interface ProvInfo { provider_id: string; provider_key: string; adapter_key: string; model: string }

const AI_STAGES = [
  "business_analysis", "crm_blueprint", "pipeline", "lead_scoring",
  "automations", "tasks", "email_templates",
];

export function createCrmAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor } = input as any;
    const base44 = (svc && svc.__base44) || svc;
    const attempt = task.attempt || 1;
    const t0 = Date.now();
    const execIds: string[] = [];
    const stageProviders: Record<string, ProvInfo> = {};
    const lastLLMError: Record<string, { code: string; message: string } | null> = {};
    const metas: any[] = [];

    // Resume-from-checkpoint: stages whose AIExecution already succeeded.
    const doneRows = await svc.entities.AIExecution.filter({ task_id: task.id, success: true }).catch(() => []);
    const done = new Set((doneRows || []).map((e: any) => e.stage));
    // Restore runtime-truthful provider info for AI stages already checkpointed on a
    // prior attempt, so the persisted version's primary provenance + stage_providers
    // reflect the actual runtime executor even when an AI stage is skipped on resume.
    for (const e of (doneRows || [])) {
      if (AI_STAGES.includes(e.stage) && e.success && e.provider) {
        stageProviders[e.stage] = { provider_id: e.provider_id, provider_key: e.provider, adapter_key: e.adapter_key, model: e.model };
      }
    }
    const ckptOf = async (stage: string): Promise<any | null> => {
      const rows = (doneRows || []).filter((e: any) => e.stage === stage).sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
      if (!rows.length) return null;
      return rows[0].output || null;
    };

    const providerRef = (stage: string): any => {
      const p = stageProviders[stage] || ({} as ProvInfo);
      return {
        provider_id: p.provider_id || resolvedProvider?.provider_id || "",
        provider_key: p.provider_key || resolvedProvider?.key || resolvedProvider?.provider_key || "",
        adapter_key: p.adapter_key || resolvedProvider?.adapter_key || "",
        name: p.provider_key || resolvedProvider?.name || "",
        category: "", via: resolvedProvider?.via || "",
      };
    };
    const modelOf = (stage: string) => (stageProviders[stage] || ({} as ProvInfo)).model || "";

    const checkpoint = async (stage: string, success: boolean, output: any, durationMs: number, errorCode = "", errorMessage = "", retryable = false) => {
      const outObj: any = output == null ? {} : (Array.isArray(output) ? { items: output, count: output.length } : (typeof output === "object" ? output : { value: output }));
      const id = await recordExecution(svc, {
        run, task, attempt, stage, operation: `generate_crm.${stage}`,
        capability: task.provider_capability || "ai_generation",
        provider: providerRef(stage), model: modelOf(stage),
        inputHash: task.input_hash, outputHash: hashOf(outObj),
        success, errorCode, errorMessage, retryable, durationMs, actor, output: outObj,
      });
      execIds.push(id);
    };

    const failed = (code: string, message: string, lastStage: string, retryable = true) => ({
      status: "failed" as const, output: null,
      error: { code, message, retryable }, last_stage: lastStage, executionIds: execIds, provider: resolvedProvider,
    });

    // --- Load approved blueprint (single source of truth). ---
    const blue: any = await (async () => {
      const ctxBp = context?.business?.approved_blueprint;
      if (ctxBp && ctxBp.id) { try { return await svc.entities.BusinessBlueprint.get(ctxBp.id); } catch {} }
      const all = await svc.entities.BusinessBlueprint.filter({ business_id: run.business_id });
      return (all || []).filter((x: any) => x.status === "approved").sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
    })();
    if (!blue) {
      await checkpoint("business_analysis", false, null, 0, "VALIDATION_FAILED", "No approved Business Blueprint yet — approve a blueprint first.", false);
      return failed("VALIDATION_FAILED", "No approved Business Blueprint yet — approve a blueprint first.", "business_analysis", false);
    }

    // --- Consume the approved Website output THROUGH THE DAG (prior_task_outputs). ---
    const websiteOut = (context?.prior_task_outputs && context.prior_task_outputs["website"]) || null;
    let websiteId = websiteOut?.website_id || null;
    let websiteVersion = websiteOut?.version || null;
    let website: any = null;
    if (websiteId) { try { website = await svc.entities.Website.get(websiteId); } catch {} }
    if (!website) {
      const all = await svc.entities.Website.filter({ business_id: run.business_id }).catch(() => []);
      website = (all || []).sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
      websiteId = website?.id || null; websiteVersion = website?.version || null;
    }
    if (!website) {
      await checkpoint("business_analysis", false, null, 0, "VALIDATION_FAILED", "No Website output found in the DAG — generate + approve the website first.", false);
      return failed("VALIDATION_FAILED", "No Website output found in the DAG — generate + approve the website first.", "business_analysis", false);
    }

    // --- OPTIONAL enrichment: approved SEO version + keywords/clusters (null-safe). ---
    let seo: any = null;
    try {
      const seoProject = (await svc.entities.SEOProject.filter({ business_id: run.business_id }).catch(() => []))[0] || null;
      if (seoProject) {
        const seoVersions = (await svc.entities.SEOVersion.filter({ seo_project_id: seoProject.id }).catch(() => [])).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        const approvedSeo = seoVersions.find((v: any) => v.status === "approved") || seoVersions[0] || null;
        if (approvedSeo) {
          const [keywords, clusters] = await Promise.all([
            svc.entities.Keyword.filter({ seo_version_id: approvedSeo.id }).catch(() => []),
            svc.entities.KeywordCluster.filter({ seo_version_id: approvedSeo.id }).catch(() => []),
          ]);
          seo = { version: approvedSeo, keywords, clusters };
        }
      }
    } catch {}

    const bp = blue;

    // --- Truthful LLM transport: each stage's prompt is sent through runStructuredAI
    //     (executeAIChat). The CRM stage prompts already embed blueprint/SEO context,
    //     so no context is prepended here (avoids duplication). Provenance is read
    //     from the runtime result. ---
    const mkLLM = (coarse: string) => async (prompt: string, schema: any) => {
      const r = await runStructuredAI(base44, svc, { tenantId: run.tenant_id, businessId: run.business_id, prompt, schema, stage: `crm.${coarse}` });
      stageProviders[coarse] = { provider_id: r.provider_id, provider_key: r.provider_key, adapter_key: r.adapter_key, model: r.model };
      metas.push({ ok: r.ok, stage: coarse, provider: r.provider_key, model: r.model, fallback_used: r.fallback_used });
      lastLLMError[coarse] = r.ok ? null : { code: r.error_code || "AI_FAILED", message: r.error_message || "" };
      if (!r.ok || r.data == null) throw new Error(r.error_message || `${coarse} AI stage failed`);
      return r.data;
    };

    const stageRun = async (coarse: string, fn: () => Promise<any>) => {
      if (done.has(coarse)) return await ckptOf(coarse);
      const t = Date.now();
      // Test seam: force exactly one AI stage to fail on attempt 1, so the
      // failure/retry + resume-from-checkpoint matrix is exercisable end-to-end.
      // Gated on an internal __sim flag, fires only on attempt 1, never in prod.
      const sim = (task.input_context && task.input_context.__sim) || (context && context.__sim);
      if (sim && sim.force_fail_stage === coarse && attempt === 1) {
        const msg = `Simulated failure at "${coarse}" (attempt 1)`;
        lastLLMError[coarse] = { code: "PROVIDER_TIMEOUT", message: msg };
        await checkpoint(coarse, false, { error: msg }, Date.now() - t, "PROVIDER_TIMEOUT", msg, true);
        throw new Error(msg);
      }
      try {
        const data = await fn();
        await checkpoint(coarse, true, data, Date.now() - t);
        return data;
      } catch (e: any) {
        const err = lastLLMError[coarse] || { code: "FACTORY_FAILED", message: e.message };
        await checkpoint(coarse, false, { error: e.message }, Date.now() - t, err.code, err.message, true);
        throw e;
      }
    };

    // --- Stage 1: business_analysis ---
    let analysis: any;
    try { analysis = await stageRun("business_analysis", () => stageBusinessAnalysis(mkLLM("business_analysis"), bp, seo)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "business_analysis"); }

    // --- Stage 2: crm_blueprint ---
    let crmBp: any;
    try { crmBp = await stageRun("crm_blueprint", () => stageCrmBlueprint(mkLLM("crm_blueprint"), bp, analysis)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "crm_blueprint"); }

    // --- Stage 3: pipeline ---
    let pipeline: any;
    try { pipeline = await stageRun("pipeline", () => stagePipeline(mkLLM("pipeline"), bp, analysis, crmBp)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "pipeline"); }

    // --- Stage 4: lead_scoring ---
    let scoring: any;
    try { scoring = await stageRun("lead_scoring", () => stageLeadScoring(mkLLM("lead_scoring"), bp, analysis, pipeline)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "lead_scoring"); }

    // --- Stage 5: automations ---
    let automations: any;
    try { automations = await stageRun("automations", () => stageAutomations(mkLLM("automations"), bp, analysis, pipeline, scoring)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "automations"); }

    // --- Stage 6: tasks ---
    let tasksData: any;
    try { tasksData = await stageRun("tasks", () => stageTasks(mkLLM("tasks"), bp, analysis, pipeline)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "tasks"); }

    // --- Stage 7: email_templates ---
    let emailData: any;
    try { emailData = await stageRun("email_templates", () => stageEmailTemplates(mkLLM("email_templates"), bp, analysis, pipeline, crmBp)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "email_templates"); }

    // --- Deterministic post-processing (recomputed from AI outputs every attempt). ---
    const widgets = buildDashboard(pipeline, scoring, analysis);
    const reports = buildReports(pipeline, analysis);
    const validation = validateCRM(analysis, crmBp, pipeline, scoring, automations.automations, tasksData.tasks, emailData.templates);
    await checkpoint("validation", true, { status: validation.status, summary: validation.summary }, Date.now() - t0);

    // --- Truthful provenance for every persisted record. ---
    const stageOrder = AI_STAGES;
    const primary = stageProviders["business_analysis"] || ({} as ProvInfo);
    const providerKeys = [...new Set(stageOrder.map((s) => stageProviders[s]?.provider_key).filter(Boolean))];
    const models = [...new Set(stageOrder.map((s) => stageProviders[s]?.model).filter(Boolean))];
    const llmCalls = metas.length;
    const crmProvenance = {
      ai_provider: primary.provider_key || resolvedProvider?.key || "base44-core",
      ai_model: models.join(", ") || primary.model || "",
      prompt_version: CRM_PROMPT_VERSION,
      provider_id: primary.provider_id || resolvedProvider?.provider_id || "",
      adapter_key: primary.adapter_key || resolvedProvider?.adapter_key || "",
      run_id: run.id, task_id: task.id, attempt,
      generation_status: "complete",
      fallback_used: providerKeys.length > 1 || (providerKeys[0] && resolvedProvider && providerKeys[0] !== (resolvedProvider.key || resolvedProvider.provider_key)),
      stage_providers: Object.fromEntries(stageOrder.map((s) => [s, stageProviders[s] || {}])),
      generation_time_ms: Date.now() - t0,
      token_usage: { llm_calls: llmCalls, estimated_tokens: llmCalls * 1500, is_estimated: true },
      validation_status: validation.status,
    };

    // --- Idempotency guard: a CRMVersion already persisted for this (run_id, task_id)
    //     means a retry is resuming a dispatch that already wrote its artifacts —
    //     return it as-is; never duplicate CRM records. ---
    const existingVersions = await svc.entities.CRMVersion.filter({ business_id: run.business_id }).catch(() => []);
    const existing = (existingVersions || []).find((v: any) => v.provenance && v.provenance.run_id === run.id && v.provenance.task_id === task.id);
    if (existing) {
      return {
        status: "completed" as const,
        output: { crm_version_id: existing.id, version: existing.version, idempotent: true, health_score: existing.health_score, validation_status: existing.validation_status, ai_provider: existing.provenance?.ai_provider, provider_id: existing.provenance?.provider_id, adapter_key: existing.provenance?.adapter_key },
        last_stage: "validation",
        executionIds: execIds,
        provider: resolvedProvider,
      };
    }

    // --- Persist: CRMProject + CRMVersion + every child record. ---
    let project: any = (await svc.entities.CRMProject.filter({ business_id: run.business_id }).catch(() => []))[0] || null;
    if (!project) {
      project = await svc.entities.CRMProject.create({
        tenant_id: run.tenant_id, business_id: run.business_id, blueprint_id: bp.id, blueprint_version: bp.version,
        website_id: website.id, website_version: websiteVersion,
        seo_project_id: seo?.version?.seo_project_id ?? null, seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null,
        name: `${(await svc.entities.Business.get(run.business_id).catch(() => ({}))).name || run.business_id} CRM`, status: "active",
      });
    }
    const allVersions = await svc.entities.CRMVersion.filter({ crm_project_id: project.id }).catch(() => []);
    const version = (allVersions || []).reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;
    const versionRec: any = await svc.entities.CRMVersion.create({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id,
      seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null, website_id: website.id, website_version: websiteVersion,
      blueprint_id: bp.id, blueprint_version: bp.version, version, status: "draft",
      business_analysis: analysis, crm_blueprint: crmBp,
      stage_count: pipeline.stages.length, score_rule_count: scoring.rules.length, automation_count: automations.automations.length,
      task_template_count: tasksData.tasks.length, dashboard_widget_count: widgets.length, report_count: reports.length,
      health_score: validation.summary.health_score, validation_status: validation.status,
      summary: { industry: analysis.industry, pipeline_name: pipeline.name, thresholds: scoring.thresholds, validation_summary: validation.summary, validation_checks: validation.checks, email_template_count: emailData.templates.length, lead_field_count: (crmBp.lead_fields || []).length, contact_section_count: (crmBp.contact_profile?.sections || []).length },
      generated_by: actor, generated_at: new Date().toISOString(), provenance: crmProvenance,
    });

    const pipelineRec = await svc.entities.Pipeline.create({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      name: pipeline.name, description: pipeline.description || "", total_stages: pipeline.stages.length, stage_keys: pipeline.stages.map((s: any) => s.key),
      provenance: crmProvenance,
    });
    await svc.entities.PipelineStage.bulkCreate(pipeline.stages.map((s: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version, pipeline_id: pipelineRec.id,
      key: s.key, name: s.name, description: s.description || "", order: s.order, probability: s.probability ?? 0,
      entry_criteria: s.entry_criteria || "", exit_criteria: s.exit_criteria || "", owner_role: s.owner_role || "", automation_hint: s.automation_hint || "", sla_hours: s.sla_hours ?? 0,
      provenance: crmProvenance,
    })));
    if (scoring.rules.length) await svc.entities.LeadScoreRule.bulkCreate(scoring.rules.map((r: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      rule_key: r.rule_key, field: r.field, operator: r.operator, value: String(r.value ?? ""), points: r.points ?? 0, reason: r.reason || "", priority: r.points ?? 0,
      provenance: crmProvenance,
    })));
    if (automations.automations.length) await svc.entities.AutomationRule.bulkCreate(automations.automations.map((a: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      name: a.name, trigger: a.trigger, trigger_stage: a.trigger_stage || "", conditions: a.conditions || [], actions: a.actions, owner_role: a.owner_role || "", priority: 50, enabled: true,
      provenance: crmProvenance,
    })));
    if (tasksData.tasks.length) await svc.entities.TaskTemplate.bulkCreate(tasksData.tasks.map((t: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      name: t.name, type: t.type, trigger: t.trigger || "", owner_role: t.owner_role || "", due_offset_hours: t.due_offset_hours ?? 0, priority: t.priority || "medium", description: t.description || "", escalation_hours: t.escalation_hours ?? 0,
      provenance: crmProvenance,
    })));
    await svc.entities.DashboardWidget.bulkCreate(widgets.map((w: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      key: w.key, title: w.title, metric: w.metric, data_source: w.data_source, size: w.size, order: w.order, icon_hint: w.icon_hint || "", config: w.config || {},
      provenance: crmProvenance,
    })));
    await svc.entities.CRMReport.bulkCreate(reports.map((r: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      key: r.key, title: r.title, type: r.type, description: r.description, schedule: r.schedule, data_source: r.data_source, config: r.config || {},
      provenance: crmProvenance,
    })));
    await svc.entities.EmailTemplate.bulkCreate(emailData.templates.map((t: any) => ({
      tenant_id: run.tenant_id, business_id: run.business_id, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
      seo_version_id: seo?.version?.id ?? null, website_id: website.id, blueprint_id: bp.id, blueprint_version: bp.version,
      key: t.key, name: t.name, type: t.type, category: "general", subject: t.subject, body: t.body, channel: t.channel || "email", trigger: t.trigger || "", owner_role: t.owner_role || "",
      provenance: crmProvenance,
    })));

    await svc.entities.CRMProject.update(project.id, {
      blueprint_id: bp.id, blueprint_version: bp.version, website_id: website.id, website_version: websiteVersion,
      seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null, current_version: version, health_score: validation.summary.health_score,
    });

    return {
      status: "completed" as const,
      output: { crm_version_id: versionRec.id, version, website_id: website.id, stage_count: pipeline.stages.length, score_rule_count: scoring.rules.length, automation_count: automations.automations.length, task_count: tasksData.tasks.length, widget_count: widgets.length, report_count: reports.length, email_template_count: emailData.templates.length, health_score: validation.summary.health_score, validation_status: validation.status, ai_provider: primary.provider_key, provider_id: primary.provider_id, adapter_key: primary.adapter_key },
      last_stage: "validation",
      executionIds: execIds,
      provider: resolvedProvider,
    };
  };
}