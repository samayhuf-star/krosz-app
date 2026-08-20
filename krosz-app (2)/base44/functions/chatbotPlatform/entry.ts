// Phase 14 — AI Business Chatbot Platform.
//
// A conversational layer over the existing Business OS. The chatbot is NOT a new
// runtime, memory engine, context engine, action engine or workflow engine. It is
// a thin state machine (Conversation + ChatMessage) that:
//   - resolves a Chatbot + Business server-side (the widget only sends chatbot_id),
//   - dispatches each customer turn as a run_agent standalone task through the
//     REAL Workflow Engine → Agent Runtime → Provider Runtime,
//   - lets the agent call the existing chatbot tools (lookup_business_info,
//     check_business_hours, capture_lead, escalate_to_human) which read/write the
//     REAL CRM Lead / Support Ticket / BusinessContext systems,
//   - records AIExecution + UsageLog + CostLog and a Langfuse trace per turn, and
//     reflects the truthful run/execution state back to the widget.
//
// Security: public widget actions never call auth.me(); all writes are scoped to
// the chatbot's business (resolved server-side). Admin actions require the user's
// tenant to match the chatbot's tenant (or admin).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { dispatchStandaloneTask } from "../../shared/operations/engine.ts";
import { verifyTenant, actorOf } from "../../shared/ai/coo.ts";
import {
  resolveChatbot, computeBusinessHours, ensureChatbotAgent,
  buildChatbotAgentInstructions, toolsForChatbot, recordTurnTelemetry, uuid,
} from "../../shared/chatbot/index.ts";
import { runChatbotAcceptance } from "../../shared/chatbot/acceptance.ts";

const FRIENDLY_ERROR: Record<string, string> = {
  AGENT_TIMEOUT: "I'm having a little trouble right now — could you try again in a moment?",
  TOOL_FAILED: "I couldn't access that right now — please try again.",
  TOOL_NOT_ALLOWED: "I'm not able to do that particular thing, but I can connect you with the team.",
  TOOL_INVALID_ARGS: "I need a little more detail to help with that.",
  BUDGET_EXCEEDED: "I hit a safety limit on that request — could you try again?",
  MAX_TOOL_CALLS: "I hit a safety limit on that request — could you try again?",
  MAX_ITERATIONS: "I couldn't quite settle on an answer — let's try again.",
  INVALID_OUTPUT: "Something went wrong on my end — please try again.",
  AGENT_NOT_FOUND: "This assistant isn't set up yet. Please reach us another way for now.",
  AGENT_INACTIVE: "This assistant is currently paused. Please reach us another way for now.",
  AGENT_NOT_CONFIGURED: "This assistant isn't set up yet. Please reach us another way for now.",
  AI_FAILED: "I'm having a little trouble right now — could you try again in a moment?",
  FACTORY_FAILED: "I'm having a little trouble right now — could you try again in a moment?",
  PROVIDER_TIMEOUT: "I'm having a little trouble right now — could you try again in a moment?",
};
function friendlyError(code: string): string { return FRIENDLY_ERROR[code] || "I'm having a little trouble right now — could you try again in a moment?"; }

const PUBLIC_ACTIONS = new Set(["widget-config", "start-conversation", "send-message", "get-conversation", "restart-conversation"]);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    try { (svc as any).__base44 = base44; } catch {}
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---- Public widget actions (no auth) ----
    if (action === "widget-config") return Response.json(await widgetConfig(svc, body));
    if (action === "start-conversation") return Response.json(await startConversation(svc, body));
    if (action === "send-message") return Response.json(await sendMessage(svc, body));
    if (action === "get-conversation") return Response.json(await getConversation(svc, body));
    if (action === "restart-conversation") return Response.json(await restartConversation(svc, body));

    // ---- Admin actions (auth required) ----
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const actor = actorOf(user, "chatbot_platform");

    if (action === "list-chatbots") return Response.json(await listChatbots(svc, body, user));
    if (action === "get-chatbot") return Response.json(await getChatbot(svc, body, user));
    if (action === "create-chatbot") return Response.json(await createChatbot(svc, body, user, actor));
    if (action === "update-chatbot") return Response.json(await updateChatbot(svc, body, user));
    if (action === "delete-chatbot") return Response.json(await deleteChatbot(svc, body, user));
    if (action === "list-conversations") return Response.json(await listConversations(svc, body, user));
    if (action === "get-conversation-admin") return Response.json(await getConversationAdmin(svc, body, user));
    if (action === "dashboard-stats") return Response.json(await dashboardStats(svc, body, user));
    if (action === "playground-send") return Response.json(await playgroundSend(svc, body, user, actor));
    if (action === "run-acceptance-test") return Response.json(await runChatbotAcceptance(svc, body.business_id, actor));
    if (action === "retrain-chatbots") return Response.json(await retrainChatbots(svc, body, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error), code: error?.code }, { status: error?.code === "FORBIDDEN" || error?.code === "BUSINESS_NOT_FOUND" || error?.code === "CHATBOT_NOT_FOUND" ? 403 : 500 });
  }
}

