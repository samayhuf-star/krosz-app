import { createClientFromRequest } from "npm:@base44/sdk@0.8.42";

const now = () => new Date().toISOString();

async function context(svc: any, user: any, requestedWorkspaceId?: string) {
  const memberships: any[] = await svc.entities.AdiologyWorkspaceMember.filter({ user_id: user.id }).catch(() => []);
  let membership = requestedWorkspaceId
    ? memberships.find((m: any) => m.workspace_id === requestedWorkspaceId && m.status === 'active')
    : memberships.find((m: any) => m.status === 'active');
  let workspace = membership ? await svc.entities.AdiologyWorkspace.get(membership.workspace_id).catch(() => null) : null;
  if (!workspace) {
    const owned: any[] = await svc.entities.AdiologyWorkspace.filter({ owner_user_id: user.id }).catch(() => []);
    workspace = owned.find((w: any) => w.status === 'active') || owned[0] || null;
  }
  if (!workspace) throw Object.assign(new Error('Workspace not initialized'), { status: 409 });
  if (!membership && workspace.owner_user_id !== user.id && user.role !== 'admin') throw Object.assign(new Error('Workspace access denied'), { status: 403 });
  const tenantId = workspace.tenant_id;
  const entitlement = (await svc.entities.AdiologyEntitlement.filter({ workspace_id: workspace.id }).catch(() => []))[0] || null;
  return { workspace, membership, tenantId, entitlement };
}

function pathInfo(rawPath: string) {
  const u = new URL(rawPath, 'https://base44.local');
  return { pathname: u.pathname, search: u.searchParams };
}

