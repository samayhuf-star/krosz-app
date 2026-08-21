import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

type Check = { id: string; area: string; status: "PASS" | "WARN" | "FAIL"; message: string; evidence?: any; severity?: "critical" | "high" | "medium" | "low" };

const MVP_COUNTRIES = ["AE", "VN", "ID"];

function add(checks: Check[], c: Check) { checks.push(c); }
function failCount(checks: Check[]) { return checks.filter((c) => c.status === "FAIL").length; }
function warnCount(checks: Check[]) { return checks.filter((c) => c.status === "WARN").length; }
function rootCauseFor(c: Check) {
  if (c.id.startsWith("price.currency") || c.id.startsWith("payment.currency")) return { area: "pricing", cause: "Non-INR monetary record is active in the India-first MVP", check_id: c.id };
  if (c.id.startsWith("country.")) return { area: "country_rule_pack", cause: "MVP country capability is missing, disabled, unpublished, unverified, or incomplete", check_id: c.id };
  if (c.id.startsWith("provider.")) return { area: "provider", cause: "Enabled production provider is not healthy/verified", check_id: c.id };
  if (c.id.startsWith("route.")) return { area: "routing", cause: "Public route did not return a successful HTTP response", check_id: c.id };
  return { area: c.area, cause: c.message, check_id: c.id };
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action || "latest";

    if (action === "latest" || action === "export-latest") {
      const rows = await svc.entities.QAReport.filter({}, "-created_date", 1).catch(() => []);
      const latest = rows?.[0] || null;
      if (action === "export-latest") return Response.json({ report: latest?.export_payload || null, meta: latest ? { id: latest.id, generated_at: latest.generated_at } : null });
      return Response.json({ report: latest });
    }

    if (action !== "run") return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

    const mode = ["LIGHT", "FULL", "REGRESSION"].includes(body.mode) ? body.mode : "LIGHT";
    const checks: Check[] = [];

    // 1) India-first MVP country packs: cheap deterministic database checks.
    for (const code of MVP_COUNTRIES) {
      const rows = await svc.entities.CountryCapability.filter({ country_code: code, nationality: "IN", departure_country: "IN", purpose: "tourism" }).catch(() => []);
      const enabled = rows.find((r: any) => r.mvp_enabled === true) || rows[0];
      add(checks, { id: `country.${code}.exists`, area: "country_rule_pack", status: enabled ? "PASS" : "FAIL", severity: "critical", message: enabled ? `${code} capability exists` : `${code} capability missing`, evidence: enabled ? { id: enabled.id } : {} });
      if (!enabled) continue;
      add(checks, { id: `country.${code}.mvp`, area: "country_rule_pack", status: enabled.mvp_enabled === true ? "PASS" : "FAIL", severity: "critical", message: enabled.mvp_enabled === true ? `${code} enabled for MVP` : `${code} is not enabled for MVP` });
      add(checks, { id: `country.${code}.verification`, area: "country_rule_pack", status: enabled.verification_status === "VERIFIED" ? "PASS" : "FAIL", severity: "high", message: `verification_status=${enabled.verification_status || "missing"}` });
      add(checks, { id: `country.${code}.source`, area: "country_rule_pack", status: enabled.source_url && enabled.source_count >= 1 ? "PASS" : "WARN", severity: "medium", message: enabled.source_url ? `source_count=${enabled.source_count || 0}` : "Official/source URL missing" });
      add(checks, { id: `country.${code}.execution`, area: "country_rule_pack", status: enabled.execution_capability && enabled.execution_capability !== "UNKNOWN" ? "PASS" : "FAIL", severity: "high", message: `execution_capability=${enabled.execution_capability || "missing"}` });
    }

    // 2) INR enforcement for active India-first pricing and payment records.
    const activePrices = await svc.entities.VisaPrice.filter({ status: "active" }).catch(() => []);
    const nonInrPrices = activePrices.filter((p: any) => String(p.currency || "").toUpperCase() !== "INR");
    add(checks, { id: "price.currency.active", area: "pricing", status: nonInrPrices.length ? "FAIL" : "PASS", severity: "critical", message: nonInrPrices.length ? `${nonInrPrices.length} active price rows are not INR` : "All active price rows use INR", evidence: nonInrPrices.slice(0, 20).map((p: any) => ({ id: p.id, product_id: p.product_id, currency: p.currency })) });

    const payments = await svc.entities.Payment.filter({}, "-created_date", 200).catch(() => []);
    const nonInrPayments = payments.filter((p: any) => String(p.currency || "").toUpperCase() !== "INR");
    add(checks, { id: "payment.currency.recent", area: "payments", status: nonInrPayments.length ? "FAIL" : "PASS", severity: "high", message: nonInrPayments.length ? `${nonInrPayments.length} recent payments are not INR` : "Recent payment records use INR", evidence: nonInrPayments.slice(0, 20).map((p: any) => ({ id: p.id, order_id: p.order_id, currency: p.currency, status: p.status })) });

    // 3) Provider health: only production/enabled providers matter for launch health.
    const providers = await svc.entities.Provider.filter({ enabled: true }).catch(() => []);
    const prodProviders = providers.filter((p: any) => p.environment === "production" || p.provider_lifecycle === "PRODUCTION");
    const unhealthy = prodProviders.filter((p: any) => p.health_status !== "healthy" || !["VERIFIED", "PRODUCTION"].includes(p.provider_lifecycle));
    add(checks, { id: "provider.production.health", area: "provider", status: unhealthy.length ? "FAIL" : "PASS", severity: "high", message: unhealthy.length ? `${unhealthy.length} enabled production providers are unhealthy/unverified` : "Enabled production providers are healthy/verified", evidence: unhealthy.slice(0, 20).map((p: any) => ({ key: p.key, health_status: p.health_status, lifecycle: p.provider_lifecycle })) });

    // 4) Public-route smoke tests. LIGHT mode intentionally avoids expensive browser automation.
    const origin = new URL(req.url).origin;
    const publicPaths = ["/", "/login", "/register", "/about", "/contact", "/tools"];
    for (const path of publicPaths) {
      try {
        const r = await fetch(origin + path, { method: "GET", redirect: "manual" });
        add(checks, { id: `route.${path}`, area: "routing", status: r.status >= 200 && r.status < 400 ? "PASS" : "FAIL", severity: "critical", message: `${path} -> HTTP ${r.status}` });
      } catch (e: any) {
        add(checks, { id: `route.${path}`, area: "routing", status: "FAIL", severity: "critical", message: `${path} fetch failed: ${e?.message || String(e)}` });
      }
    }

    // 5) Case-state sanity on recent cases; no mutation, no AI.
    const apps = await svc.entities.VisaApplication.filter({}, "-created_date", 200).catch(() => []);
    const impossiblePaid = apps.filter((a: any) => a.paid_at && ["DRAFT", "INTAKE", "ELIGIBILITY_REVIEW"].includes(a.case_state));
    add(checks, { id: "application.paid_state_consistency", area: "application_flow", status: impossiblePaid.length ? "FAIL" : "PASS", severity: "high", message: impossiblePaid.length ? `${impossiblePaid.length} paid cases remain in a pre-payment case state` : "Recent paid cases have consistent case states", evidence: impossiblePaid.slice(0, 20).map((a: any) => ({ id: a.id, case_state: a.case_state, paid_at: a.paid_at })) });

    const failed = failCount(checks);
    const warnings = warnCount(checks);
    const criticalFails = checks.filter((c) => c.status === "FAIL" && c.severity === "critical").length;
    const health = Math.max(0, Math.round(100 - criticalFails * 15 - (failed - criticalFails) * 7 - warnings * 2));
    const status = failed ? "FAIL" : warnings ? "WARN" : "PASS";
    const failures = checks.filter((c) => c.status === "FAIL");
    const root_causes = failures.map(rootCauseFor);
    const generated_at = new Date().toISOString();
    const run_id = `qa-${Date.now()}`;
    const summary = { total: checks.length, passed: checks.filter((c) => c.status === "PASS").length, warnings, failed, critical_failed: criticalFails, mvp_countries: MVP_COUNTRIES };
    const export_payload = { schema: "krosz.qa.v1", app_id: "6a7a236310d39c4c5cb1f566", run_id, generated_at, mode, status, health_score: health, summary, checks, failures, root_causes, promin: { deterministic_first: true, ai_calls: 0, real_payment_charges: 0, browser_suite_run: false, note: "Hourly LIGHT loop; escalate to bounded regression/browser testing only when failures or deployments require it." } };

    const row = await svc.entities.QAReport.create({ run_id, generated_at, mode, status, health_score: health, summary, checks, failures, root_causes, export_payload, source: "qaOrchestrator" });
    return Response.json({ report: row, export: export_payload });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
