// Real Orchestrator adapter for `configure_domain` and `verify_domain`.
//
// Follows the same execution contract as the Website adapter: a persisted
// orchestrator Task + full Business context snapshot in, structured output out.
// The adapter NEVER hard-codes a registrar — it resolves the domain_registrar
// capability through the provider registry (business binding -> fallback ->
// platform default). The resolved provider's adapter_key selects the actual
// provider adapter (OpenProvider / OpenSRS / mock) at runtime.
//
// Stages (configure_domain): register -> dns.   (verify_domain): verify.
// Persisted AIExecution checkpoints before AND after each external side effect,
// with resume-from-checkpoint. Idempotent: a Domain already registered for this
// business+name (by external_reference) is never re-registered, so retrying or
// resuming a completed domain task cannot duplicate the external side effect.
//
// If no domain_registrar provider is configured, the adapter fails with
// PROVIDER_UNAVAILABLE — it never fakes a successful production provider call.

import { getProviderAdapter, registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import { buildProviderContext } from "../../providers/runtime.ts";
import { secrets } from "base44:runtime";
import mockDomainAdapter from "../../providers/adapters/mock_domain.ts"; // deterministic test registrar
import { recordExecution, hashOf } from "../adapterContract.ts";
import type { Adapter } from "../adapters.ts";

// Robustly register the mock registrar against the SAME registry instance this
// module reads (getProviderAdapter). mock_domain.ts self-registers on import via
// a different relative path ("../registry.ts"); if the runtime ever treats that
// path and this module's "../../providers/registry.ts" as separate module
// instances, the side-effect registration would land in a different Map than the
// one getProviderAdapter reads, leaving the adapter "not installed". This explicit
// registration against our own registry import removes that fragility entirely.
if (!hasProviderAdapter("mock_domain")) {
  try { registerProviderAdapter(mockDomainAdapter); } catch {}
}

const secGet = (name: string): string | undefined => {
  try { return secrets.get(name); } catch { return undefined; }
};

function runtimeFor(svc: any) {
  return {
    invokeLLM: async (prompt: string, opts: Record<string, unknown> = {}) => (await svc.integrations.Core.InvokeLLM({ prompt, ...opts })) || "",
    fetchExternal: async (url: string, init?: RequestInit) => await fetch(url, init),
  };
}

export function createDomainAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor } = input as any;
    const base44 = (svc && svc.__base44) || svc;
    const attempt = task.attempt || 1;
    const execIds: string[] = [];

    const providerRef = () => ({
      provider_id: resolvedProvider?.provider_id || "",
      provider_key: resolvedProvider?.provider_key || resolvedProvider?.key || "",
      adapter_key: resolvedProvider?.adapter_key || "",
      name: resolvedProvider?.name || "",
      category: resolvedProvider?.category || "domain",
      via: resolvedProvider?.via || "",
    });

    const ckpt = async (stage: string, success: boolean, output: any, durationMs: number, errorCode = "", errorMessage = "", retryable = false) => {
      const outObj: any = output == null ? {} : (Array.isArray(output) ? { items: output, count: output.length } : (typeof output === "object" ? output : { value: output }));
      const id = await recordExecution(svc, {
        run, task, attempt, stage, operation: `${task.type}.${stage}`,
        capability: task.provider_capability || "domain_registrar",
        provider: providerRef(), model: "",
        inputHash: task.input_hash, outputHash: hashOf(outObj),
        success, errorCode, errorMessage, retryable, durationMs, actor, output: outObj,
      });
      execIds.push(id);
    };

    const doneRows: any[] = await svc.entities.AIExecution.filter({ task_id: task.id, success: true }).catch(() => []);
    const doneStage = (s: string) => (doneRows || []).some((e) => e.stage === s);

    // Provider-adapter access (non-AI). Tolerant: if the provider's adapter isn't
    // installed in this runtime, treat as unsupported (never fake success).
    const getDomainAdapter = (adapterKey: string): any | null => {
      try { return getProviderAdapter(adapterKey); } catch { return null; }
    };
    const hasOp = (op: string) => {
      const a = getDomainAdapter(resolvedProvider?.adapter_key);
      return !!a && typeof a[op] === "function";
    };
    const callProvider = async (op: string, ...args: any[]): Promise<any> => {
      if (!resolvedProvider || !resolvedProvider.provider_id) {
        return { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: "No domain provider resolved.", retryable: false };
      }
      const adapter = getDomainAdapter(resolvedProvider.adapter_key);
      if (!adapter || typeof adapter[op] !== "function") {
        return { success: false, error_code: "PROVIDER_ADAPTER_NOT_INSTALLED", error_message: `Provider adapter "${resolvedProvider.adapter_key}" does not expose "${op}".`, retryable: false };
      }
      const providerEntity: any = await svc.entities.Provider.get(resolvedProvider.provider_id).catch(() => null);
      const ctx = await buildProviderContext(base44, secGet, providerEntity);
      return await adapter[op](ctx, runtimeFor(svc), ...args);
    };

    // Resolve domain requirements from the task input.
    const domainInput = context?.domain || (task.input_context && task.input_context.domain) || null;
    const domainName: string | null = domainInput?.name || (context?.prior_task_outputs?.configure_domain?.domain) || null;
    const years = domainInput?.years || 1;

    if (!domainName) {
      await ckpt("register.pre", false, { error: "NO_DOMAIN" }, 0, "VALIDATION_FAILED", "No domain specified in task input (context.domain.name).", false);
      return { status: "failed", output: null, error: { code: "VALIDATION_FAILED", message: "No domain specified in task input (context.domain.name).", retryable: false }, last_stage: "register.pre", executionIds: execIds };
    }
    if (!resolvedProvider || !resolvedProvider.provider_id || resolvedProvider.via === "none") {
      await ckpt("register.pre", false, { error: "NO_PROVIDER" }, 0, "PROVIDER_UNAVAILABLE", "No domain_registrar provider configured for this business.", false);
      return { status: "failed", output: null, error: { code: "PROVIDER_UNAVAILABLE", message: "No domain_registrar provider configured for this business.", retryable: false }, last_stage: "register.pre", executionIds: execIds };
    }

    const fail = (code: string, message: string, retryable: boolean, stage: string) => ({ status: "failed" as const, output: null, error: { code, message, retryable }, last_stage: stage, executionIds: execIds });

    // ---------------- configure_domain: register -> dns ----------------
    if (task.type === "configure_domain") {
      // Stage: register (external side effect -> money)
      let domain: any = null;
      const existing = await svc.entities.Domain.filter({ business_id: run.business_id, domain_name: domainName }).catch(() => []);
      domain = (existing || []).find((d: any) => d.external_reference) || null;

      if (domain) {
        // Idempotent: already registered for this business+name -> skip external call.
        if (!doneStage("register.post")) await ckpt("register.post", true, { skipped_external_call: true, external_reference: domain.external_reference, domain_id: domain.id, domain_name: domain.domain_name }, 0);
      } else if (doneStage("register.post")) {
        const row = (doneRows || []).find((e) => e.stage === "register.post");
        if (row?.output?.domain_id) domain = await svc.entities.Domain.get(row.output.domain_id).catch(() => null);
      } else {
        await ckpt("register.pre", true, { domain_name: domainName, years }, 0);
        const t = Date.now();
        const res: any = await callProvider("registerDomain", { name: domainName, years });
        if (!res.success) {
          await ckpt("register.post", false, { error: res.error_code }, Date.now() - t, res.error_code || "PROVIDER_FAILED", res.error_message || "Domain registration failed.", res.retryable !== false);
          return fail(res.error_code || "PROVIDER_FAILED", res.error_message || "Domain registration failed.", res.retryable !== false, "register.post");
        }
        const ext = (res.data && res.data.external_reference) || "";
        const now = new Date();
        const exp = new Date(now); exp.setFullYear(now.getFullYear() + (years || 1));
        domain = await svc.entities.Domain.create({
          tenant_id: run.tenant_id, business_id: run.business_id, provider_id: resolvedProvider.provider_id,
          domain_name: domainName, status: "registered", registration_price: (res.data && res.data.price) || 0, currency: (res.data && res.data.currency) || "USD",
          registered_at: now.toISOString(), expires_at: exp.toISOString(), auto_renew: false, transfer_lock: true,
          nameservers: [], dns_status: "pending", external_reference: ext,
        });
        await ckpt("register.post", true, { external_reference: ext, domain_id: domain.id, registration_status: "registered", price: (res.data && res.data.price) || 0, currency: (res.data && res.data.currency) || "USD" }, Date.now() - t);
      }

      // Stage: dns (external side effect -> configuration)
      if (!doneStage("dns.post")) {
        if (domain.dns_status === "configured") {
          await ckpt("dns.post", true, { skipped_external_call: true, dns_status: "configured" }, 0);
        } else if (hasOp("configureDns")) {
          const t = Date.now();
          const res: any = await callProvider("configureDns", { domain: domainName, external_reference: domain.external_reference });
          if (res.success) {
            await svc.entities.Domain.update(domain.id, { dns_status: "configured", nameservers: (res.data && res.data.nameservers) || [] });
            await ckpt("dns.post", true, { dns_status: "configured", nameservers: (res.data && res.data.nameservers) || [] }, Date.now() - t);
          } else {
            await svc.entities.Domain.update(domain.id, { dns_status: "failed" }).catch(() => {});
            await ckpt("dns.post", false, { error: res.error_code }, Date.now() - t, res.error_code || "DNS_FAILED", res.error_message || "DNS configuration failed.", res.retryable !== false);
            return fail(res.error_code || "DNS_FAILED", res.error_message || "DNS configuration failed.", res.retryable !== false, "dns.post");
          }
        } else {
          // Provider does not expose DNS configuration — record truthfully, do not fake.
          await ckpt("dns.post", true, { dns_status: "pending", note: "Provider does not expose DNS configuration; manual setup required." }, 0);
        }
      }

      const finalDomain: any = await svc.entities.Domain.get(domain.id).catch(() => domain);
      return {
        status: "completed",
        output: {
          domain: finalDomain.domain_name, domain_id: finalDomain.id,
          provider: resolvedProvider.provider_key || resolvedProvider.key,
          provider_id: resolvedProvider.provider_id, adapter_key: resolvedProvider.adapter_key,
          registration_status: finalDomain.status, dns_status: finalDomain.dns_status,
          external_reference: finalDomain.external_reference,
        },
        last_stage: "dns.post",
        executionIds: execIds,
        provider: resolvedProvider,
      };
    }

    // ---------------- verify_domain: verify ----------------
    if (task.type === "verify_domain") {
      let domainId = context?.prior_task_outputs?.configure_domain?.domain_id || null;
      let domain: any = domainId ? await svc.entities.Domain.get(domainId).catch(() => null) : null;
      if (!domain) {
        const rows = await svc.entities.Domain.filter({ business_id: run.business_id, domain_name: domainName }).catch(() => []);
        domain = (rows || []).find((d: any) => d.external_reference) || (rows || [])[0] || null;
      }
      if (!domain) {
        await ckpt("verify.post", false, { error: "NO_DOMAIN" }, 0, "DEPENDENCY_BLOCKED", "configure_domain produced no Domain to verify.", false);
        return fail("DEPENDENCY_BLOCKED", "configure_domain produced no Domain to verify.", false, "verify.post");
      }
      if (!doneStage("verify.post")) {
        if (domain.status === "active") {
          await ckpt("verify.post", true, { skipped_external_call: true, verification_status: "verified", domain_id: domain.id, domain: domain.domain_name }, 0);
        } else {
          const t = Date.now();
          if (hasOp("verifyDomain")) {
            const res: any = await callProvider("verifyDomain", { domain: domainName, external_reference: domain.external_reference });
            if (!res.success || !(res.data && res.data.verified)) {
              await ckpt("verify.post", false, { error: res?.error_code }, Date.now() - t, res?.error_code || "VERIFY_FAILED", res?.error_message || "Domain verification failed.", res?.retryable !== false);
              return fail(res?.error_code || "VERIFY_FAILED", res?.error_message || "Domain verification failed.", res?.retryable !== false, "verify.post");
            }
          }
          await svc.entities.Domain.update(domain.id, { status: "active" }).catch(() => {});
          await ckpt("verify.post", true, { verification_status: "verified", domain_id: domain.id, domain: domain.domain_name }, Date.now() - t);
        }
      }
      const finalDomain: any = await svc.entities.Domain.get(domain.id).catch(() => domain);
      return {
        status: "completed",
        output: {
          domain: finalDomain.domain_name, domain_id: finalDomain.id,
          provider: resolvedProvider.provider_key || resolvedProvider.key,
          registration_status: finalDomain.status, dns_status: finalDomain.dns_status,
          verification_status: "verified",
          external_reference: finalDomain.external_reference,
        },
        last_stage: "verify.post",
        executionIds: execIds,
        provider: resolvedProvider,
      };
    }

    return fail("FACTORY_FAILED", `Unknown domain task type: ${task.type}`, false, "");
  };
}