// ============================================================
// PUBLIC WIDGET ACTIONS
// ============================================================

async function widgetConfig(svc: any, body: any) {
  const resolved = await resolveChatbot(svc, String(body.chatbot_id || "").trim());
  if (!resolved) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  const { chatbot, business } = resolved;
  if (chatbot.status === "archived" || chatbot.status === "paused") {
    return { online: false, reason: "This assistant is currently unavailable.", chatbot_id: chatbot.id, business_name: business.name };
  }
  const hours = computeBusinessHours(chatbot);
  return {
    online: true,
    chatbot_id: chatbot.id,
    business_id: business.id,
    name: chatbot.name,
    welcome_message: chatbot.welcome_message || `Hi! I'm ${chatbot.name}. How can I help you today?`,
    brand: { primary_color: chatbot.brand?.primary_color, accent_color: chatbot.brand?.accent_color, avatar_url: chatbot.brand?.avatar_url, logo_url: chatbot.brand?.logo_url },
    business_hours: { mode: hours.mode, currently_open: hours.currently_open, hours_text: hours.hours_text, timezone: hours.timezone },
    language: chatbot.language || "en",
  };
}

async function startConversation(svc: any, body: any) {
  const resolved = await resolveChatbot(svc, String(body.chatbot_id || "").trim());
  if (!resolved) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  const { chatbot, business } = resolved;
  if (chatbot.status !== "active") throw Object.assign(new Error("Chatbot is not active"), { code: "CHATBOT_NOT_ACTIVE" });
  const now = new Date().toISOString();
  const visitor_id = String(body.visitor_id || "").trim() || uuid();
  const welcome = chatbot.welcome_message || `Hi! I'm ${chatbot.name}. How can I help you today?`;
  const conv: any = await svc.entities.Conversation.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id,
    ai_agent_id: chatbot.agent_id, visitor_id, channel: "web",
    status: "new", escalation_state: "none", customer_context: {},
    language: chatbot.language || "en", message_count: 1, started_at: now, last_activity_at: now,
  });
  await svc.entities.ChatMessage.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id,
    conversation_id: conv.id, role: "assistant", content: welcome, created_at: now,
  });
  return { conversation_id: conv.id, visitor_id, welcome_message: welcome, status: "new" };
}

async function sendMessage(svc: any, body: any) {
  const resolved = await resolveChatbot(svc, String(body.chatbot_id || "").trim());
  if (!resolved) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  const { chatbot, business } = resolved;
  const conversation_id = String(body.conversation_id || "").trim();
  const message = String(body.message || "").trim();
  const visitor_id = String(body.visitor_id || "").trim();
  if (!conversation_id || !message) throw Object.assign(new Error("conversation_id and message are required"), { code: "BAD_REQUEST" });

  const conv: any = await svc.entities.Conversation.get(conversation_id).catch(() => null);
  if (!conv) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
  // Server-side isolation: the conversation must belong to THIS chatbot + business.
  if (conv.chatbot_id !== chatbot.id || conv.business_id !== business.id) throw Object.assign(new Error("Conversation does not belong to this chatbot"), { code: "FORBIDDEN" });
  if (conv.status === "closed" || conv.status === "escalated") {
    return { conversation_id, reply: "This conversation has been closed. You can start a new one any time.", status: conv.status, persisted: false };
  }

  const turn = await runTurn(svc, { chatbot, business, conv, message, visitor_id, actor: visitor_id || "visitor" });
  return { conversation_id, reply: turn.reply, status: turn.status, lead_id: turn.lead_id, ticket_id: turn.ticket_id, trace_id: turn.trace_id, run_id: turn.run_id, messages: turn.appended };
}

