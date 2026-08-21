// Shared Resend transactional sender. Sends from the brand mailbox
// Sends from the Krosz brand mailbox (MAILBUX_FROM_EMAIL / MAILBUX_FROM_NAME,
// verified domain) to any recipient, using the Resend HTTP API
// (https://api.resend.com/emails). No nodemailer, no Base44 SendEmail.
//
// Transport is built lazily (the API key is read inside calls) so a missing
// or invalid secret never crashes the function boot — it surfaces as a
// handled send error instead.
import { secrets } from "base44:runtime";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_DOMAINS_ENDPOINT = "https://api.resend.com/domains";

export function isConfigured(): boolean {
  try { config(); return true; } catch { return false; }
}

const DEFAULT_FROM_EMAIL = "team@krosz.com";
const DEFAULT_FROM_NAME = "Krosz";

function config() {
  const apiKey = secrets.get("RESEND_API_KEY");
  const from = secrets.get("MAILBUX_FROM_EMAIL") || DEFAULT_FROM_EMAIL;
  const fromName = secrets.get("MAILBUX_FROM_NAME") || DEFAULT_FROM_NAME;
  if (!apiKey) {
    throw Object.assign(new Error("RESEND_NOT_CONFIGURED"), { code: "RESEND_NOT_CONFIGURED" });
  }
  return { apiKey, from, fromName };
}

// Lightweight connectivity check: the Resend /domains endpoint requires auth,
// so a 200 here proves the API key is valid.
export async function verifyConnection(): Promise<any> {
  const { apiKey } = config();
  const res = await fetch(RESEND_DOMAINS_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("RESEND_UNAUTHORIZED"), { code: "RESEND_UNAUTHORIZED" });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`RESEND_VERIFY_FAILED_${res.status}`), { code: "RESEND_VERIFY_FAILED" });
  }
  return { ok: true };
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  fromName?: string;
  replyTo?: string;
}): Promise<{ ok: true; provider: string; provider_reference: string }> {
  const { apiKey, from, fromName } = config();
  const displayFrom = `${opts.fromName || fromName} <${from}>`;
  const payload: Record<string, any> = {
    from: displayFrom,
    to: [opts.to],
    subject: opts.subject,
  };
  if (opts.html) payload.html = opts.html;
  if (opts.text) payload.text = opts.text;
  if (opts.replyTo) payload.reply_to = opts.replyTo;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `Resend HTTP ${res.status}`;
    const code = body?.error?.name || `RESEND_HTTP_${res.status}`;
    throw Object.assign(new Error(msg), { code });
  }
  return { ok: true, provider: "resend", provider_reference: body?.id || "ok" };
}