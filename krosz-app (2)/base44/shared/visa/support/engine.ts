// Worldz Visa — Phase 12: Support — tickets + conversations + messages + internal notes
// (§33-§41, §70-§72). Traveler-owned; internal notes never surface to customers
// (§36). Attachments reuse existing private storage (§71). AI co-pilot hooks are
// additive and never mutate visa/application/financial state (§40).

function genTicketNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TKT-${year}-${rand}`;
}

const TICKET_CATEGORIES = ["DOCUMENTS", "PAYMENT", "APPOINTMENT", "SUBMISSION", "STATUS", "REFUND", "TECHNICAL", "OTHER"];

// Determine default priority from policy (§39/§61), not AI sentiment.
function derivePriority(category: string, app: any): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  if (category === "REFUND" || category === "PAYMENT") return "NORMAL";
  if (app?.status === "additional_documents") return "HIGH";
  if (category === "TECHNICAL") return "NORMAL";
  return "NORMAL";
}

export async function createSupportTicket(svc: any, user: any, app: any, input: { category: string; priority?: string; subject?: string; message: string; attachments?: any[] }): Promise<any> {
  if (!input?.message) throw Object.assign(new Error("Message required"), { code: "BAD_INPUT" });
  const category = TICKET_CATEGORIES.includes(input.category) ? input.category : "OTHER";
  const priority = (input.priority as any) || derivePriority(category, app);
  const ticket_number = genTicketNumber();
  // One conversation per ticket.
  const convo = await svc.entities.SupportConversation.create({
    application_id: app.id, traveler_id: app.traveler_id, type: typeForCategory(category),
    status: "ACTIVE", subject: input.subject || category, last_message_at: new Date().toISOString(),
    last_message_preview: input.message.slice(0, 120), unread_customer: 0, unread_operator: 1, metadata: {},
  });
  const ticket = await svc.entities.SupportTicket.create({
    application_id: app.id, traveler_id: app.traveler_id, conversation_id: convo.id, ticket_number,
    category, priority, subject: input.subject || category, first_message: input.message,
    status: "OPEN", assigned_to: "", escalation_state: "none", metadata: {},
  });
  await svc.entities.SupportConversation.update(convo.id, { ticket_id: ticket.id }).catch(() => {});
  await svc.entities.SupportMessage.create({
    conversation_id: convo.id, traveler_id: app.traveler_id, application_id: app.id,
    sender_type: "TRAVELER", sender_id: app.traveler_id, body: input.message,
    attachments: input.attachments || [], metadata: {},
  });
  // Create an in-app notification for the traveler (confirmation) and record.
  await svc.entities.VisaNotification.create({
    traveler_id: app.traveler_id, application_id: app.id, notification_key: `support_created:${ticket.id}`,
    event_type: "APPLICATION_CREATED", category: "support_messages", priority: "INFO",
    title: `Support ticket ${ticket_number} created`, body: `We've received your request and will respond shortly.`,
    deep_link: `/applications/${app.id}`, status: "UNREAD", occurred_at: new Date().toISOString(), metadata: {},
  }).catch(() => {});
  // Best-effort confirmation email to the traveler (never blocks ticket creation).
  try {
    const { sendTicketCreated } = await import("../../mail/templates.ts");
    const u: any = await svc.entities.User.filter({ id: user.id }).catch(() => []);
    const email = (u && u[0]?.email) || user.email;
    if (email) { const name = (user.full_name || "").split(" ")[0] || "there"; await sendTicketCreated(email, name, ticket_number, input.subject || category, `https://krosz.com/applications/${app.id}`); }
  } catch {}
  return { ticket, conversation: convo };
}

