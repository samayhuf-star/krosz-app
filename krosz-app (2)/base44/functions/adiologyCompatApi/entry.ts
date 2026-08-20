import { createClientFromRequest } from "npm:@base44/sdk@0.8.42";

const LEGACY_ORIGIN = 'https://adiology.io';
const now = () => new Date().toISOString();

function cleanUndefined(input: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function resolveWorkspace(svc: any, user: any, requestedWorkspaceId?: string, requestedTenantId?: string) {
  let membership: any = null;
  let workspace: any = null;

  if (requestedWorkspaceId) {
    membership = (await svc.entities.AdiologyWorkspaceMember.filter({ workspace_id: requestedWorkspaceId, user_id: user.id }).catch(() => []))
      .find((m: any) => m.status === 'active') || null;
    if (!membership && user.role !== 'admin') throw Object.assign(new Error('Workspace access denied'), { status: 403 });
    workspace = await svc.entities.AdiologyWorkspace.get(requestedWorkspaceId).catch(() => null);
  }

  if (!workspace) {
    const memberships: any[] = await svc.entities.AdiologyWorkspaceMember.filter({ user_id: user.id }).catch(() => []);
    membership = memberships.find((m: any) => m.status === 'active') || null;
    if (membership) workspace = await svc.entities.AdiologyWorkspace.get(membership.workspace_id).catch(() => null);
  }

  if (!workspace) {
    const owned: any[] = await svc.entities.AdiologyWorkspace.filter({ owner_user_id: user.id }).catch(() => []);
    workspace = owned.find((w: any) => w.status === 'active') || owned[0] || null;
  }

  if (!workspace) throw Object.assign(new Error('Workspace not initialized'), { status: 409 });
  if (requestedTenantId && requestedTenantId !== workspace.tenant_id && user.role !== 'admin') {
    throw Object.assign(new Error('Tenant mismatch'), { status: 403 });
  }
  return { workspace, membership };
}

async function legacyLookup(pathname: string, search: string) {
  const allowed = new Set([
    '/api/domains/lookup/whois',
    '/api/domains/lookup/ssl',
    '/api/domains/lookup/dns',
  ]);
  if (!allowed.has(pathname)) throw Object.assign(new Error('Unsupported lookup'), { status: 404 });
  const res = await fetch(`${LEGACY_ORIGIN}${pathname}${search}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { payload = { error: text || res.statusText }; }
  if (!res.ok) throw Object.assign(new Error(payload?.error || `Lookup failed (${res.status})`), { status: res.status });
  return payload;
}

async function refreshDomain(svc: any, domainRow: any) {
  const domain = domainRow.domain;
  const [whois, ssl, dns] = await Promise.all([
    legacyLookup('/api/domains/lookup/whois', `?domain=${encodeURIComponent(domain)}`).catch(() => null),
    legacyLookup('/api/domains/lookup/ssl', `?domain=${encodeURIComponent(domain)}`).catch(() => null),
    legacyLookup('/api/domains/lookup/dns', `?domain=${encodeURIComponent(domain)}`).catch(() => null),
  ]);
  const patch: any = {
    whoisData: whois || domainRow.whoisData || {},
    sslData: ssl || domainRow.sslData || {},
    dnsRecords: dns || domainRow.dnsRecords || {},
    registrar: whois?.registrar || domainRow.registrar,
    expiryDate: whois?.expiryDate || whois?.expirationDate || domainRow.expiryDate,
    createdDate: whois?.createdDate || whois?.creationDate || domainRow.createdDate,
    updatedDate: whois?.updatedDate || domainRow.updatedDate,
    nameServers: whois?.nameServers || domainRow.nameServers || [],
    sslIssuer: ssl?.issuer || domainRow.sslIssuer,
    sslExpiryDate: ssl?.expiryDate || ssl?.validTo || domainRow.sslExpiryDate,
    sslValidFrom: ssl?.validFrom || domainRow.sslValidFrom,
    lastCheckedAt: now(),
  };
  return svc.entities.AdiologyMonitoredDomain.update(domainRow.id, cleanUndefined(patch));
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user: any = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc: any = base44.asServiceRole;
    const input = await req.json().catch(() => ({}));
    const method = String(input.method || 'GET').toUpperCase();
    const url = new URL(String(input.path || '/api/'), 'https://adiology.local');
    const path = url.pathname;
    const body = input.body || {};

    const { workspace } = await resolveWorkspace(svc, user, input.workspace_id, input.tenant_id);
    const scope = { tenant_id: workspace.tenant_id, workspace_id: workspace.id };

    if (path.startsWith('/api/domains/lookup/')) {
      return Response.json(await legacyLookup(path, url.search));
    }

    // Projects
    if (path === '/api/projects' && method === 'GET') {
      const rows = await svc.entities.AdiologyTaskProject.filter(scope).catch(() => []);
      return Response.json({ data: rows });
    }
    if (path === '/api/projects' && method === 'POST') {
      const row = await svc.entities.AdiologyTaskProject.create({ ...scope, name: body.name, color: body.color || '#6366f1', order: Number(body.order || 0) });
      return Response.json(row);
    }
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const id = projectMatch[1];
      const row: any = await svc.entities.AdiologyTaskProject.get(id).catch(() => null);
      if (!row || row.tenant_id !== scope.tenant_id || row.workspace_id !== scope.workspace_id) return Response.json({ error: 'Project not found' }, { status: 404 });
      if (method === 'PUT') return Response.json(await svc.entities.AdiologyTaskProject.update(id, cleanUndefined({ name: body.name, color: body.color, order: body.order })));
      if (method === 'DELETE') {
        const tasks: any[] = await svc.entities.AdiologyTask.filter({ ...scope, projectId: id }).catch(() => []);
        for (const task of tasks) await svc.entities.AdiologyTask.update(task.id, { projectId: null });
        await svc.entities.AdiologyTaskProject.delete(id);
        return Response.json({ success: true });
      }
    }

    // Tasks
    if (path === '/api/tasks' && method === 'GET') {
      const rows = await svc.entities.AdiologyTask.filter(scope).catch(() => []);
      return Response.json({ data: rows });
    }
    if (path === '/api/tasks' && method === 'POST') {
      const row = await svc.entities.AdiologyTask.create({
        ...scope,
        projectId: body.projectId || null,
        title: body.title,
        description: body.description || '',
        isToday: Boolean(body.isToday),
        isCompleted: Boolean(body.isCompleted),
        priority: body.priority || 'medium',
        dueDate: body.dueDate || null,
        order: Number(body.order || 0),
        completedAt: body.completedAt || null,
      });
      return Response.json(row);
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      const row: any = await svc.entities.AdiologyTask.get(id).catch(() => null);
      if (!row || row.tenant_id !== scope.tenant_id || row.workspace_id !== scope.workspace_id) return Response.json({ error: 'Task not found' }, { status: 404 });
      if (method === 'PUT') return Response.json(await svc.entities.AdiologyTask.update(id, cleanUndefined({
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        isToday: body.isToday,
        isCompleted: body.isCompleted,
        priority: body.priority,
        dueDate: body.dueDate,
        order: body.order,
        completedAt: body.completedAt,
      })));
      if (method === 'DELETE') {
        await svc.entities.AdiologyTask.delete(id);
        return Response.json({ success: true });
      }
    }

    // Domains
    if (path === '/api/domains' && method === 'GET') {
      const rows = await svc.entities.AdiologyMonitoredDomain.filter(scope).catch(() => []);
      return Response.json(rows);
    }
    if (path === '/api/domains' && method === 'POST') {
      const normalized = String(body.domain || '').trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      if (!normalized || !normalized.includes('.')) return Response.json({ error: 'Enter a valid domain name' }, { status: 400 });
      const existing: any[] = await svc.entities.AdiologyMonitoredDomain.filter({ ...scope, domain: normalized }).catch(() => []);
      if (existing[0]) return Response.json(existing[0]);
      let row = await svc.entities.AdiologyMonitoredDomain.create({
        ...scope,
        domain: normalized,
        alertEmail: body.alertEmail || user.email || '',
        notes: body.notes || '',
        alertsEnabled: body.alertsEnabled !== false,
        alertDays: body.alertDays || [30, 14, 7, 3, 1],
        status: 'active',
        lastCheckedAt: now(),
      });
      row = await refreshDomain(svc, row).catch(() => row);
      return Response.json(row);
    }
    const refreshMatch = path.match(/^\/api\/domains\/([^/]+)\/refresh$/);
    if (refreshMatch && method === 'POST') {
      const row: any = await svc.entities.AdiologyMonitoredDomain.get(refreshMatch[1]).catch(() => null);
      if (!row || row.tenant_id !== scope.tenant_id || row.workspace_id !== scope.workspace_id) return Response.json({ error: 'Domain not found' }, { status: 404 });
      return Response.json(await refreshDomain(svc, row));
    }
    const domainMatch = path.match(/^\/api\/domains\/([^/]+)$/);
    if (domainMatch) {
      const id = domainMatch[1];
      const row: any = await svc.entities.AdiologyMonitoredDomain.get(id).catch(() => null);
      if (!row || row.tenant_id !== scope.tenant_id || row.workspace_id !== scope.workspace_id) return Response.json({ error: 'Domain not found' }, { status: 404 });
      if (method === 'PUT') return Response.json(await svc.entities.AdiologyMonitoredDomain.update(id, cleanUndefined({
        alertEmail: body.alertEmail,
        alertsEnabled: body.alertsEnabled,
        alertDays: body.alertDays,
        notes: body.notes,
        status: body.status,
      })));
      if (method === 'DELETE') {
        await svc.entities.AdiologyMonitoredDomain.delete(id);
        return Response.json({ success: true });
      }
    }

    if (path === '/api/domains/email-report') {
      return Response.json({ error: 'Domain email reports are being migrated to the Base44 communication service.' }, { status: 501 });
    }

    return Response.json({ error: `Unsupported compatibility route: ${method} ${path}` }, { status: 404 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: error?.status || 500 });
  }
}
