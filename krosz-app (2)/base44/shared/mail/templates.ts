// Krosz-branded transactional email templates + thin send wrappers.
// Phase 2 hardening: all customer-facing email must originate from the Krosz
// brand sender and never reference the legacy "Arrivals" brand or arrivals.app.
// Uses the shared Resend adapter (resend.ts) so it reaches registered users and,
// where the plan + custom domain allow, other recipients.
import { sendMail, type SendOpts } from "./resend.ts";
import { secrets } from "base44:runtime";

const BRAND = "Krosz";
const SITE = "https://krosz.com";

function fromName(): string {
  return secrets.get("MAILBUX_FROM_NAME") || BRAND;
}

function wrap(title: string, bodyHtml: string, opts?: { ctaLabel?: string; ctaHref?: string }): string {
  const cta = opts?.ctaLabel && opts?.ctaHref
    ? `<p style="margin:24px 0"><a href="${opts.ctaHref}" style="background:#003580;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">${opts.ctaLabel}</a></p>`
    : "";
  return `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;line-height:1.6;max-width:560px;margin:0 auto">
  <table width="100%" style="border-bottom:2px solid #003580;padding-bottom:12px;margin-bottom:18px"><tr><td style="font-size:15px;font-weight:800;color:#003580;letter-spacing:.5px">KROSZ</td></tr></table>
  <h1 style="font-size:20px;margin:0 0 10px">${title}</h1>
  ${bodyHtml}
  ${cta}
  <p style="color:#64748b;font-size:13px;margin-top:28px">— The ${BRAND} team</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:22px" />
  <p style="color:#94a3b8;font-size:11px">Krosz is a private visa and travel assistance service and is not a government authority. Visa decisions are made by the relevant government. Visit <a href="${SITE}/trust" style="color:#64748b">our Trust Center</a>.</p>
</div>`;
}

async function send(opts: { to: string; subject: string; html: string; text?: string; replyTo?: string }): Promise<any> {
  return sendMail({ to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, fromName: fromName(), replyTo: opts.replyTo }).catch((e: any) => ({ ok: false, error: e?.message || String(e) }));
}

const textFooter = `\n\n— The ${BRAND} team\n${BRAND} is a private service, not a government authority.`;

export async function sendWelcome(to: string, firstName: string): Promise<any> {
  const subject = `Welcome to ${BRAND} ✈️`;
  const text = `Hi ${firstName},\n\nWelcome to ${BRAND} — your account is ready. Start a visa application, track every step, and reach our team anytime.\n\nStart: ${SITE}/apply${textFooter}`;
  const html = wrap(`Welcome to ${BRAND}, ${firstName} ✈️`, `<p>Your account is ready. Start a visa application, track every step in real time, and reach our team anytime.</p>`, { ctaLabel: "Start your application", ctaHref: `${SITE}/apply` });
  return send({ to, subject, html, text });
}

export async function sendTicketCreated(to: string, firstName: string, ticketNumber: string, subject: string, appLink: string): Promise<any> {
  const subj = `Your ${BRAND} support request ${ticketNumber}`;
  const text = `Hi ${firstName},\n\nWe've received your support request "${subject}" (reference ${ticketNumber}). Our team will reply shortly.\n\nView your request: ${appLink}${textFooter}`;
  const html = wrap(`We got your request — ${ticketNumber}`, `<p>We've received your support request <strong>"${subject}"</strong> (reference <strong>${ticketNumber}</strong>). Our team will reply shortly.</p><p>You can reply from your dashboard anytime.</p>`, { ctaLabel: "View your request", ctaHref: appLink });
  return send({ to, subject: subj, html, text });
}

export async function sendTicketReply(to: string, firstName: string, ticketNumber: string, message: string, appLink: string): Promise<any> {
  const subj = `New reply on ${BRAND} request ${ticketNumber}`;
  const text = `Hi ${firstName},\n\nSupport replied to your request ${ticketNumber}:\n\n${message}\n\nReply: ${appLink}${textFooter}`;
  const html = wrap(`New reply on ${ticketNumber}`, `<p>Support replied to your request <strong>${ticketNumber}</strong>:</p><blockquote style="border-left:3px solid #006CEC;padding-left:12px;color:#334155">${message}</blockquote>`, { ctaLabel: "Reply now", ctaHref: appLink });
  return send({ to, subject: subj, html, text });
}

export async function sendTicketResolved(to: string, firstName: string, ticketNumber: string, appLink: string): Promise<any> {
  const subj = `${BRAND} request ${ticketNumber} is resolved`;
  const text = `Hi ${firstName},\n\nYour support request ${ticketNumber} has been marked resolved. If you're still stuck, just reply to reopen it.\n\nView: ${appLink}${textFooter}`;
  const html = wrap(`Resolved — ${ticketNumber}`, `<p>Your support request <strong>${ticketNumber}</strong> has been marked resolved. If you're still stuck, reply from your dashboard to reopen it.</p>`, { ctaLabel: "View request", ctaHref: appLink });
  return send({ to, subject: subj, html, text });
}

export async function sendRefundStatus(to: string, firstName: string, orderNumber: string, status: string, amountMinor: number, currency: string, note: string): Promise<any> {
  const amount = (amountMinor / 100).toFixed(2);
  const subj = `${BRAND} refund update — ${status} — ${orderNumber}`;
  const text = `Hi ${firstName},\n\nRefund update for order ${orderNumber}:\nStatus: ${status}\nAmount: ${amount} ${currency}\n${note ? note + "\n" : ""}This is processed to your original payment method. Visa decisions are made by the government and are unaffected by refunds.${textFooter}`;
  const html = wrap(`Refund update — ${status}`, `<p>Update for order <strong>${orderNumber}</strong>:</p><p><strong>Status:</strong> ${status}<br/><strong>Amount:</strong> ${amount} ${currency}</p>${note ? `<p>${note}</p>` : ""}<p>This is processed to your original payment method. Visa decisions are made by the government and are unaffected by refunds.</p>`);
  return send({ to, subject: subj, html, text });
}