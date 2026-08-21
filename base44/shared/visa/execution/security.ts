// Worldz Visa (Phase 11) — execution security (§§33/34/35/17).
//
// - Domain allowlist: the browser provider may ONLY navigate to approved
//   domains on the PortalDefinition. An unexpected redirect pauses execution.
// - Credential isolation: secrets live in ProviderCredential; nothing in the
//   execution context, plan, events, or LLM prompt.
// - Prompt-injection defense: external portal content is DATA. The adapter
//   never lets page text redefine the execution plan, permissions, or
//   credentials. (Enforced in the browser adapter; this module exposes the
//   helpers.)

import type { SessionStatus } from "./types.ts";

export function isDomainAllowed(portal: any, url: string): boolean {
  if (!url) return false;
  let host = "";
  try { host = new URL(url).hostname; } catch { host = String(url).toLowerCase(); }
  const allowed: string[] = (portal?.allowed_domains || []).map((d: string) => String(d).toLowerCase());
  if (!allowed.length) return true; // No allowlist configured = unrestricted (config-time).
  return allowed.some((d) => host === d || host.endsWith("." + d));
}

export const UNEXPECTED_DOMAIN = "UNEXPECTED_DOMAIN";
export const AUTOMATION_BLOCKED = "AUTOMATION_BLOCKED";
export const POLICY_RESTRICTION = "POLICY_RESTRICTION";

// Throws a structured pause result for an off-domain redirect (§33).
export function pauseForUnexpectedDomain(portal: any, url: string) {
  return {
    success: false, status: "WAITING_FOR_USER" as SessionStatus, requiresHuman: true,
    humanReason: "UNEXPECTED_DOMAIN" as const,
    humanInstructions: `Browser was redirected to an unapproved host: ${url}`,
    error_code: UNEXPECTED_DOMAIN, error_category: "HUMAN_REQUIRED" as const, retryable: false,
    next_url: url,
  };
}

// Verify automation is permitted by portal terms before automating (§22).
export function assertAutomationAllowed(portal: any): void {
  if (portal && portal.automation_allowed === false) {
    throw Object.assign(new Error("Portal does not permit automation; use HUMAN_ASSISTED/MANUAL"), { code: POLICY_RESTRICTION });
  }
}