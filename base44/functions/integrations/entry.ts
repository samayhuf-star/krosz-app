// Universal Integration Platform — HTTP entry point.
//
// Every external system connects through ONE common architecture:
//   Integration → Connection → Auth → Sync → Knowledge Graph → Workflow → AI
// Business modules never call external APIs directly. They install a connector,
// and the sync pipeline moves external data into the Knowledge Graph and emits
// observations the AI Executives already consume. Webhook events may trigger
// the existing Workflow Engine.
//
// Actions:
//   list-catalog | install-connector | list-connectors | get-connector |
//   Configure/reconnect = set-config | enable | disable |
//   sync-now | scheduled-sync | process-webhook | sync-history | delete

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { listCatalog, getDefinition } from "../../shared/integrations/registry.ts";
import { upsertExternalNodes, emitObservation } from "../../shared/integrations/sync.ts";
import { defineTemplate, launchRun } from "../../shared/operations/engine.ts";

const AUTONOMOUS = new Set(["scheduled-sync", "process-webhook"]);
const VALID_GOAL_TYPES = new Set(["generate_blueprint", "generate_website", "generate_seo", "generate_crm", "activate_marketing", "configure_domain", "approval_gate"]);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    if (user.role !== "admin" && AUTONOMOUS.has(action)) {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }
    const svc = base44.asServiceRole;
    const rd = user ? base44 : svc;
    const actor = (user && (user.full_name || user.email)) || (user && user.id) || "integration";

    if (action === "list-catalog") return Response.json({ connectors: listCatalog() });
    if (action === "install-connector") return Response.json(await installConnector(svc, body, user, actor));
    if (action === "list-connectors") return Response.json(await listConnectors(rd, body, user));
    if (action === "get-connector") return Response.json(await getConnector(rd, body, user));
    if (action === "set-config") return Response.json(await setConfig(svc, body, user, actor));
    if (action === "set-auth") return Response.json(await setAuth(svc, body, user, actor));
    if (action === "enable") return Response.json(await setStatusChoice(svc, body, user, "connected"));
    if (action === "disable") return Response.json(await setStatusChoice(svc, body, user, "disabled"));
    if (action === "reconnect") return Response.json(await reconnect(svc, body, user, actor));
    if (action === "sync-now") return Response.json(await syncNow(svc, body, user, actor));
    if (action === "scheduled-sync") return Response.json(await scheduledSync(svc, actor));
    if (action === "process-webhook") return Response.json(await processWebhook(svc, body, actor));
    if (action === "sync-history") return Response.json(await syncHistory(rd, body, user));
    if (action === "delete") return Response.json(await deleteConnector(svc, body, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

async function verifyTenant(svc: any, businessId: string, user: any): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  if (user && user.data && business.tenant_id && user.data.tenant_id && user.data.tenant_id !== business.tenant_id) {
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
  return business;
}

async function installConnector(svc: any, body: any, user: any, actor: string): Promise<any> {
  const business = await verifyTenant(svc, data_orThrow(body.business_id), user);
  const def = getDefinition(body.definition_key);
  if (!def) throw Object.assign(new Error(`Unknown connector: ${body.definition_key}`), { code: "BAD_CONNECTOR" });
  if (!def.installable) throw Object.assign(new Error(`${def.name} is not installable`), { code: "NOT_INSTALLABLE" });
  const existing: any[] = await svc.entities.IntegrationConnector.filter({ business_id: business.id, definition_key: def.key }).catch(() => []);
  if (existing && existing.length) return { connector: existing[0], already_installed: true };
  const connector: any = await svc.entities.IntegrationConnector.create({
    tenant_id: business.tenant_id, business_id: business.id, definition_key: def.key,
    name: body.name || def.name, category: def.category, status: "unconfigured",
    auth: { type: def.auth_type, status: def.auth_type === "none" || def.auth_type === "webhook" ? "connected" : "not_started", scopes: [] },
    health: { state: "unknown", consecutive_failures: 0 },
    sync: { strategy: body.sync_strategy || def.default_sync_strategy, schedule_cron: body.schedule_cron || "", status: "idle" },
    rate_limits: {}, retry_policy: { max_retries: 3, backoff_ms: 1000, fallback_enabled: true },
    capabilities: def.capabilities, supported_objects: def.supported_objects.map((o) => o.object),
    permission_scope: [], version: def.version, config: body.config || {}, webhook_secret: body.webhook_secret || randSecret(),
    installed_by: actor,
  });
  return { connector };
}

async function listConnectors(rd: any, body: any, user: any): Promise<any> {
  if (!body.business_id) return Response.json({ error: "business_id is required" } as any, { status: 400 }) as any;
  await verifyTenant(rd, body.business_id, user).catch(() => null);
  const rows: any[] = await rd.entities.IntegrationConnector.filter({ business_id: body.business_id }, "-created_date", 100).catch(() => []);
  return { connectors: rows || [] };
}

async function getConnector(rd: any, body: any, user: any): Promise<any> {
  const rows: any[] = await rd.entities.IntegrationConnector.filter({ id: body.connector_id }).catch(() => []);
  const c = (rows || [])[0];
  if (!c) throw Object.assign(new Error("Connector not found"), { code: "NOT_FOUND" });
  if (user && user.data && c.tenant_id && user.data.tenant_id && user.data.tenant_id !== c.tenant_id) {
    if (user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
  return { connector: c };
}

async function setConfig(svc: any, body: any, user: any, actor: string): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  const update: any = { config: { ...(c.config || {}), ...(body.config || {}) } };
  if (body.sync_strategy) update.sync = { ...(c.sync || {}), strategy: body.sync_strategy };
  if (body.schedule_cron !== undefined) update.sync = { ...(update.sync || c.sync || {}), schedule_cron: body.schedule_cron };
  if (body.webhook_secret) update.webhook_secret = body.webhook_secret;
  await svc.entities.IntegrationConnector.update(c.id, update);
  return { connector: await svc.entities.IntegrationConnector.get(c.id) };
}

async function setAuth(svc: any, body: any, user: any, actor: string): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  const auth = { ...(c.auth || {}), ...(body.auth || {}), last_verified_at: new Date().toISOString() };
  let status = c.status;
  if (auth.status === "connected") status = "connected"; else if (auth.status === "error") status = "error";
  await svc.entities.IntegrationConnector.update(c.id, { auth, status });
  return { connector: await svc.entities.IntegrationConnector.get(c.id) };
}

async function setStatusChoice(svc: any, body: any, user: any, status: string): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  await svc.entities.IntegrationConnector.update(c.id, { status });
  return { connector: await svc.entities.IntegrationConnector.get(c.id), status };
}

async function reconnect(svc: any, body: any, user: any, actor: string): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  const auth = { ...(c.auth || {}), status: "pending", last_verified_at: new Date().toISOString() };
  await svc.entities.IntegrationConnector.update(c.id, { auth, status: "connecting", health: { state: "unknown", consecutive_failures: 0 } });
  return { connector: await svc.entities.IntegrationConnector.get(c.id), reconnect_url: `oauth:${c.definition_key}` };
}