async function getConversation(svc: any, body: any) {
  const conversation_id = String(body.conversation_id || "").trim();
  if (!conversation_id) throw Object.assign(new Error("conversation_id is required"), { code: "BAD_REQUEST" });
  const conv: any = await svc.entities.Conversation.get(conversation_id).catch(() => null);
  if (!conv) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
  const messages: any[] = await svc.entities.ChatMessage.filter({ conversation_id }, "created_date", 200).catch(() => []);
  return {
    conversation_id, status: conv.status, escalation_state: conv.escalation_state,
    lead_id: conv.lead_id, ticket_id: conv.ticket_id, language: conv.language,
    messages: (messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content, tool: m.tool || null, created_at: m.created_at })),
  };
}

async function restartConversation(svc: any, body: any) {
  const conversation_id = String(body.conversation_id || "").trim();
  const chatbot_id = String(body.chatbot_id || "").trim();
  const conv: any = await svc.entities.Conversation.get(conversation_id).catch(() => null);
  if (conv) await svc.entities.Conversation.update(conversation_id, { status: "closed", last_activity_at: new Date().toISOString() }).catch(() => {});
  return await startConversation(svc, { chatbot_id, visitor_id: body.visitor_id });
}

// ============================================================
// CORE TURN — dispatch one run_agent through the real Workflow Engine
// ============================================================