const CONVO_TYPE: Record<string, string> = {
  DOCUMENTS: "DOCUMENT_SUPPORT", PAYMENT: "PAYMENT_SUPPORT", APPOINTMENT: "APPOINTMENT_SUPPORT",
  SUBMISSION: "APPLICATION_SUPPORT", STATUS: "APPLICATION_SUPPORT", REFUND: "PAYMENT_SUPPORT",
  TECHNICAL: "GENERAL_SUPPORT", OTHER: "GENERAL_SUPPORT",
};
function typeForCategory(c: string): string { return CONVO_TYPE[c] || "GENERAL_SUPPORT"; }

export async function listTickets(svc: any, user: any, appId: string): Promise<any[]> {
  const q: any = user.role === "admin" ? (appId ? { application_id: appId } : {}) : { application_id: appId, created_by_id: user.id };
  const rows: any[] = await svc.entities.SupportTicket.filter(q, "-created_date", 50).catch(() => []);
  return rows || [];
}

export async function listAllTickets(svc: any, user: any, opts: { status?: string; priority?: string } = {}): Promise<any[]> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const q: any = {};
  if (opts.status) q.status = opts.status;
  if (opts.priority) q.priority = opts.priority;
  const rows: any[] = await svc.entities.SupportTicket.filter(q, "-created_date", 100).catch(() => []);
  return rows || [];
}

export async function getConversation(svc: any, user: any, conversationId: string): Promise<any> {
  const c = await svc.entities.SupportConversation.get(conversationId).catch(() => null);
  if (!c) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  if (c.created_by_id !== user.id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  return c;
}

export async function listMessages(svc: any, user: any, conversationId: string): Promise<any[]> {
  const c = await getConversation(svc, user, conversationId);
  const rows: any[] = await svc.entities.SupportMessage.filter({ conversation_id: c.id }, "created_date", 200).catch(() => []);
  // Clear unread for the viewer.
  if (user.role === "admin") await svc.entities.SupportConversation.update(c.id, { unread_operator: 0 }).catch(() => {});
  else if (c.created_by_id === user.id) await svc.entities.SupportConversation.update(c.id, { unread_customer: 0 }).catch(() => {});
  return rows || [];
}

export async function sendMessage(svc: any, user: any, conversationId: string, input: { body: string; attachments?: any[] }): Promise<any> {
  const c = await getConversation(svc, user, conversationId);
  if (!input?.body) throw Object.assign(new Error("Message required"), { code: "BAD_INPUT" });
  const senderType = user.role === "admin" ? "OPERATOR" : "TRAVELER";
  const senderId = user.role === "admin" ? user.id : c.traveler_id;
  const msg = await svc.entities.SupportMessage.create({
    conversation_id: c.id, traveler_id: c.traveler_id, application_id: c.application_id,
    sender_type: senderType, sender_id: senderId, body: input.body, attachments: input.attachments || [], metadata: {},
  });
  await svc.entities.SupportConversation.update(c.id, {
    last_message_at: new Date().toISOString(), last_message_preview: input.body.slice(0, 120),
    status: senderType === "OPERATOR" ? "WAITING_CUSTOMER" : "WAITING_OPERATOR",
    unread_customer: senderType === "OPERATOR" ? (c.unread_customer || 0) + 1 : 0,
    unread_operator: senderType === "TRAVELER" ? (c.unread_operator || 0) + 1 : 0,
  }).catch(() => {});
  // Notify the traveler when an operator replies.
  if (senderType === "OPERATOR") {
    await svc.entities.VisaNotification.create({
      traveler_id: c.traveler_id, application_id: c.application_id, notification_key: `support_msg:${msg.id}`,
      event_type: "ADDITIONAL_INFORMATION_REQUIRED", category: "support_messages", priority: "ACTION_REQUIRED",
      title: "New message from support", body: input.body.slice(0, 160),
      deep_link: `/applications/${c.application_id}`, status: "UNREAD", occurred_at: new Date().toISOString(), metadata: {},
    }).catch(() => {});
    try {
      const { sendTicketReply } = await import("../../mail/templates.ts");
      const ownerRows: any[] = await svc.entities.VisaApplication.filter({ id: c.application_id }).catch(() => []);
      const appRow = ownerRows[0];
      const uRows: any[] = appRow?.created_by_id ? await svc.entities.User.filter({ id: appRow.created_by_id }).catch(() => []) : [];
      const email = (uRows[0]?.email) || "";
      if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; const tn = (await svc.entities.SupportTicket.filter({ conversation_id: c.id }).catch(() => []))[0]?.ticket_number || "TKT"; await sendTicketReply(email, name, tn, input.body, `https://krosz.com/applications/${c.application_id}`); }
    } catch {}
  }
  if (c.ticket_id) await svc.entities.SupportTicket.update(c.ticket_id, { status: senderType === "OPERATOR" ? "WAITING_CUSTOMER" : "WAITING_PROVIDER" }).catch(() => {});
  return msg;
}

