import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.id) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim().slice(0, 4000);
    if (!question) return Response.json({ error: "Question is required" }, { status: 400 });
    const ticketNumber = `HELP-${Date.now().toString(36).toUpperCase()}`;
    const record = await base44.entities.HelpTicket.create({
      ticket_number: ticketNumber,
      user_id: user.id,
      user_email: user.email || "",
      question,
      source: "AI_ESCALATION",
      status: "OPEN",
      priority: "NORMAL",
      ai_context: String(body?.ai_context || "").slice(0, 8000),
    });
    return Response.json({ success: true, ticket_number: ticketNumber, ticket_id: record?.id });
  } catch (error) {
    return Response.json({ error: error?.message || "Could not create help ticket" }, { status: 500 });
  }
});