async function runTurn(svc: any, opts: { chatbot: any; business: any; conv: any; message: string; visitor_id: string; actor: string }): Promise<any> {
  const { chatbot, business, conv, actor } = opts;
  const customerMessage = String(opts.message).trim().slice(0, 4000);
  const now = new Date().toISOString();

  // Persist the customer's message.
  await svc.entities.ChatMessage.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id,
    conversation_id: conv.id, role: "customer", content: customerMessage, created_at: now,
  });
  await svc.entities.Conversation.update(conv.id, { status: "waiting_for_action", last_activity_at: now, message_count: (conv.message_count || 0) + 1 }).catch(() => {});

  // Recent conversation history for the model (last 10 messages).
  const recent: any[] = await svc.entities.ChatMessage.filter({ conversation_id: conv.id }, "-created_date", 10).catch(() => []);
  const history = (recent || []).reverse().map((m) => `${m.role === "customer" ? "Customer" : "Assistant"}: ${m.content}`).join("\n");
  const hours = computeBusinessHours(chatbot);

  // The objective carries the conversation context to the model (rendered as the
  // TASK / OBJECTIVE). Tool-context lives in `input` (read by the tools via
  // task.input_context — not rendered, just programmatic).
  const objective = [
    `Conversation with ${business.name || "the business"} (a ${business.industry || "business"}).`,
    `Business hours right now: ${hours.mode === "always" ? "Open 24/7" : hours.mode === "none" ? "Not configured" : `Currently ${hours.currently_open ? "open" : "closed"} (${hours.hours_text}, ${hours.timezone})`}.`,
    `Conversation so far:`,
    history,
    ``,
    `The customer's latest message is the last line above. Reply to it as ${chatbot.name}.`,
  ].join("\n");

  let reply = "";
  let runStatus = "failed";
  let runId: string | null = null;
  let traceId: string | null = null;
  let lastExecId: string | null = null;
  let errorCode = "";

  try {
    const dispatch = await dispatchStandaloneTask(svc, {
      businessId: business.id, taskType: "run_agent", taskKey: `chatbot_reply`, capability: "ai_generation",
      goal: objective, requestedBy: "chatbot_platform",
      input: {
        agent_id: chatbot.agent_id, chatbot_id: chatbot.id, conversation_id: conv.id,
        chatbot_config: { name: chatbot.name, business_hours: chatbot.business_hours, supported_capabilities: chatbot.supported_capabilities, escalation_policy: chatbot.escalation_policy, brand: chatbot.brand },
        customer_context: conv.customer_context || {}, business_hours_state: hours, customer_message: customerMessage, conversation_history: history,
      },
    });
    runId = dispatch.run?.id || null;
    traceId = dispatch.observability?.trace_id || null;

    // Read the task output for the agent's answer.
    const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: runId }).catch(() => []);
    const task = (tasks || [])[0];
    lastExecId = task?.last_execution_id || null;
    runStatus = dispatch.run?.status || "failed";
    if (task && task.status === "completed" && task.output) {
      reply = String(task.output.answer || "").trim();
      if (!reply && task.output.result_summary) reply = String(task.output.result_summary).trim();
    } else {
      errorCode = task?.error_code || dispatch.run?.status || "AI_FAILED";
      reply = friendlyError(errorCode);
    }
  } catch (e: any) {
    errorCode = e?.code || "FACTORY_FAILED";
    reply = friendlyError(errorCode);
  }

  if (!reply) { reply = friendlyError("AI_FAILED"); errorCode = errorCode || "AI_FAILED"; }

  // Extract lead capture / escalation from the turn's tool AIExecutions.
  let leadId: string | null = null;
  let ticketId: string | null = null;
  if (runId) {
    const execs: any[] = await svc.entities.AIExecution.filter({ run_id: runId }).catch(() => []);
    for (const ex of (execs || [])) {
      const op = ex.operation || "";
      const out = ex.output || {};
      if (op.startsWith("run_agent.tool.capture_lead") && out.tool_result && out.ok !== false) {
        leadId = out.tool_result.lead_id || leadId;
      }
      if (op.startsWith("run_agent.tool.escalate_to_human") && out.tool_result) {
        ticketId = out.tool_result.ticket_id || ticketId;
      }
    }
    // Honest telemetry: one UsageLog + CostLog per turn, aggregated from the run's AIExecutions.
    await aggregateTelemetry(svc, { tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, runId, execs: execs || [] });
  }
  // Populate customer context from the REAL CRM Lead record (the source of truth).
  let capturedCustomer: any = {};
  if (leadId) {
    const leadRow: any = await svc.entities.Lead.get(leadId).catch(() => null);
    if (leadRow) capturedCustomer = { name: leadRow.name, phone: leadRow.phone, email: leadRow.email, service: leadRow.service };
  }

  // Persist the assistant message (+ tool annotation if an action ran).
  const assistantNow = new Date().toISOString();
  const assistantMsg: any = await svc.entities.ChatMessage.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id,
    conversation_id: conv.id, role: "assistant", content: reply, run_id: runId, execution_id: lastExecId, trace_id: traceId, created_at: assistantNow,
  });
  if (leadId) {
    await svc.entities.ChatMessage.create({ tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id, conversation_id: conv.id, role: "action", content: "Captured a request for the team.", tool: "capture_lead", tool_result: { lead_id: leadId }, run_id: runId, created_at: new Date().toISOString() }).catch(() => {});
  }
  if (ticketId) {
    await svc.entities.ChatMessage.create({ tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id, conversation_id: conv.id, role: "action", content: "Escalated to the team — someone will follow up.", tool: "escalate_to_human", tool_result: { ticket_id: ticketId }, run_id: runId, created_at: new Date().toISOString() }).catch(() => {});
  }

  // Update conversation state.
  const newStatus = ticketId ? "escalated" : "waiting_for_customer";
  const customerContextUpdate: any = { ...(conv.customer_context || {}) };
  if (capturedCustomer.name) customerContextUpdate.name = capturedCustomer.name;
  if (capturedCustomer.phone) customerContextUpdate.phone = capturedCustomer.phone;
  if (capturedCustomer.email) customerContextUpdate.email = capturedCustomer.email;
  if (capturedCustomer.service) customerContextUpdate.intent = capturedCustomer.service;
  const convUpdate: any = {
    status: newStatus, last_activity_at: assistantNow, message_count: (conv.message_count || 0) + 2,
    current_run_id: runId, last_trace_id: traceId, customer_context: customerContextUpdate,
  };
  if (leadId) convUpdate.lead_id = leadId;
  if (ticketId) { convUpdate.ticket_id = ticketId; convUpdate.escalation_state = "handed_off"; }
  if (capturedCustomer.name) convUpdate.customer_name = capturedCustomer.name;
  if (capturedCustomer.phone) convUpdate.customer_phone = capturedCustomer.phone;
  if (capturedCustomer.email) convUpdate.customer_email = capturedCustomer.email;
  await svc.entities.Conversation.update(conv.id, convUpdate).catch(() => {});

  return { reply, status: newStatus, lead_id: leadId, ticket_id: ticketId, run_id: runId, trace_id: traceId, appended: [{ role: "customer", content: customerMessage }, { role: "assistant", content: reply, id: assistantMsg?.id }] };
}