async function syncNow(svc: any, body: any, user: any, actor: string): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  return await runManualSync(svc, c, actor);
}

// Manual/scheduled sync without a registered fetcher is an architecture no-op:
// it records a SyncRun proving the pipeline works. Real fetchers (per connector
// key) are wired in follow-on phases; the webhook path is fully live today.
async function runManualSync(svc: any, connector: any, actor: string): Promise<any> {
  const t0 = Date.now(); const iso = new Date().toISOString();
  const run: any = await svc.entities.SyncRun.create({
    tenant_id: connector.tenant_id, business_id: connector.business_id, connector_id: connector.id,
    definition_key: connector.definition_key, kind: "manual", trigger: "user", status: "running",
    started_at: iso, actor,
  });
  const def = getDefinition(connector.definition_key);
  const fetcherRegistered = FETCHERS[connector.definition_key];
  let objects_synced: any = {}, errors: any[] = [];
  try {
    if (fetcherRegistered) {
      const res = await fetcherRegistered(svc, connector).catch((e: any) => { errors.push({ code: "FETCH_FAILED", message: e?.message || String(e) }); return null; });
      if (res?.nodes?.length) {
        const business: any = await svc.entities.Business.get(connector.business_id);
        await upsertExternalNodes(svc, business, connector.definition_key, res.nodes, connector.id);
        objects_synced = { [res.object_type || "record"]: { count: res.nodes.length, created: res.nodes.length } };
      }
    }
    const status = errors.length ? "failed" : "completed";
    await svc.entities.SyncRun.update(run.id, { status, completed_at: new Date().toISOString(), duration_ms: Date.now() - t0, objects_synced, errors });
    await svc.entities.IntegrationConnector.update(connector.id, { "sync.last_sync_at": iso, sync: { ...(connector.sync || {}), last_sync_at: iso, last_run_id: run.id, status: errors.length ? "error" : "idle" }, health: { state: errors.length ? "degraded" : "healthy", last_checked_at: iso, consecutive_failures: errors.length } });
    return { sync_run_id: run.id, status, objects_synced, fetcher_registered: !!fetcherRegistered, note: fetcherRegistered ? "" : "No fetcher registered for this connector key (architecture). Webhook path is live." };
  } catch (e: any) {
    await svc.entities.SyncRun.update(run.id, { status: "failed", completed_at: new Date().toISOString(), errors: [{ code: "SYNC_ERROR", message: e?.message || String(e) }] });
    return { sync_run_id: run.id, status: "failed", error: e?.message || String(e) };
  }
}

