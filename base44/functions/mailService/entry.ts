// Transactional mail service backed by Resend (shared/mail/resend.ts).
// Actions:
//   test          — admin diagnostic: verify Resend connectivity.
//   send          — admin-only generic send (for "other things" / manual ops).
//   send-welcome  — welcome email on signup. Recipient must be a registered
//                   user (looked up by user_id or email) so the endpoint can't
//                   be abused to spam arbitrary addresses.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import { sendMail, verifyConnection, isConfigured } from "../../shared/mail/resend.ts";
import { sendWelcome } from "../../shared/mail/templates.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const svc = base44.asServiceRole;

    if (action === "debug") {
      // Admin-only, value-free diagnostic: reports whether each secret matches
      // the expected Mailbux value. Never returns the secret values themselves.
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const s = (k: string) => `${secrets.get(k) ?? ""}`;
      return Response.json({
        provider: "resend",
        api_key_set: !!s("RESEND_API_KEY"),
        api_key_len: s("RESEND_API_KEY").length,
        from_email: s("MAILBUX_FROM_EMAIL") || "team@krosz.com",
        from_name: s("MAILBUX_FROM_NAME") || "Krosz",
      });
    }

    if (action === "test") {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json({ ok: true, configured: isConfigured(), verify: await verifyConnection() }); }
      catch (e: any) { return Response.json({ ok: false, configured: isConfigured(), error: e?.message, code: e?.code }); }
    }

    if (action === "send") {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.to || !body.subject || !(body.text || body.html)) return Response.json({ error: "to, subject, and text/html required" }, { status: 400 });
      try {
        const res = await sendMail({ to: body.to, subject: body.subject, text: body.text, html: body.html, fromName: body.from_name, replyTo: body.reply_to });
        return Response.json({ ...res, to: body.to });
      } catch (e: any) { return Response.json({ ok: false, error: e?.message, code: e?.code }, { status: 502 }); }
    }

    if (action === "send-welcome") {
      let email = body.email;
      let firstName = body.first_name || "there";
      if (body.user_id) {
        const u: any = await svc.entities.User.get(body.user_id).catch(() => null);
        if (!u) return Response.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
        email = u.email;
        firstName = (u.full_name || "there").split(" ")[0];
      } else if (email) {
        const rows: any[] = await svc.entities.User.filter({ email }).catch(() => []);
        if (!rows || !rows.length) return Response.json({ error: "Recipient not a registered user", code: "NOT_REGISTERED" }, { status: 400 });
      } else {
        return Response.json({ error: "user_id or email required" }, { status: 400 });
      }
      try {
        const res = await sendWelcome(email, firstName);
        return Response.json({ ...res, to: email });
      } catch (e: any) { return Response.json({ ok: false, error: e?.message, code: e?.code }, { status: 502 }); }
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: 500 });
  }
}