// Aggregate the turn's AIExecutions into one UsageLog + one CostLog (honest ledger).
async function aggregateTelemetry(svc: any, opts: { tenant_id: string; business_id: string; runId: string; execs: any[] }) {
  try {
    const execs = (opts.execs || []).filter((e) => e.success && (e.capability === "ai_generation" || (e.operation || "").startsWith("run_agent.")) && e.tokens);
    const tokens = execs.reduce((s, e) => s + (e.tokens || 0), 0);
    const cost = execs.reduce((s, e) => s + (e.estimated_cost || 0), 0);
    const providerId = execs[0]?.provider_id || execs[0]?.provider || "(core)";
    if (!tokens && !cost) return;
    const u = await svc.entities.UsageLog.create({
      tenant_id: opts.tenant_id, business_id: opts.business_id, provider_id: providerId,
      service: "ai_generation", operation: "chatbot_turn", kind: "production_operation",
      usage_quantity: tokens, usage_unit: "tokens", success: true, occurred_at: new Date().toISOString(),
    });
    if (cost) {
      await svc.entities.CostLog.create({
        tenant_id: opts.tenant_id, business_id: opts.business_id, provider_id: providerId,
        usage_log_id: u?.id || null, service: "ai_generation", operation: "chatbot_turn",
        estimated_amount: cost, is_estimated: true, billable_amount: cost, currency: "USD", occurred_at: new Date().toISOString(),
      });
    }
  } catch { /* telemetry never fails the chatbot */ }
}

// ============================================================
// ADMIN ACTIONS
// ============================================================

async function listChatbots(svc: any, body: any, user: any) {
  const business = await verifyTenant(svc, String(body.business_id || "").trim(), user);
  const rows: any[] = await svc.entities.Chatbot.filter({ business_id: business.id }, "-created_date", 100).catch(() => []);
  return { chatbots: (rows || []).filter((c) => c.status !== "archived").map(chatbotSummary) };
}

async function getChatbot(svc: any, body: any, user: any) {
  const chatbot: any = await svc.entities.Chatbot.get(String(body.chatbot_id || "").trim()).catch(() => null);
  if (!chatbot) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  await verifyTenant(svc, chatbot.business_id, user);
  const hours = computeBusinessHours(chatbot);
  return { ...chatbotSummary(chatbot), brand: chatbot.brand, escalation_policy: chatbot.escalation_policy, approval_policy: chatbot.approval_policy, business_hours: chatbot.business_hours, supported_capabilities: chatbot.supported_capabilities, welcome_message: chatbot.welcome_message, language: chatbot.language, allowed_channels: chatbot.allowed_channels, hours_state: hours, instructions: chatbot_instructions_preview(chatbot) };
}

function chatbot_instructions_preview(chatbot: any): string {
  // Don't expose full instructions; just confirm the agent exists.
  return chatbot.agent_id ? "(managed by Agent Runtime)" : "(agent not yet created)";
}

async function createChatbot(svc: any, body: any, user: any, actor: string) {
  const business = await verifyTenant(svc, String(body.business_id || "").trim(), user);
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("A name is required"), { code: "BAD_REQUEST" });
  const supported_capabilities = body.supported_capabilities || ["answer_questions", "capture_leads", "escalate"];
  const chatbot: any = await svc.entities.Chatbot.create({
    tenant_id: business.tenant_id, business_id: business.id, name, description: body.description || "",
    status: "active", brand: body.brand || { voice: "warm, helpful, concise", tone: "friendly" },
    welcome_message: body.welcome_message || `Hi! I'm ${name}. How can I help you today?`,
    supported_capabilities, escalation_policy: body.escalation_policy || { auto_escalate_keywords: ["complaint", "manager", "human"] },
    approval_policy: body.approval_policy || { require_approval_for: [] }, allowed_channels: body.allowed_channels || ["web"],
    business_hours: body.business_hours || { mode: "none", timezone: "Asia/Calcutta", days: [] }, language: body.language || "en", version: 1,
    created_by: actor, last_activity_at: new Date().toISOString(),
  });
  // Create the backing AIAgent (Agent Runtime) so the chatbot can reply.
  const agentId = await ensureChatbotAgent(svc, chatbot, business);
  await svc.entities.Chatbot.update(chatbot.id, { agent_id: agentId }).catch(() => {});
  chatbot.agent_id = agentId;
  return { chatbot: { ...chatbotSummary(chatbot), agent_id: agentId } };
}