async function scheduledSync(svc: any, actor: string): Promise<any> {
  const all: any[] = await svc.entities.IntegrationConnector.filter({ status: "connected" }, "-created_date", 500).catch(() => []);
  const scheduled = (all || []).filter((c) => c.sync?.strategy === "scheduled" && c.sync?.schedule_cron);
  const results: any[] = [];
  for (const c of scheduled) results.push(await runManualSync(svc, c, actor).catch((e: any) => ({ connector_id: c.id, error: e?.message })));
  return { processed: scheduled.length, results };
}

// ---------------- WEBHOOK PIPELINE ----------------
async function processWebhook(svc: any, body: any, actor: string): Promise<any> {
  let connector: any;
  if (body.connector_id) {
    const rows: any[] = await svc.entities.IntegrationConnector.filter({ id: body.connector_id }).catch(() => []);
    connector = (rows || [])[0];
  } else if (body.business_id && body.definition_key) {
    const rows: any[] = await svc.entities.IntegrationConnector.filter({ business_id: body.business_id, definition_key: body.definition_key }).catch(() => []);
    connector = (rows || [])[0];
  }
  if (!connector) throw Object.assign(new Error("Connector not found"), { code: "NOT_FOUND" });
  if (connector.webhook_secret && body.webhook_secret !== connector.webhook_secret) {
    throw Object.assign(new Error("Invalid webhook secret"), { code: "UNAUTHORIZED" });
  }
  const business: any = await svc.entities.Business.get(connector.business_id).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const def = getDefinition(connector.definition_key);
  const event = body.event || body.event_type || "event";
  const payload = body.payload || body;
  const t0 = Date.now(); const iso = new Date().toISOString();
  const run: any = await svc.entities.SyncRun.create({
    tenant_id: connector.tenant_id, business_id: connector.business_id, connector_id: connector.id,
    definition_key: connector.definition_key, kind: "webhook", trigger: "webhook", status: "running",
    started_at: iso, webhook_event_id: payload.event_id || payload.id || randSecret(8), webhook_event_type: event,
    webhook_payload_summary: JSON.stringify(payload).slice(0, 240), actor,
  });
  try {
    // Map payload → KG nodes (generic shape: object_type + external_id + attributes).
    const object_type = payload.object_type || payload.type || (def?.supported_objects?.[0]?.object) || "event";
    const external_id = payload.external_id || payload.id || randSecret(8);
    const nodes = [{
      id: `${connector.definition_key}:${external_id}`, type: object_type, external_id,
      attributes: payload.attributes || { event, ...(payload.data || {}) },
    }];
    const kg = await upsertExternalNodes(svc, business, connector.definition_key, nodes, connector.id);

    // Emit observation into the existing Observation Engine.
    const sigKey = payload.signal_key || `${connector.definition_key}.${event}:${external_id}`;
    const severity = payload.severity || (event.includes("fail") || event.includes("error") || event.includes("abandon") ? "warning" : "info");
    const obsId = await emitObservation(svc, business, connector.definition_key, connector.category, severity, sigKey,
      payload.title || `${def?.name || connector.definition_key}: ${event}`, payload.detail || `External event ${event} from ${connector.definition_key}.`,
      { event, external_id, connector_id: connector.id, payload_summary: run.webhook_payload_summary });

    // Optional: webhook event → Workflow Engine run.
    let dispatchedRunId: string | null = null;
    const eventConfig = connector.config?.event_workflows?.[event];
    if (eventConfig && Array.isArray(eventConfig.tasks) && eventConfig.tasks.length) {
      const safe = sanitizeTasks(eventConfig.tasks);
      if (safe.length) {
        const templateId = `evt_${connector.id}_${slug(event)}`;
        await defineTemplate(svc, { templateId, name: `${def?.name || connector.name} · ${event}`, tasks: safe, tenant: business.tenant_id, lifecycleGoal: "operating" });
        const launched = await launchRun(svc, { businessId: business.id, templateId, goal: `event:${event}`, requestedBy: `integration:${actor}`, input: { connector_id: connector.id, event, external_id, observation_id: obsId } });
        dispatchedRunId = launched?.run?.id || null;
      }
    }

    await svc.entities.SyncRun.update(run.id, {
      status: "completed", completed_at: new Date().toISOString(), duration_ms: Date.now() - t0,
      objects_synced: { [object_type]: { count: nodes.length, created: kg.created, updated: kg.updated } },
      observation_id: obsId, triggered_run_id: dispatchedRunId,
    });
    await svc.entities.IntegrationConnector.update(connector.id, { last_webhook_at: iso, sync: { ...(connector.sync || {}), last_sync_at: iso, last_run_id: run.id, status: "idle" }, health: { state: "healthy", last_checked_at: iso, consecutive_failures: 0 } });
    return { sync_run_id: run.id, knowledge_graph: kg, observation_id: obsId, dispatched_run_id: dispatchedRunId, event };
  } catch (e: any) {
    await svc.entities.SyncRun.update(run.id, { status: "failed", completed_at: new Date().toISOString(), errors: [{ code: "WEBHOOK_FAILED", message: e?.message || String(e) }] });
    await svc.entities.IntegrationConnector.update(connector.id, { health: { state: "degraded", last_checked_at: new Date().toISOString(), last_error: e?.message || String(e), consecutive_failures: (connector.health?.consecutive_failures || 0) + 1 } });
    throw e;
  }
}

