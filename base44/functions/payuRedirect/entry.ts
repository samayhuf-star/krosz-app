// PayU hosted-checkout redirect.
//
// The PayU adapter returns checkout_url = <public base>/functions/payuRedirect
// ?payu_txnid=… so the browser only needs a plain GET navigation (the existing
// StepPayment flow). This function looks up the Payment row (whose
// provider_payment_id holds our txnid and whose metadata.response holds the
// PayU request fields + hash the adapter computed server-side), and returns a
// minimal HTML page that auto-submits a POST form to PayU's hosted payment
// page. The hash is therefore never exposed to or tamperable by the browser.
//
// No user session: asServiceRole is used only to read the Payment row.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

function esc(s: any): string {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlResponse(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:24px">${body}</body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function redirectPage(action: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting to PayU…</title></head><body onload="document.forms[0].submit()" style="font-family:system-ui,sans-serif;padding:24px"><noscript>JavaScript is required to continue to PayU. <a href="${esc(action)}">Continue manually</a>.</noscript><p style="color:#64748b">Redirecting to PayU's secure payment page…</p><form method="post" action="${esc(action)}">${inputs}</form></body></html>`;
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole.entities;
  const url = new URL(req.url);
  const txnid = (url.searchParams.get("payu_txnid") || "").trim();
  if (!txnid) return htmlResponse(`<p style="color:#b91c1c">Missing payment reference.</p>`, 400);
  const payments: any[] = await svc.Payment.filter({ provider_payment_id: txnid }).catch(() => []);
  const payment = (payments || [])[0];
  if (!payment) return htmlResponse(`<p style="color:#b91c1c">Payment not found. Please restart payment from your application.</p><p><a href="/">Return to Krosz</a></p>`);
  const fields = payment.metadata?.response?.payu_fields || payment.metadata?.payu_fields || null;
  const host = payment.metadata?.response?.host || (String(fields?.surl || "").startsWith("https://test.payu.in") ? "https://test.payu.in" : "https://secure.payu.in");
  if (!fields || !fields.action || !fields.hash) return htmlResponse(`<p style="color:#b91c1c">PayU checkout details have expired. Please restart payment from your application.</p><p><a href="/applications/${esc(payment.application_id || "")}">Return to your application</a></p>`);
  return new Response(redirectPage(`${host}/_payment`, fields), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}