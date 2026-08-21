import { createClientFromRequest } from "npm:@base44/sdk@0.8.42";
import "../../shared/registry/manifests/index.ts";
import { ModuleRegistry } from "../../shared/registry/registry.ts";

const now = () => new Date().toISOString();

type Check = { key: string; status: 'pass' | 'warn' | 'fail'; blocker?: boolean; detail: string; evidence?: any };

export default async function (req: Request): Promise<Response> {
  const startedAt = now();
  try {
    const base44 = createClientFromRequest(req);
    const user: any = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc: any = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const checks: Check[] = [];

    const pass = (key: string, detail: string, evidence?: any) => checks.push({ key, status: 'pass', detail, evidence });
    const warn = (key: string, detail: string, evidence?: any) => checks.push({ key, status: 'warn', detail, evidence });
    const fail = (key: string, detail: string, evidence?: any) => checks.push({ key, status: 'fail', blocker: true, detail, evidence });

    pass('auth.session', 'Authenticated Base44 session resolved.', { user_id: user.id });

    const tenantId = user?.data?.tenant_id || user?.tenant_id;
    if (tenantId) pass('tenancy.user_tenant', 'User has a canonical tenant_id.', { tenant_id: tenantId });
    else fail('tenancy.user_tenant', 'User does not have tenant_id. Workspace bootstrap must complete before production use.');

    const workspaces: any[] = await svc.entities.AdiologyWorkspace.filter({ owner_user_id: user.id }).catch(() => []);
    const workspace = workspaces.find((w: any) => w.status === 'active') || workspaces[0] || null;
    if (workspace) pass('tenancy.workspace', 'Adiology workspace exists.', { workspace_id: workspace.id, tenant_id: workspace.tenant_id });
    else fail('tenancy.workspace', 'No AdiologyWorkspace exists for this account.');

    if (workspace && tenantId && workspace.tenant_id === tenantId) pass('tenancy.workspace_matches_user', 'Workspace tenant matches user tenant.');
    else if (workspace && tenantId) fail('tenancy.workspace_matches_user', 'Workspace tenant does not match user tenant.', { user_tenant: tenantId, workspace_tenant: workspace.tenant_id });

    let membership: any = null;
    let entitlement: any = null;
    if (workspace) {
      membership = (await svc.entities.AdiologyWorkspaceMember.filter({ workspace_id: workspace.id, user_id: user.id }).catch(() => []))[0] || null;
      entitlement = (await svc.entities.AdiologyEntitlement.filter({ workspace_id: workspace.id }).catch(() => []))[0] || null;
      if (membership?.status === 'active') pass('tenancy.membership', 'Active workspace membership found.', { role: membership.role });
      else fail('tenancy.membership', 'Active workspace membership is missing.');
      if (entitlement) pass('billing.entitlement', 'Workspace entitlement exists.', { plan: entitlement.plan_key, status: entitlement.status });
      else fail('billing.entitlement', 'Workspace entitlement is missing.');

      const hierarchyOk = Boolean(workspace.organization_id && workspace.project_id && workspace.application_id);
      if (hierarchyOk) pass('orchestral.hierarchy', 'Workspace is bound to Organization → Project → Application.', {
        organization_id: workspace.organization_id,
        project_id: workspace.project_id,
        application_id: workspace.application_id,
      });
      else fail('orchestral.hierarchy', 'Workspace is missing one or more Orchestral hierarchy bindings.');
    }

    const adiologyModule = ModuleRegistry.get('adiology');
    const orchestrationModule = ModuleRegistry.get('ai_orchestration');
    if (adiologyModule?.available) pass('kernel.adiology_module', 'Adiology is registered as an available platform module.', { version: adiologyModule.version });
    else fail('kernel.adiology_module', 'Adiology module is not registered/available.');
    if (orchestrationModule?.available) pass('kernel.ai_orchestration', 'Shared AI Orchestration Engine is registered and available.', { version: orchestrationModule.version });
    else fail('kernel.ai_orchestration', 'AI Orchestration Engine is not available.');

    const templates = await svc.entities.PlanTemplate.filter({ active: true }).catch(() => []);
    if ((templates || []).length > 0) pass('orchestral.templates', 'At least one active workflow template exists.', { count: templates.length });
    else warn('orchestral.templates', 'No active workflow templates found. Adiology AI workflows should be seeded before enabling autonomous features.');

    const migration = (await svc.entities.AdiologyMigrationState.filter({}).catch(() => []))[0] || null;
    if (migration) pass('migration.state', 'Migration state is persisted.', { phase: migration.phase, status: migration.status, source_commit: migration.source_commit });
    else warn('migration.state', 'No AdiologyMigrationState row found.');

    const legacyTaskProjects: any[] = await svc.entities.AdiologyTaskProject.filter({}).catch(() => []);
    const legacyTasks: any[] = await svc.entities.AdiologyTask.filter({}).catch(() => []);
    const legacyDomains: any[] = await svc.entities.AdiologyMonitoredDomain.filter({}).catch(() => []);
    const unscoped = [...legacyTaskProjects, ...legacyTasks, ...legacyDomains].filter((r: any) => !r.tenant_id || !r.workspace_id).length;
    if (unscoped === 0) pass('tenancy.legacy_rows', 'Migrated Adiology rows are workspace-scoped.');
    else warn('tenancy.legacy_rows', `${unscoped} legacy Adiology row(s) are missing tenant/workspace scope and require backfill before team sharing is enabled.`, { unscoped });

    if (body.require_billing !== false) {
      if (!entitlement || !['active', 'trialing'].includes(entitlement.status)) {
        fail('billing.active', 'Billing entitlement is not active/trialing.', { status: entitlement?.status || 'missing' });
      } else {
        pass('billing.state', 'Billing entitlement is active/trialing.', { status: entitlement.status });
      }
      // This remains a launch blocker until Stripe checkout/webhooks are owned by Base44.
      if (entitlement?.source === 'stripe' && entitlement?.external_customer_id) {
        pass('billing.secure_backend', 'Stripe-backed entitlement is reconciled to this workspace.', { customer_id_present: true });
      } else {
        fail('billing.secure_backend', 'Secure Base44-owned Stripe checkout/webhook reconciliation is not active yet. Checkout remains fail-closed.');
      }
    }

    if (body.require_google_ads !== false && workspace) {
      const googleAccounts: any[] = await svc.entities.AdiologyGoogleAdsAccount.filter({ workspace_id: workspace.id }).catch(() => []);
      const connectedGoogle = googleAccounts.find((a: any) => a.status === 'connected');
      if (connectedGoogle) pass('google_ads.connection', 'A workspace-scoped Google Ads account is connected.', { customer_id: connectedGoogle.customer_id });
      else fail('google_ads.connection', 'No connected Google Ads account exists for this workspace. Native Google Ads connector authorization is required before production publishing.');
    }

    const blockerCount = checks.filter(c => c.status === 'fail' && c.blocker).length;
    const warningCount = checks.filter(c => c.status === 'warn').length;
    const passed = checks.filter(c => c.status === 'pass').length;
    const score = Math.round((passed / Math.max(checks.length, 1)) * 100);
    const status = blockerCount > 0 ? 'red' : warningCount > 0 ? 'yellow' : 'green';

    const certification = await svc.entities.ProductionCertification.create({
      tenant_id: tenantId || workspace?.tenant_id || 'uninitialized',
      workspace_id: workspace?.id || '',
      version: 'adiology.production.v1',
      source_commit: body.source_commit || '',
      status,
      score,
      blocker_count: blockerCount,
      warning_count: warningCount,
      checks,
      summary: { passed, total: checks.length, module: 'adiology' },
      started_at: startedAt,
      completed_at: now(),
      run_by: user.email || user.id,
    });

    return Response.json({ status, score, blocker_count: blockerCount, warning_count: warningCount, checks, certification_id: certification.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
