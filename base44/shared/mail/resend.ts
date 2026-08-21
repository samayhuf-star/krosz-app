// Shared Resend email adapter. Base44's built-in SendEmail only reaches
// registered app users; this module sends transactional email through the
// Resend HTTP API from the brand sender (RESEND_FROM_EMAIL /
// RESEND_FROM_NAME, default Arrivals <team@arrivals.app>) to any recipient.
//
// Transport is built lazily (inside calls) so a missing/invalid secret never
// crashes the function boot — it surfaces as a handled send error instead.
import { secrets } from "base44:runtime";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_DOMAINS_ENDPOINT = "https://api.resend.com/domains";

interface SendOpts {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  fromName?: string;
  replyTo?: string;
  // Optional sender override (must be a verified Resend sender/domain).
  fromEmail?: string;
}

export function isConfigured(): boolean {
  try {
    return !!config();
  } catch {
    return false;
  }
}

// Brand sender comes from the Mailbux/<brand> secrets (Krosz). Only the API
// key is required; a missing sender secret falls back to the Krosz identity
// rather than the legacy Arrivals brand.
const DEFAULT_FROM_EMAIL = "team@krosz.com";
const DEFAULT_FROM_NAME = "Krosz";

function config(): { apiKey: string; from: string; fromName: string } {
  const apiKey = secrets.get("RESEND_API_KEY");
  if (!apiKey) {
    throw Object.assign(new Error("RESEND_NOT_CONFIGURED"), { code: "RESEND_NOT_CONFIGURED" });
  }
  return {
    apiKey,
    from: secrets.get("MAILBUX_FROM_EMAIL") || DEFAULT_FROM_EMAIL,
    fromName: secrets.get("MAILBUX_FROM_NAME") || DEFAULT_FROM_NAME,
  };
}

export async function verifyConnection(): Promise<any> {
  const c = config();
  const res = await fetch(RESEND_DOMAINS_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Resend auth failed (${res.status}): ${body.slice(0, 200)}`), {
      code: "RESEND_AUTH_FAILED",
      status: res.status,
    });
  }
  return { ok: true, provider: "resend" };
}

export async function sendMail(opts: SendOpts): Promise<{ ok: true; provider: string; provider_reference: string }> {
  const c = config();
  const fromEmail = opts.fromEmail || c.from;
  const fromName = opts.fromName || c.fromName;
  const payload: Record<string, any> = {
    from: `${fromName} <${fromEmail}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text || "",
    html: opts.html || "",
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.message || j?.error || JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw Object.assign(new Error(`Resend send failed (${res.status}): ${String(detail).slice(0, 256)}`), {
      code: "RESEND_SEND_FAILED",
      status: res.status,
    });
  }

  const data = await res.json().catch(() => ({}));
  return {
    ok: true as const,
    provider: "resend",
    provider_reference: data?.id || data?.messageId || "ok",
  };
}