async function audit(svc: any, c: any, user: any, action: string, resourceType: string, resourceId = '', metadata: any = {}, risk = 'low') {
  await svc.entities.AdiologyAuditEvent.create({
    tenant_id: c.tenantId,
    workspace_id: c.workspace.id,
    actor_user_id: user.id,
    actor_role: c.membership?.role || (c.workspace.owner_user_id === user.id ? 'owner' : user.role || 'member'),
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    risk,
    metadata,
    occurred_at: now(),
  }).catch(() => null);
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user: any = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc: any = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const method = String(body.method || 'GET').toUpperCase();
    const { pathname } = pathInfo(body.path || '/api');
    const payload = body.body || {};
    const c = await context(svc, user, body.workspace_id);

    // Billing is fail-closed until a Base44-owned Stripe secret + webhook reconciler exists.
    if (pathname === '/api/stripe/subscription' && method === 'GET') {
      return Response.json({
        subscription: c.entitlement ? {
          plan: c.entitlement.plan_key,
          status: c.entitlement.status,
          period_start: c.entitlement.period_start,
          period_end: c.entitlement.period_end,
          source: c.entitlement.source,
        } : { plan: 'free', status: 'trialing', source: 'base44' },
      });
    }
    if ((pathname === '/api/stripe/checkout' || pathname === '/api/stripe/portal') && method === 'POST') {
      await audit(svc, c, user, pathname.endsWith('checkout') ? 'billing.checkout_blocked' : 'billing.portal_blocked', 'billing', '', { reason: 'stripe_backend_not_configured' }, 'high');
      return Response.json({
        error: 'Billing is temporarily unavailable while the secure Base44 Stripe backend is being activated. No charge was attempted.',
        code: 'BILLING_NOT_CONFIGURED',
      }, { status: 503 });
    }

    // Google Ads connection/account status. Credentials/tokens never stored in entities.
    if (pathname === '/api/google-ads/auth/status' && method === 'GET') {
      const accounts: any[] = await svc.entities.AdiologyGoogleAdsAccount.filter({ workspace_id: c.workspace.id }).catch(() => []);
      const connected = accounts.some((a: any) => a.status === 'connected');
      return Response.json({ connected, configured: connected, accounts, connector: 'googleads' });
    }
    if ((pathname === '/api/google-ads/accounts' || pathname === '/api/google-ads/auth/accounts') && method === 'GET') {
      const accounts: any[] = await svc.entities.AdiologyGoogleAdsAccount.filter({ workspace_id: c.workspace.id }).catch(() => []);
      return Response.json({ accounts });
    }
    if (pathname === '/api/google-ads/link-account' && method === 'POST') {
      const customerId = String(payload.customerId || payload.customer_id || '').replace(/\D/g, '');
      if (!/^\d{10}$/.test(customerId)) return Response.json({ error: 'A valid 10-digit Google Ads customer ID is required.' }, { status: 400 });
      const existing: any[] = await svc.entities.AdiologyGoogleAdsAccount.filter({ workspace_id: c.workspace.id, customer_id: customerId }).catch(() => []);
      let account = existing[0];
      if (!account) account = await svc.entities.AdiologyGoogleAdsAccount.create({ tenant_id: c.tenantId, workspace_id: c.workspace.id, customer_id: customerId, descriptive_name: payload.name || `Google Ads ${customerId}`, status: 'pending', is_default: existing.length === 0, connector_key: 'googleads', metadata: { awaiting_connector_authorization: true } });
      await audit(svc, c, user, 'google_ads.account_link_requested', 'google_ads_account', account.id, { customer_id: customerId }, 'medium');
      return Response.json({ account, connected: false, requires_connector_authorization: true });
    }

    // Campaign persistence + history.
    if (pathname === '/api/campaigns/save' && method === 'POST') {
      const incoming = payload.campaign || payload;
      const name = String(incoming.name || incoming.campaignName || 'Untitled Campaign').trim();
      if (!name) return Response.json({ error: 'Campaign name is required.' }, { status: 400 });
      const idempotencyKey = String(incoming.idempotency_key || incoming.idempotencyKey || `${c.workspace.id}:${name}:${incoming.external_campaign_id || ''}`);
      const existing: any[] = await svc.entities.AdiologyCampaign.filter({ workspace_id: c.workspace.id, idempotency_key: idempotencyKey }).catch(() => []);
      let campaign: any;
      if (existing[0]) {
        const previous = existing[0];
        const version = Number(previous.version || 1) + 1;
        await svc.entities.AdiologyCampaignVersion.create({ tenant_id: c.tenantId, workspace_id: c.workspace.id, campaign_id: previous.id, version: Number(previous.version || 1), snapshot: previous, change_summary: 'Campaign updated', changed_by: user.id, source: 'manual', created_at: now() });
        campaign = await svc.entities.AdiologyCampaign.update(previous.id, { name, status: incoming.status || previous.status || 'draft', objective: incoming.objective, daily_budget_minor: incoming.daily_budget_minor, geo_targets: incoming.geo_targets, language_targets: incoming.language_targets, campaign_payload: incoming, validation: incoming.validation, source: incoming.source || previous.source || 'manual', version, last_error: null });
      } else {
        campaign = await svc.entities.AdiologyCampaign.create({ tenant_id: c.tenantId, workspace_id: c.workspace.id, google_ads_account_id: incoming.google_ads_account_id, external_campaign_id: incoming.external_campaign_id, name, status: incoming.status || 'draft', objective: incoming.objective, channel: incoming.channel || 'google_search', currency: incoming.currency, daily_budget_minor: incoming.daily_budget_minor, geo_targets: incoming.geo_targets || [], language_targets: incoming.language_targets || [], campaign_payload: incoming, validation: incoming.validation || {}, ai_analysis: incoming.ai_analysis || {}, approval: {}, idempotency_key: idempotencyKey, source: incoming.source || 'manual', version: 1 });
      }
      await audit(svc, c, user, 'campaign.saved', 'campaign', campaign.id, { name, version: campaign.version });
      return Response.json({ success: true, campaign, id: campaign.id });
    }
    if ((pathname === '/api/campaign-history' || pathname === '/api/campaigns') && method === 'GET') {
      const campaigns: any[] = await svc.entities.AdiologyCampaign.filter({ workspace_id: c.workspace.id }).catch(() => []);
      campaigns.sort((a: any, b: any) => String(b.updated_date || b.created_date || '').localeCompare(String(a.updated_date || a.created_date || '')));
      return Response.json({ campaigns, data: campaigns, history: campaigns });
    }
    if (pathname.startsWith('/api/campaign-history/') && method === 'GET') {
      const id = pathname.split('/').pop()!;
      const campaign = await svc.entities.AdiologyCampaign.get(id).catch(() => null);
      if (!campaign || campaign.workspace_id !== c.workspace.id) return Response.json({ error: 'Campaign not found' }, { status: 404 });
      const versions: any[] = await svc.entities.AdiologyCampaignVersion.filter({ campaign_id: id, workspace_id: c.workspace.id }).catch(() => []);
      return Response.json({ campaign, versions });
    }
    if (pathname.endsWith('/publish') && pathname.startsWith('/api/campaigns/') && method === 'POST') {
      const id = pathname.split('/')[3];
      const campaign = await svc.entities.AdiologyCampaign.get(id).catch(() => null);
      if (!campaign || campaign.workspace_id !== c.workspace.id) return Response.json({ error: 'Campaign not found' }, { status: 404 });
      const updated = await svc.entities.AdiologyCampaign.update(id, { status: 'approval_required', approval: { required: true, requested_by: user.id, requested_at: now(), reason: 'Publishing to Google Ads can spend money and requires explicit approval.' } });
      await audit(svc, c, user, 'campaign.publish_requested', 'campaign', id, { name: campaign.name }, 'critical');
      return Response.json({ campaign: updated, approval_required: true, published: false });
    }

    // Account profile/sync: Base44 User is authoritative; no password or auth secrets are accepted here.
    if ((pathname === '/api/user/profile' || pathname === '/api/user/sync') && method === 'GET') {
      return Response.json({ user, workspace: c.workspace, entitlement: c.entitlement });
    }
    if (pathname === '/api/user/profile' && ['PUT','PATCH','POST'].includes(method)) {
      const allowed: any = {};
      for (const key of ['full_name','name','company_name','job_title','industry','company_size','phone','website','country','bio']) {
        if (payload[key] !== undefined) allowed[key] = payload[key];
      }
      if (Object.keys(allowed).length) await svc.entities.User.update(user.id, allowed).catch(() => null);
      await audit(svc, c, user, 'profile.updated', 'user', user.id, { fields: Object.keys(allowed) });
      return Response.json({ success: true, user: { ...user, ...allowed } });
    }
    if (pathname === '/api/user/sync' && method === 'POST') {
      return Response.json({ success: true, user, workspace: c.workspace, entitlement: c.entitlement });
    }

    // Support tickets.
    if (pathname === '/api/support-tickets' && method === 'GET') {
      const tickets: any[] = await svc.entities.AdiologySupportTicket.filter({ workspace_id: c.workspace.id, requester_user_id: user.id }).catch(() => []);
      return Response.json({ tickets, data: tickets });
    }
    if (pathname === '/api/support-tickets' && method === 'POST') {
      const subject = String(payload.subject || payload.title || 'Support request').trim();
      const message = String(payload.message || payload.description || '').trim();
      const ticket = await svc.entities.AdiologySupportTicket.create({
        tenant_id: c.tenantId, workspace_id: c.workspace.id, requester_user_id: user.id,
        ticket_number: `ADIO-${Date.now().toString(36).toUpperCase()}`,
        category: payload.category || 'other', priority: payload.priority || 'normal', subject, message,
        status: 'open', metadata: payload.metadata || {},
      });
      await audit(svc, c, user, 'support.created', 'support_ticket', ticket.id, { category: ticket.category });
      return Response.json({ ticket, success: true });
    }
    if (pathname.startsWith('/api/support-tickets/') && method === 'GET') {
      const id = pathname.split('/').pop()!;
      const ticket = await svc.entities.AdiologySupportTicket.get(id).catch(() => null);
      if (!ticket || ticket.requester_user_id !== user.id) return Response.json({ error: 'Ticket not found' }, { status: 404 });
      return Response.json({ ticket });
    }

    // Feedback and client observability intake.
    if (pathname === '/api/feedback' && method === 'POST') {
      const feedback = await svc.entities.AdiologyFeedback.create({ tenant_id: c.tenantId, workspace_id: c.workspace.id, user_id: user.id, type: payload.type || 'general', rating: payload.rating, message: payload.message || payload.feedback || '', context: payload.context || {}, status: 'new', created_at: now() });
      return Response.json({ success: true, feedback });
    }
    if ((pathname === '/api/logs' || pathname === '/api/errors' || pathname === '/api/errors/report') && method === 'POST') {
      await svc.entities.AdiologyAuditEvent.create({ tenant_id: c.tenantId, workspace_id: c.workspace.id, actor_user_id: user.id, actor_role: c.membership?.role || 'member', action: pathname.includes('error') ? 'client.error' : 'client.log', resource_type: 'client_observability', risk: pathname.includes('error') ? 'medium' : 'low', metadata: { ...payload, received_at: now() }, occurred_at: now() }).catch(() => null);
      return Response.json({ success: true });
    }

    return Response.json({ error: `Unsupported SaaS API route: ${method} ${pathname}` }, { status: 404 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: error?.status || 500 });
  }
}