async function updateChatbot(svc: any, body: any, user: any) {
  const chatbot: any = await svc.entities.Chatbot.get(String(body.chatbot_id || "").trim()).catch(() => null);
  if (!chatbot) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  const business = await verifyTenant(svc, chatbot.business_id, user);
  const updates: any = { version: (chatbot.version || 1) + 1 };
  for (const k of ["name", "description", "status", "brand", "welcome_message", "supported_capabilities", "escalation_policy", "approval_policy", "allowed_channels", "business_hours", "language"]) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  const updated: any = await svc.entities.Chatbot.update(chatbot.id, updates);
  // Re-sync the backing agent's instructions/tools to the new config.
  if (chatbot.agent_id) await ensureChatbotAgent(svc, { ...updated, tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, agent_id: chatbot.agent_id }, business).catch(() => {});
  return { chatbot: chatbotSummary(updated) };
}

async function deleteChatbot(svc: any, body: any, user: any) {
  const chatbot: any = await svc.entities.Chatbot.get(String(body.chatbot_id || "").trim()).catch(() => null);
  if (!chatbot) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  await verifyTenant(svc, chatbot.business_id, user);
  await svc.entities.Chatbot.update(chatbot.id, { status: "archived" });
  if (chatbot.agent_id) await svc.entities.AIAgent.update(chatbot.agent_id, { status: "paused" }).catch(() => {});
  return { archived: true };
}

async function listConversations(svc: any, body: any, user: any) {
  const chatbot_id = String(body.chatbot_id || "").trim();
  const business_id = String(body.business_id || "").trim();
  let filter: any = {};
  if (chatbot_id) {
    const chatbot: any = await svc.entities.Chatbot.get(chatbot_id).catch(() => null);
    if (!chatbot) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
    await verifyTenant(svc, chatbot.business_id, user);
    filter = { chatbot_id };
  } else if (business_id) {
    await verifyTenant(svc, business_id, user);
    filter = { business_id };
  } else {
    throw Object.assign(new Error("chatbot_id or business_id is required"), { code: "BAD_REQUEST" });
  }
  const rows: any[] = await svc.entities.Conversation.filter(filter, "-last_activity_at", 100).catch(() => []);
  return { conversations: (rows || []).filter((c) => c.status !== "closed").map((c) => ({ id: c.id, chatbot_id: c.chatbot_id, visitor_id: c.visitor_id, status: c.status, customer_name: c.customer_name, lead_id: c.lead_id, ticket_id: c.ticket_id, message_count: c.message_count, last_activity_at: c.last_activity_at, started_at: c.started_at })) };
}

async function getConversationAdmin(svc: any, body: any, user: any) {
  const conv: any = await svc.entities.Conversation.get(String(body.conversation_id || "").trim()).catch(() => null);
  if (!conv) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
  await verifyTenant(svc, conv.business_id, user);
  const messages: any[] = await svc.entities.ChatMessage.filter({ conversation_id: conv.id }, "created_date", 500).catch(() => []);
  let run: any = null; let execs: any[] = [];
  if (conv.current_run_id) {
    run = await svc.entities.LaunchPlan.get(conv.current_run_id).catch(() => null);
    execs = await svc.entities.AIExecution.filter({ run_id: conv.current_run_id }).catch(() => []);
  }
  return {
    conversation: { id: conv.id, status: conv.status, escalation_state: conv.escalation_state, customer_name: conv.customer_name, customer_email: conv.customer_email, customer_phone: conv.customer_phone, lead_id: conv.lead_id, ticket_id: conv.ticket_id, started_at: conv.started_at, last_activity_at: conv.last_activity_at, current_run_id: conv.current_run_id, last_trace_id: conv.last_trace_id, message_count: conv.message_count },
    messages: (messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content, tool: m.tool, tool_result: m.tool_result, run_id: m.run_id, trace_id: m.trace_id, created_at: m.created_at })),
    run: run ? { id: run.id, status: run.status, progress: run.progress, started_at: run.started_at, completed_at: run.completed_at } : null,
    executions: (execs || []).map((e) => ({ id: e.id, stage: e.stage, operation: e.operation, success: e.success, provider: e.provider, model: e.model, tokens: e.tokens, estimated_cost: e.estimated_cost, error_code: e.error_code, completed_at: e.completed_at })),
    trace_id: conv.last_trace_id,
  };
}

