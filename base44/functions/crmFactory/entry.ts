import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  stageBusinessAnalysis, stageCrmBlueprint, stagePipeline, stageLeadScoring,
  stageAutomations, stageTasks, stageEmailTemplates, buildDashboard, buildReports, validateCRM,
  provenance, actorName,
} from '../../shared/crm/factory.ts';
import { createModuleEngine, runAIStage, isModuleEnabled } from '../../shared/sdk/index.ts';

// Shared Version Engine — the CRM reuses it for draft/approved/published/rollback/history.
// Publish dispatches CRMApproved (the platform event downstream engines consume).
const crmEngine = createModuleEngine({
  name: 'crm', versionEntity: 'CRMVersion', projectIdField: 'crm_project_id', publishedEventType: 'CRMApproved',
});

// AI CRM Factory — converts an APPROVED Business Blueprint + PUBLISHED Website (and a
// PUBLISHED SEO Version when available as enrichment) into a versioned, self-configuring
// CRM program (business analysis → CRM blueprint → pipeline → scoring → automations →
// tasks → email templates → dashboard → reports). CRM no longer hard-requires SEO — the
// SEO Factory now consumes the published CRM, so CRM runs first in the pipeline.

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const businessId = body.business_id;

    // AI stages are injected per-stage via the Shared AI Execution Engine (runAIStage) — see generate action.

    // Load approved blueprint + published website (pages) for context.
    const loadInputs = async (bid: string) => {
      const approved = (await svc.entities.BusinessBlueprint.filter({ business_id: bid })).find((r: any) => r.status === 'approved') || null;
      if (!approved) return { blueprint: null, website: null, seo: null };
      const wsAll = (await svc.entities.Website.filter({ business_id: bid })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
      const ws = wsAll.find((w: any) => w.status === 'published') || wsAll[0] || null;
      if (!ws) return { blueprint: approved, website: null, seo: null };
      const pages = await base44.entities.WebsitePage.filter({ website_id: ws.id });
      const seoProject = (await base44.entities.SEOProject.filter({ business_id: bid }))[0] || null;
      let seo: any = null;
      if (seoProject) {
        const seoVersions = (await base44.entities.SEOVersion.filter({ seo_project_id: seoProject.id })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        const approvedSeo = seoVersions.find((v: any) => v.status === 'approved') || seoVersions[0] || null;
        if (approvedSeo) {
          const [keywords, clusters] = await Promise.all([
            base44.entities.Keyword.filter({ seo_version_id: approvedSeo.id }),
            base44.entities.KeywordCluster.filter({ seo_version_id: approvedSeo.id }),
          ]);
          seo = { version: approvedSeo, keywords, clusters };
        }
      }
      return { blueprint: approved, website: { website: ws, pages }, seo };
    };

    const getProjectFor = async (bid: string) => {
      const projects = (await base44.entities.CRMProject.filter({ business_id: bid })).sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      return projects[0] || null;
    };

    const assembleActive = async (project: any) => {
      const versions = (await base44.entities.CRMVersion.filter({ crm_project_id: project.id })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
      const approved = versions.find((v: any) => v.status === 'published') || versions.find((v: any) => v.status === 'approved') || versions[0] || null;
      if (!approved) return { project, versions, active: null };
      const [pipelines, stages, scoreRules, automations, tasks, widgets, reports, emailTemplates] = await Promise.all([
        base44.entities.Pipeline.filter({ crm_version_id: approved.id }),
        base44.entities.PipelineStage.filter({ crm_version_id: approved.id }),
        base44.entities.LeadScoreRule.filter({ crm_version_id: approved.id }),
        base44.entities.AutomationRule.filter({ crm_version_id: approved.id }),
        base44.entities.TaskTemplate.filter({ crm_version_id: approved.id }),
        base44.entities.DashboardWidget.filter({ crm_version_id: approved.id }),
        base44.entities.CRMReport.filter({ crm_version_id: approved.id }),
        base44.entities.EmailTemplate.filter({ crm_version_id: approved.id }),
      ]);
      stages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      return {
        project, versions,
        active: {
          version: approved,
          pipeline: pipelines[0] || null,
          stages,
          scoreRules,
          automations,
          tasks,
          widgets: widgets.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)),
          reports,
          emailTemplates,
        },
      };
    };

    // ---------- STATUS ----------
    if (action === 'status') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const { blueprint, website, seo } = await loadInputs(businessId);
      const project = await getProjectFor(businessId);
      const payload: any = {
        business: { id: business.id, name: business.name },
        blueprint: blueprint ? { id: blueprint.id, version: blueprint.version } : null,
        website: website ? { id: website.website.id, version: website.website.version, status: website.website.status } : null,
        seo: seo ? { id: seo.version.id, version: seo.version.version, health: seo.version.health_score } : null,
        project, versions: null, active: null,
      };
      if (project) {
        const a = await assembleActive(project);
        payload.versions = a.versions.map((v: any) => ({ id: v.id, version: v.version, status: v.status, health_score: v.health_score, validation_status: v.validation_status, approved_at: v.approved_at }));
        payload.active = a.active ? {
          version: a.active.version,
          pipeline: a.active.pipeline, stages: a.active.stages, scoreRules: a.active.scoreRules,
          automations: a.active.automations, tasks: a.active.tasks, widgets: a.active.widgets, reports: a.active.reports, emailTemplates: a.active.emailTemplates,
        } : null;
      }
      return Response.json(payload);
    }

    // ---------- GENERATE ----------
    if (action === 'generate') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const { blueprint, website, seo } = await loadInputs(businessId);
      if (!blueprint) return Response.json({ error: 'No approved Business Blueprint. Approve a blueprint first.' }, { status: 404 });
      if (!website) return Response.json({ error: 'No published Website. Generate & publish a website first.' }, { status: 404 });
      if (!seo) return Response.json({ error: 'No approved SEO Version. Generate & approve one in the SEO Factory first.' }, { status: 404 });
      const crmEnabled = await isModuleEnabled(base44.asServiceRole, 'crm', businessId);
      if (!crmEnabled) return Response.json({ error: 'CRM module is disabled for this workspace.' }, { status: 403 });
      const t0 = Date.now();
      const bp = blueprint;

      let project = await getProjectFor(businessId);
      if (!project) {
        project = await base44.entities.CRMProject.create({
          tenant_id: business.tenant_id, business_id: businessId, blueprint_id: bp.id, blueprint_version: bp.version,
          website_id: website.website.id, website_version: website.website.version,
          seo_project_id: seo?.version?.seo_project_id ?? null, seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null,
          name: `${business.name} CRM`, status: 'active',
        });
      }

      const nextVersion = async () => { const all = (await base44.entities.CRMVersion.filter({ crm_project_id: project.id })); return (all.reduce((m: number, r: any) => Math.max(m, r.version || 0), 0)) + 1; };
      const version = await nextVersion();

      const llmFor = (stage: string) => async (prompt: string, schema: any) => {
        const r = await runAIStage(base44, { prompt, schema, stage: `crm.${stage}`, promptVersion: 'crm-prompt-v1', tenantId: business.tenant_id, businessId, module: 'crm', version });
        if (!r.ok) throw new Error(r.error?.message || `AI stage ${stage} failed`);
        return r.data;
      };

      // Stage 1 + 2
      const analysis = await stageBusinessAnalysis(llmFor('business_analysis'), bp, seo);
      const crmBp = await stageCrmBlueprint(llmFor('crm_blueprint'), bp, analysis);

      // Stage 3 + 4
      const pipeline = await stagePipeline(llmFor('pipeline'), bp, analysis, crmBp);
      const scoring = await stageLeadScoring(llmFor('lead_scoring'), bp, analysis, pipeline);

      // Stage 5 + 6
      const automations = await stageAutomations(llmFor('automations'), bp, analysis, pipeline, scoring);
      const tasks = await stageTasks(llmFor('tasks'), bp, analysis, pipeline);

      // Stage 7: email templates (AI)
      const email = await stageEmailTemplates(llmFor('email_templates'), bp, analysis, pipeline, crmBp);

      // Stage 8 + 9 (deterministic)
      const widgets = buildDashboard(pipeline, scoring, analysis);
      const reports = buildReports(pipeline, analysis);

      // Validation (deterministic)
      const validation = validateCRM(analysis, crmBp, pipeline, scoring, automations.automations, tasks.tasks, email.templates);

      const llmCalls = 7;

      const versionRec: any = await base44.entities.CRMVersion.create({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id,
        seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null, website_id: website.website.id, website_version: website.website.version,
        blueprint_id: bp.id, blueprint_version: bp.version, version, status: 'draft',
        business_analysis: analysis, crm_blueprint: crmBp,
        stage_count: pipeline.stages.length, score_rule_count: scoring.rules.length, automation_count: automations.automations.length,
        task_template_count: tasks.tasks.length, dashboard_widget_count: widgets.length, report_count: reports.length,
        health_score: validation.summary.health_score, validation_status: validation.status,
        summary: { industry: analysis.industry, pipeline_name: pipeline.name, thresholds: scoring.thresholds, validation_summary: validation.summary, validation_checks: validation.checks, email_template_count: email.templates.length, lead_field_count: (crmBp.lead_fields || []).length, contact_section_count: (crmBp.contact_profile?.sections || []).length },
        generated_by: actorName(user), generated_at: new Date().toISOString(),
        provenance: provenance(t0, llmCalls, 'complete'),
      });

      // Pipeline + stages
      const pipelineRec = await base44.entities.Pipeline.create({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        name: pipeline.name, description: pipeline.description || '', total_stages: pipeline.stages.length, stage_keys: pipeline.stages.map((s: any) => s.key),
        provenance: provenance(t0, 0, 'complete'),
      });
      await base44.entities.PipelineStage.bulkCreate(pipeline.stages.map((s: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version, pipeline_id: pipelineRec.id,
        key: s.key, name: s.name, description: s.description || '', order: s.order, probability: s.probability ?? 0,
        entry_criteria: s.entry_criteria || '', exit_criteria: s.exit_criteria || '', owner_role: s.owner_role || '', automation_hint: s.automation_hint || '', sla_hours: s.sla_hours ?? 0,
        provenance: provenance(t0, 0, 'complete'),
      })));

      if (scoring.rules.length) await base44.entities.LeadScoreRule.bulkCreate(scoring.rules.map((r: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        rule_key: r.rule_key, field: r.field, operator: r.operator, value: String(r.value ?? ''), points: r.points ?? 0, reason: r.reason || '', priority: r.points ?? 0,
        provenance: provenance(t0, 0, 'complete'),
      })));

      if (automations.automations.length) await base44.entities.AutomationRule.bulkCreate(automations.automations.map((a: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        name: a.name, trigger: a.trigger, trigger_stage: a.trigger_stage || '', conditions: a.conditions || [], actions: a.actions, owner_role: a.owner_role || '', priority: 50, enabled: true,
        provenance: provenance(t0, 0, 'complete'),
      })));

      if (tasks.tasks.length) await base44.entities.TaskTemplate.bulkCreate(tasks.tasks.map((t: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        name: t.name, type: t.type, trigger: t.trigger || '', owner_role: t.owner_role || '', due_offset_hours: t.due_offset_hours ?? 0, priority: t.priority || 'medium', description: t.description || '', escalation_hours: t.escalation_hours ?? 0,
        provenance: provenance(t0, 0, 'complete'),
      })));

      await base44.entities.DashboardWidget.bulkCreate(widgets.map((w: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        key: w.key, title: w.title, metric: w.metric, data_source: w.data_source, size: w.size, order: w.order, icon_hint: w.icon_hint || '', config: w.config || {},
        provenance: provenance(t0, 0, 'complete'),
      })));

      await base44.entities.CRMReport.bulkCreate(reports.map((r: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        key: r.key, title: r.title, type: r.type, description: r.description, schedule: r.schedule, data_source: r.data_source, config: r.config || {},
        provenance: provenance(t0, 0, 'complete'),
      })));

      await base44.entities.EmailTemplate.bulkCreate(email.templates.map((t: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, crm_project_id: project.id, crm_version_id: versionRec.id, crm_version: version,
        seo_version_id: seo?.version?.id ?? null, website_id: website.website.id, blueprint_id: bp.id, blueprint_version: bp.version,
        key: t.key, name: t.name, type: t.type, subject: t.subject, body: t.body, channel: t.channel || 'email', trigger: t.trigger || '', owner_role: t.owner_role || '',
        provenance: provenance(t0, 0, 'complete'),
      })));

      // Keep cross-references on the project (active pointer preserved until a new version is approved).
      await base44.entities.CRMProject.update(project.id, {
        blueprint_id: bp.id, blueprint_version: bp.version, website_id: website.website.id, website_version: website.website.version,
        seo_version_id: seo?.version?.id ?? null, seo_version: seo?.version?.version ?? null, current_version: version, health_score: validation.summary.health_score,
      });

      const a = await assembleActive(project);
      return Response.json({
        version: a.active ? a.active.version : versionRec,
        stages: pipeline.stages.length, score_rules: scoring.rules.length, automations: automations.automations.length,
        tasks: tasks.tasks.length, widgets: widgets.length, reports: reports.length, email_templates: email.templates.length,
        health_score: validation.summary.health_score, validation_status: validation.status,
      });
    }

    // ---------- APPROVE (draft → approved; review-ready, not yet active) ----------
    if (action === 'approve') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.CRMVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft CRM versions can be approved. Generate a new version instead.' }, { status: 409 });
      await crmEngine.approve(base44, version_id, actorName(user));
      const approved: any = await base44.entities.CRMVersion.get(version_id);
      return Response.json({ version: approved });
    }

    // ---------- PUBLISH (approved → published; activates the CRM for the workspace) ----------
    if (action === 'publish') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.CRMVersion.get(version_id);
      if (v.status !== 'approved') return Response.json({ error: 'Only approved CRM versions can be published. Approve this version first.' }, { status: 409 });
      await crmEngine.publish(base44, version_id, actorName(user));
      await base44.entities.CRMProject.update(v.crm_project_id, { active_crm_version_id: version_id, current_version: v.version, health_score: v.health_score });
      const published: any = await base44.entities.CRMVersion.get(version_id);
      return Response.json({ version: published });
    }

    // ---------- REJECT ----------
    if (action === 'reject') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.CRMVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft CRM versions can be rejected.' }, { status: 409 });
      const rejected = await base44.entities.CRMVersion.update(version_id, { status: 'rejected' });
      return Response.json({ version: rejected });
    }

    // ---------- UPDATE (edit pipeline stages / crm blueprint on a DRAFT) ----------
    if (action === 'update') {
      const { version_id, pipeline_stages, crm_blueprint, business_analysis } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.CRMVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft CRM versions are editable. Generate a new version to make changes.' }, { status: 409 });
      const updates: any = {};
      if (crm_blueprint) updates.crm_blueprint = { ...(v.crm_blueprint || {}), ...crm_blueprint };
      if (business_analysis) updates.business_analysis = { ...(v.business_analysis || {}), ...business_analysis };
      const updated: any = await base44.entities.CRMVersion.update(version_id, updates);

      // Stage edits: full replace of stage rows for this draft version.
      if (Array.isArray(pipeline_stages)) {
        const existing = await base44.entities.PipelineStage.filter({ crm_version_id: version_id });
        if (existing.length) await base44.entities.PipelineStage.deleteMany({ id: { $in: existing.map((s: any) => s.id) } } as any);
        const project = (existing[0] && existing[0].crm_project_id) || v.crm_project_id;
        let pipelineId = '';
        const pipelines = await base44.entities.Pipeline.filter({ crm_version_id: version_id });
        if (pipelines.length) {
          pipelineId = pipelines[0].id;
          await base44.entities.Pipeline.update(pipelineId, { total_stages: pipeline_stages.length, stage_keys: pipeline_stages.map((s: any) => s.key), name: pipelines[0].name });
        }
        if (pipeline_stages.length) {
          await base44.entities.PipelineStage.bulkCreate(pipeline_stages.map((s: any, i: number) => ({
            tenant_id: v.tenant_id, business_id: v.business_id, crm_project_id: project, crm_version_id: version_id, crm_version: v.version, pipeline_id: pipelineId,
            key: s.key || `stage_${i + 1}`, name: s.name, description: s.description || '', order: i + 1, probability: s.probability ?? 0,
            entry_criteria: s.entry_criteria || '', exit_criteria: s.exit_criteria || '', owner_role: s.owner_role || '', automation_hint: s.automation_hint || '', sla_hours: s.sla_hours ?? 0,
            provenance: provenance(Date.now(), 0, 'edited'),
          })));
        }
        await base44.entities.CRMVersion.update(version_id, { stage_count: pipeline_stages.length });
      }
      return Response.json({ version: updated });
    }

    // ---------- ROLLBACK (re-publish a previously approved/published version) ----------
    if (action === 'rollback') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.CRMVersion.get(version_id);
      if (v.status === 'published') return Response.json({ error: 'This version is already active.' }, { status: 409 });
      if (v.status !== 'approved' && v.status !== 'superseded') return Response.json({ error: 'Only previously approved/published versions can be rolled back to.' }, { status: 409 });
      await crmEngine.rollback(base44, version_id);
      await base44.entities.CRMProject.update(v.crm_project_id, { active_crm_version_id: version_id, current_version: v.version, health_score: v.health_score });
      const active: any = await base44.entities.CRMVersion.get(version_id);
      return Response.json({ version: active });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}