async function syncHistory(rd: any, body: any, user: any): Promise<any> {
  const filter: any = body.connector_id ? { connector_id: body.connector_id } : (body.business_id ? { business_id: body.business_id } : null);
  if (!filter) return { runs: [] };
  const rows: any[] = await rd.entities.SyncRun.filter(filter, "-started_at", 50).catch(() => []);
  return { runs: rows || [] };
}

async function deleteConnector(svc: any, body: any, user: any): Promise<any> {
  const c = await loadOwned(svc, body.connector_id, user);
  await svc.entities.IntegrationConnector.delete(c.id).catch(() => {});
  return { deleted: c.id };
}

// ---------------- HELPERS ----------------
async function loadOwned(svc: any, connectorId: string, user: any): Promise<any> {
  const rows: any[] = await svc.entities.IntegrationConnector.filter({ id: connectorId }).catch(() => []);
  const c = (rows || [])[0];
  if (!c) throw Object.assign(new Error("Connector not found"), { code: "NOT_FOUND" });
  if (user && user.data && c.tenant_id && user.data.tenant_id && user.data.tenant_id !== c.tenant_id && user.role !== "admin") {
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
  return c;
}

// Per-connector fetcher registry. Phase 11 ships the webhook path live; fetchers
// for REST/poll connectors are registered here in follow-on phases.
const FETCHERS: Record<string, (svc: any, connector: any) => Promise<{ object_type: string; nodes: any[] }>> = {};

function data_orThrow(v: string): string {
  if (!v) throw Object.assign(new Error("business_id is required"), { code: "BUSINESS_REQUIRED" });
  return v;
}
function slug(s: string): string { return s.replace(/[^a-z0-9]+/gi, "_").toLowerCase(); }
function randSecret(len = 24): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = ""; for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function sanitizeTasks(tasks: any[]): any[] {
  const out: any[] = []; const keys = new Set<string>();
  for (const t of tasks || []) {
    if (!t || !t.key || !t.type || !VALID_GOAL_TYPES.has(t.type) || keys.has(t.key)) continue;
    keys.add(t.key);
    out.push({ key: t.key, type: t.type, depends_on: (t.depends_on || []).filter((d: string) => keys.has(d) && d !== t.key), needs_approval: !!t.needs_approval, capability: t.capability || undefined });
  }
  const all = new Set(out.map((o) => o.key));
  for (const o of out) o.depends_on = (o.depends_on || []).filter((d: string) => all.has(d) && d !== o.key);
  return out;
}