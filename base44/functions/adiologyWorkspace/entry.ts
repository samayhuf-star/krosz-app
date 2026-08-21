import { createClientFromRequest } from "npm:@base44/sdk@0.8.42";

const slugify = (value: string) => String(value || 'workspace')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'workspace';

const now = () => new Date().toISOString();

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user: any = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const svc: any = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'bootstrap';

    if (!['bootstrap', 'context'].includes(action)) {
      return Response.json({ error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const existingWorkspaces: any[] = await svc.entities.AdiologyWorkspace.filter({ owner_user_id: user.id }).catch(() => []);
    let workspace = existingWorkspaces.find((w: any) => w.status !== 'archived') || existingWorkspaces[0] || null;

    if (!workspace && action === 'context') {
      return Response.json({ initialized: false, user: { id: user.id, email: user.email } });
    }

    if (!workspace) {
      const tenantSlug = `adio-${String(user.id).slice(-10).toLowerCase()}`;
      const displayName = body.workspace_name || user.company_name || user.full_name || (user.email ? String(user.email).split('@')[0] : 'My Workspace');
      const workspaceSlug = `${slugify(displayName)}-${String(user.id).slice(-6).toLowerCase()}`;

      let tenant = (await svc.entities.Tenant.filter({ slug: tenantSlug }).catch(() => []))[0];
      if (!tenant) {
        tenant = await svc.entities.Tenant.create({
          name: displayName,
          slug: tenantSlug,
          status: 'active',
          members: [user.id],
          plan: 'free',
        });
      }

      const tenantId = tenant.id;
      let organization = (await svc.entities.Organization.filter({ tenant_id: tenantId, slug: workspaceSlug }).catch(() => []))[0];
      if (!organization) {
        organization = await svc.entities.Organization.create({
          tenant_id: tenantId,
          name: displayName,
          slug: workspaceSlug,
          status: 'active',
          config: { product: 'adiology' },
        });
      }

      let project = (await svc.entities.Project.filter({ tenant_id: tenantId, organization_id: organization.id, slug: 'growth-os' }).catch(() => []))[0];
      if (!project) {
        project = await svc.entities.Project.create({
          tenant_id: tenantId,
          organization_id: organization.id,
          name: 'Adiology Growth OS',
          slug: 'growth-os',
          status: 'active',
          config: { product: 'adiology' },
        });
      }

      let application = (await svc.entities.Application.filter({ tenant_id: tenantId, project_id: project.id, slug: 'adiology' }).catch(() => []))[0];
      if (!application) {
        application = await svc.entities.Application.create({
          tenant_id: tenantId,
          organization_id: organization.id,
          project_id: project.id,
          name: 'Adiology',
          slug: 'adiology',
          kind: 'custom',
          status: 'active',
          config: {
            module: 'adiology',
            approvals: { money_spending: true, publish_ads: true },
            telemetry: { enabled: true },
          },
        });
      }

      workspace = await svc.entities.AdiologyWorkspace.create({
        tenant_id: tenantId,
        organization_id: organization.id,
        project_id: project.id,
        application_id: application.id,
        name: displayName,
        slug: workspaceSlug,
        status: 'active',
        plan: 'free',
        owner_user_id: user.id,
        settings: { timezone: body.timezone || 'Asia/Kolkata', currency: body.currency || 'USD' },
        limits: {},
        features: {},
        billing_state: { status: 'inactive' },
        onboarding_state: { completed: false, step: 'welcome' },
        orchestration_policy: {
          approval_required_for: ['money_spending', 'publish_google_ads', 'billing_change', 'delete_workspace'],
          max_retries: 3,
          fallback_enabled: true,
        },
      });

      await svc.entities.AdiologyWorkspaceMember.create({
        tenant_id: tenantId,
        workspace_id: workspace.id,
        user_id: user.id,
        email: user.email || '',
        role: 'owner',
        status: 'active',
        permissions: ['*'],
        joined_at: now(),
        last_active_at: now(),
      });

      await svc.entities.AdiologyEntitlement.create({
        tenant_id: tenantId,
        workspace_id: workspace.id,
        plan_key: 'free',
        status: 'active',
        features: ['keyword_planner', 'campaign_builder', 'domain_monitoring'],
        limits: { ai_runs_monthly: 50, monitored_domains: 5, workspaces: 1 },
        usage: {},
        source: 'base44',
        updated_at: now(),
      });

      // User.tenant_id is the shared RLS key used by the existing Orchestral core.
      await svc.entities.User.update(user.id, {
        tenant_id: tenantId,
        workspace_id: workspace.id,
        subscription_plan: user.subscription_plan || 'free',
        subscription_status: user.subscription_status || 'inactive',
      });

      await svc.entities.AdiologyAuditEvent.create({
        tenant_id: tenantId,
        workspace_id: workspace.id,
        actor_user_id: user.id,
        actor_role: 'owner',
        action: 'workspace.bootstrap',
        resource_type: 'AdiologyWorkspace',
        resource_id: workspace.id,
        risk: 'low',
        after: { tenant_id: tenantId, organization_id: organization.id, project_id: project.id, application_id: application.id },
        occurred_at: now(),
      });
    } else {
      await svc.entities.AdiologyWorkspaceMember.updateMany?.({ workspace_id: workspace.id, user_id: user.id }, { last_active_at: now() }).catch?.(() => null);
      if (!user.tenant_id || user.tenant_id !== workspace.tenant_id || user.workspace_id !== workspace.id) {
        await svc.entities.User.update(user.id, { tenant_id: workspace.tenant_id, workspace_id: workspace.id });
      }
    }

    const members = await svc.entities.AdiologyWorkspaceMember.filter({ workspace_id: workspace.id, user_id: user.id }).catch(() => []);
    const entitlement = (await svc.entities.AdiologyEntitlement.filter({ workspace_id: workspace.id }).catch(() => []))[0] || null;

    return Response.json({
      initialized: true,
      tenant_id: workspace.tenant_id,
      workspace,
      membership: members[0] || null,
      entitlement,
      orchestration: {
        organization_id: workspace.organization_id,
        project_id: workspace.project_id,
        application_id: workspace.application_id,
      },
    });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