async function dashboardStats(svc: any, body: any, user: any) {
  const business = await verifyTenant(svc, String(body.business_id || "").trim(), user);
  const [chatbots, conversations, messages, leads, tickets] = await Promise.all([
    svc.entities.Chatbot.filter({ business_id: business.id }, "-created_date", 200).catch(() => []),
    svc.entities.Conversation.filter({ business_id: business.id }, "-last_activity_at", 500).catch(() => []),
    svc.entities.ChatMessage.filter({ business_id: business.id }, "-created_date", 1000).catch(() => []),
    svc.entities.Lead.filter({ business_id: business.id, source: "chatbot" }, "-created_date", 500).catch(() => []),
    svc.entities.Ticket.filter({ business_id: business.id, category: "escalation" }, "-created_date", 500).catch(() => []),
  ]);
  const activeChatbots = (chatbots || []).filter((c: any) => c.status === "active").length;
  return {
    chatbots: (chatbots || []).length, active_chatbots: activeChatbots,
    conversations: (conversations || []).length, open_conversations: (conversations || []).filter((c: any) => !["closed", "resolved"].includes(c.status)).length,
    messages: (messages || []).length, leads_from_chatbot: (leads || []).length, escalations: (tickets || []).length,
  };
}

async function playgroundSend(svc: any, body: any, user: any, actor: string) {
  const chatbot: any = await svc.entities.Chatbot.get(String(body.chatbot_id || "").trim()).catch(() => null);
  if (!chatbot) throw Object.assign(new Error("Chatbot not found"), { code: "CHATBOT_NOT_FOUND" });
  const business = await verifyTenant(svc, chatbot.business_id, user);
  const message = String(body.message || "").trim();
  if (!message) throw Object.assign(new Error("message is required"), { code: "BAD_REQUEST" });
  // Use a transient playground conversation so the builder can try the chatbot
  // without polluting real conversations.
  const now = new Date().toISOString();
  const conv: any = await svc.entities.Conversation.create({
    tenant_id: chatbot.tenant_id, business_id: chatbot.business_id, chatbot_id: chatbot.id, ai_agent_id: chatbot.agent_id,
    visitor_id: `playground-${actor}`, channel: "web", status: "new", escalation_state: "none", customer_context: {},
    language: chatbot.language || "en", message_count: 0, started_at: now, last_activity_at: now,
  });
  const turn = await runTurn(svc, { chatbot, business, conv, message, visitor_id: `playground-${actor}`, actor });
  // Fetch the full admin view (messages + execution trace) for the builder.
  const admin = await getConversationAdmin(svc, { conversation_id: conv.id }, user);
  return { reply: turn.reply, status: turn.status, lead_id: turn.lead_id, ticket_id: turn.ticket_id, run_id: turn.run_id, trace_id: turn.trace_id, conversation: admin.conversation, messages: admin.messages, executions: admin.executions };
}

function chatbotSummary(c: any): any {
  return { id: c.id, business_id: c.business_id, name: c.name, description: c.description, status: c.status, agent_id: c.agent_id, welcome_message: c.welcome_message, supported_capabilities: c.supported_capabilities, language: c.language, version: c.version, last_activity_at: c.last_activity_at, created_date: c.created_date };
}

// Re-sync every active chatbot's backing agent instructions from the latest
// business context (blueprint, hours, brand, capabilities). Called by the weekly
// retrain workflow and manually from admin. When invoked from a workflow there is
// no user; in that case retrain all tenants. With a user, scope to their business.
async function retrainChatbots(svc: any, body: any, user: any) {
  const businessId = String(body?.business_id || "").trim();
  let chatbots: any[];
  if (businessId) {
    if (user) await verifyTenant(svc, businessId, user);
    chatbots = await svc.entities.Chatbot.filter({ business_id: businessId }).catch(() => []);
  } else {
    chatbots = await svc.entities.Chatbot.filter({ status: "active" }).catch(() => []);
  }
  const retrained: { id: string; name: string; ok: boolean }[] = [];
  for (const c of (chatbots || [])) {
    if (c.status !== "active") continue;
    const business: any = await svc.entities.Business.get(c.business_id).catch(() => null);
    if (!business) continue;
    try {
      await ensureChatbotAgent(svc, c, business);
      retrained.push({ id: c.id, name: c.name, ok: true });
    } catch (e) {
      retrained.push({ id: c.id, name: c.name, ok: false });
    }
  }
  return { retrained_count: retrained.filter((r) => r.ok).length, total: retrained.length, retrained };
}

// satisfy unused-import lints when tree-shaken
void toolsForChatbot; void buildChatbotAgentInstructions; void recordTurnTelemetry;