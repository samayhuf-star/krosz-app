import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";

function getSecret(name: string): string {
  try { return `${secrets.get(name) ?? ""}`.trim(); } catch { return ""; }
}

function adminOnly(user: any) {
  if (!user || user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
}

async function telegram(method: string, body?: any) {
  const token = getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) throw Object.assign(new Error("TELEGRAM_BOT_TOKEN is not configured"), { code: "NOT_CONFIGURED" });
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw Object.assign(new Error(json?.description || `Telegram ${method} failed`), { code: "TELEGRAM_ERROR" });
  return json.result;
}

export async function sendTelegramUpdate(text: string) {
  const chatId = getSecret("TELEGRAM_CHAT_ID");
  if (!chatId) throw Object.assign(new Error("TELEGRAM_CHAT_ID is not configured"), { code: "CHAT_NOT_CONFIGURED" });
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    adminOnly(user);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "status") {
      return Response.json({
        ok: true,
        bot_token_configured: !!getSecret("TELEGRAM_BOT_TOKEN"),
        chat_id_configured: !!getSecret("TELEGRAM_CHAT_ID"),
      });
    }

    if (action === "discover-chat") {
      const updates = await telegram("getUpdates");
      const candidates = (updates || [])
        .map((u: any) => u?.message?.chat || u?.edited_message?.chat || u?.callback_query?.message?.chat)
        .filter(Boolean)
        .map((c: any) => ({ id: c.id, type: c.type, username: c.username || null, first_name: c.first_name || null, last_name: c.last_name || null }));
      const unique = Array.from(new Map(candidates.map((c: any) => [String(c.id), c])).values());
      return Response.json({ ok: true, chats: unique });
    }

    if (action === "send") {
      if (!body.text) return Response.json({ error: "text is required" }, { status: 400 });
      const result = await sendTelegramUpdate(String(body.text).slice(0, 3900));
      return Response.json({ ok: true, message_id: result?.message_id || null });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    const status = e?.code === "FORBIDDEN" ? 403 : e?.code === "NOT_CONFIGURED" || e?.code === "CHAT_NOT_CONFIGURED" ? 409 : 500;
    return Response.json({ error: e?.message || String(e), code: e?.code || "ERROR" }, { status });
  }
}