export async function addInternalNote(svc: any, user: any, appId: string, input: { body: string; ticket_id?: string; pinned?: boolean }): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  if (!input?.body) throw Object.assign(new Error("Body required"), { code: "BAD_INPUT" });
  return await svc.entities.InternalNote.create({
    application_id: appId, ticket_id: input.ticket_id || "", author_id: user.id,
    author_name: user.full_name || user.email || "operator", body: input.body, pinned: !!input.pinned, metadata: {},
  });
}

export async function listInternalNotes(svc: any, user: any, appId: string): Promise<any[]> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const notes: any[] = await svc.entities.InternalNote.filter({ application_id: appId }, "-created_date", 100).catch(() => []);
  return (notes || []).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

export async function assignTicket(svc: any, user: any, ticketId: string, assigneeId: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const t = await svc.entities.SupportTicket.get(ticketId).catch(() => null);
  if (!t) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  await svc.entities.SupportTicket.update(ticketId, { assigned_to: assigneeId || user.id, status: "ASSIGNED" });
  return { id: ticketId, assigned_to: assigneeId || user.id, status: "ASSIGNED" };
}

export async function resolveTicket(svc: any, user: any, ticketId: string, opts: { resolution?: string } = {}): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const t = await svc.entities.SupportTicket.get(ticketId).catch(() => null);
  if (!t) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  const now = new Date().toISOString();
  await svc.entities.SupportTicket.update(ticketId, { status: "RESOLVED", resolved_at: now, metadata: { ...(t.metadata || {}), resolution: opts.resolution || "" } });
  if (t.conversation_id) await svc.entities.SupportConversation.update(t.conversation_id, { status: "RESOLVED" }).catch(() => {});
  try {
    const { sendTicketResolved } = await import("../../mail/templates.ts");
    const appRow: any = t.application_id ? (await svc.entities.VisaApplication.filter({ id: t.application_id }).catch(() => []))[0] : null;
    const uRows: any[] = appRow?.created_by_id ? await svc.entities.User.filter({ id: appRow.created_by_id }).catch(() => []) : [];
    const email = uRows[0]?.email || "";
    if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; await sendTicketResolved(email, name, t.ticket_number, `https://krosz.com/applications/${t.application_id}`); }
  } catch {}
  return { id: ticketId, status: "RESOLVED", resolved_at: now };
}

export async function rejectTicket(svc: any, user: any, ticketId: string, reason: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const t = await svc.entities.SupportTicket.get(ticketId).catch(() => null);
  if (!t) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  const now = new Date().toISOString();
  await svc.entities.SupportTicket.update(ticketId, { status: "REJECTED", resolved_at: now, metadata: { ...(t.metadata || {}), resolution: `Rejected: ${reason}` } }).catch(() => {});
  if (t.conversation_id) await svc.entities.SupportConversation.update(t.conversation_id, { status: "RESOLVED" }).catch(() => {});
  return { id: ticketId, status: "REJECTED", resolved_at: now };
}

export const SUPPORT_CATEGORIES = TICKET_CATEGORIES;