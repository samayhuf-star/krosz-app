// Worldz Visa (Phase 33) — Provider Execution & Integration API.
// Focused backend for the execution layer: route resolution, idempotent
// execution attempts, provider webhook ingestion, and health checks. The Case
// Engine remains the sole authority for application lifecycle (\u00a715); this layer
// routes, records, and threads results back via CaseEvents. Provider secrets are
// never stored or returned (\u00a739). Admin-only.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  resolveExecutionRoute, providerInventoryRow, travelerRouteProjection,
  type RouteInput,
} from "../../shared/visa/execution/router.ts";
import {
  startAttempt, markRunning, markSucceeded, markFailed, markWaiting, markCancelled, listAttempts,
} from "../../shared/visa/execution/attemptStore.ts";
import { ingestWebhook, authenticateWebhook, normalizeWebhookStatus } from "../../shared/visa/execution/webhook.ts";
import { evaluateHealth, aggregateHealth } from "../../shared/visa/execution/health.ts";
import { classifyError, circuitState, shouldRetry, MAX_RETRIES } from "../../shared/visa/execution/retry.ts";

function assertAdmin(user: any) {
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
  return null;
}

async function loadRouteContext(svc: any, country: string, journey: string, nationality = "IN") {
  const caps = await svc.entities.CountryCapability.filter({ country_code: country, nationality, journey_type: journey }, "-rule_version", 10).catch(() => []);
  const cap = caps[0] || null;
  const bindings = cap ? await svc.entities.CountryProviderBinding.filter({ country_code: country, journey_type: cap.journey_type }, "-fallback_order", 50).catch(() => []) : [];
  const keys: string[] = Array.from(new Set(bindings.map((b) => b.provider_key).filter(Boolean))) as string[];
  const providers: Record<string, any> = {};
  for (const k of keys) {
    const r = await svc.entities.Provider.filter({ key: k }).catch(() => []);
    if (r[0]) providers[k] = { ...r[0], adapter_config: undefined };
  }
  const provKeys = Object.keys(providers);
  const connections: any[] = provKeys.length ? await svc.entities.ProviderConnection.filter({}).catch(() => []).then((all: any[]) => all.filter((c) => provKeys.includes(c.provider_key))) : [];
  const portals = await svc.entities.PortalDefinition.filter({ country, status: "ACTIVE" }).catch(() => []);
  return { cap, bindings, providers, connections, portals };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const user = await base44.auth.me().catch(() => null);
    const svc = base44.asServiceRole;

    // ---------- exec-route: resolve execution route for a case or country/journey ----------
    if (action === "exec-route") {
      const denied = assertAdmin(user);
      if (denied) return denied;
      let country: string = body.country, journey: string = body.journey, nationality: string = body.nationality || "IN";
      let execution_capability: any = body.execution_capability, case_route_status: any = body.case_route_status;
      let app: any = null;
      if (body.case_id) {
        app = await svc.entities.VisaApplication.get(body.case_id).catch(() => null);
        if (!app) return Response.json({ error: "case not found" }, { status: 404 });
        country = app.destination; nationality = app.nationality || "IN";
        journey = app.visa_type_key; execution_capability = app.execution_capability; case_route_status = app.route_status;
      }
      if (!country || !journey) return Response.json({ error: "country and journey (or case_id) required" }, { status: 400 });
      const ctx = await loadRouteContext(svc, country, journey, nationality);
      const input: RouteInput = {
        country, nationality, journey, purpose: body.purpose || app?.purpose,
        execution_capability: execution_capability || "UNKNOWN", case_route_status,
        bindings: ctx.bindings, providers: ctx.providers, connections: ctx.connections, portals: ctx.portals,
        environment: body.environment || "PRODUCTION", requested_operation: body.operation || "SUBMISSION",
      };
      const route = resolveExecutionRoute(input);
      return Response.json({ route, traveler_view: travelerRouteProjection(route), capability: ctx.cap ? { verification_status: ctx.cap.verification_status, journey_type: ctx.cap.journey_type, execution_capability: ctx.cap.execution_capability } : null });
    }

    // ---------- exec-attempt-* — idempotent execution attempts ----------
    if (action === "exec-attempt-start") {
      const denied = assertAdmin(user); if (denied) return denied;
      if (!body.case_id || !body.operation || !body.provider_binding_id) return Response.json({ error: "case_id, provider_binding_id, operation required" }, { status: 400 });
      const app = await svc.entities.VisaApplication.get(body.case_id).catch(() => null);
      if (!app) return Response.json({ error: "case not found" }, { status: 404 });
      const out = await startAttempt(svc, {
        case_id: app.id, application_id: app.id, traveler_id: app.traveler_id, organization_id: app.organization_id,
        provider_key: body.provider_key, provider_id: body.provider_id, provider_binding_id: body.provider_binding_id,
        route_type: body.route_type || "PROVIDER_API", operation: body.operation, environment: body.environment || "PRODUCTION",
        capabilities: body.capabilities || null, request_reference: body.request_reference, fallback_from_attempt_id: body.fallback_from_attempt_id,
      });
      return Response.json(out);
    }
    if (action === "exec-attempt-succeed") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json(await markSucceeded(svc, body.attempt_id, { provider_application_id: body.provider_application_id, response_reference: body.response_reference, metadata: body.metadata }));
    }
    if (action === "exec-attempt-fail") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json(await markFailed(svc, body.attempt_id, { error_code: body.error_code, error_message: body.error_message, status: body.status }));
    }
    if (action === "exec-attempt-waiting") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json(await markWaiting(svc, body.attempt_id, body.reason));
    }
    if (action === "exec-attempt-cancel") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json(await markCancelled(svc, body.attempt_id));
    }
    if (action === "exec-attempt-list") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json({ attempts: await listAttempts(svc, body.case_id) });
    }

    // ---------- webhook-ingest: provider status webhook ----------
    if (action === "webhook-ingest") {
      // Webhooks are system-to-system; require admin to dispatch (or a verified
      // provider signature in production). Here admin dispatches a verified webhook.
      const denied = assertAdmin(user); if (denied) return denied;
      if (!body.provider_key || !body.raw_status || !body.idempotency_key) return Response.json({ error: "provider_key, raw_status, idempotency_key required" }, { status: 400 });
      const out = await ingestWebhook(svc, {
        provider_key: body.provider_key, raw_status: body.raw_status, idempotency_key: body.idempotency_key,
        signature: body.signature, provider_application_id: body.provider_application_id, case_id: body.case_id,
        payload: body.payload, environment: body.environment,
      });
      return Response.json(out);
    }

    // ---------- health-check: provider health + circuit state ----------
    if (action === "health-check") {
      const denied = assertAdmin(user); if (denied) return denied;
      if (!body.provider_key) return Response.json({ error: "provider_key required" }, { status: 400 });
      const p: any[] = await svc.entities.Provider.filter({ key: body.provider_key }).catch(() => []);
      const provider = p[0];
      if (!provider) return Response.json({ error: "provider not found" }, { status: 404 });
      const conns: any[] = await svc.entities.ProviderConnection.filter({ provider_key: body.provider_key }).catch(() => []);
      const env = body.environment || "PRODUCTION";
      const connection = conns.find((c) => c.environment === env) || conns[0] || null;
      // Adapter health invocation stays optional; the pure evaluation classifies
      // the provider/connection fields honestly without implying submission capability.
      const result = evaluateHealth({ provider, connection, adapterHealth: body.adapter_health || null });
      return Response.json({ ...result, circuit: circuitState(provider, connection) });
    }

    // ---------- provider-inventory: capability inventory (\u00a72/\u00a735) ----------
    if (action === "provider-inventory") {
      const denied = assertAdmin(user); if (denied) return denied;
      const providers: any[] = await svc.entities.Provider.list("-created_date", 200).catch(() => []);
      const rows: any[] = [];
      const healthRows: any[] = [];
      for (const p of providers) {
        const conns: any[] = await svc.entities.ProviderConnection.filter({ provider_key: p.key }).catch(() => []);
        const conn = conns.find((c) => c.environment === "PRODUCTION") || conns[0] || null;
        rows.push(providerInventoryRow(p, conn));
        healthRows.push(evaluateHealth({ provider: p, connection: conn, adapterHealth: null }));
      }
      return Response.json({ inventory: rows, health_aggregate: aggregateHealth(healthRows) });
    }

    // ---------- retry-classify: pure helper for operators ----------
    if (action === "retry-classify") {
      const denied = assertAdmin(user); if (denied) return denied;
      return Response.json({
        category: classifyError(body.error_code, body.status),
        retry: shouldRetry({ retry_count: body.retry_count || 0, status: body.status_name || "FAILED" }, body.error_code, body.status),
        max_retries: MAX_RETRIES,
      });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || "internal error" }, { status: 500 });
  }
}