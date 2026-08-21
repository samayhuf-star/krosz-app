// Worldz Visa — Phase 12: Notification template + rule catalog (§22/§58).
// Idempotent upsert by template_code/language and rule_code. Admin-seeded set
// covers the canonical events; each event resolves to one template per channel.

const TEMPLATES: any[] = [
  { template_code: "APPLICATION_CREATED_IN_APP", channel: "IN_APP", subject: "", body: "Your {{destination}} visa application has been started. Application #{{application.number}}.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "APPLICATION_CREATED_EMAIL", channel: "EMAIL", subject: "Your {{destination}} visa application has started", body: "Hi {{traveler.first_name}}, your {{destination}} visa application (#{{application.number}}) has been created. We'll guide you through every step.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "DOCUMENT_REQUIRED_IN_APP", channel: "IN_APP", subject: "", body: "Please upload your {{document_label}} to continue your application.", variables: ["traveler.first_name", "document_label", "application.number"] },
  { template_code: "DOCUMENT_REQUIRED_EMAIL", channel: "EMAIL", subject: "Action required: upload your {{document_label}}", body: "Hi {{traveler.first_name}}, we need your {{document_label}} for application #{{application.number}}. Please upload it in the app to continue.", variables: ["traveler.first_name", "document_label", "application.number"] },
  { template_code: "PAYMENT_SUCCESS_IN_APP", channel: "IN_APP", subject: "", body: "Payment successful. Your application can now proceed.", variables: ["traveler.first_name", "application.number"] },
  { template_code: "PAYMENT_SUCCESS_EMAIL", channel: "EMAIL", subject: "Payment successful for your {{destination}} visa", body: "Hi {{traveler.first_name}}, your payment for application #{{application.number}} was successful. We're continuing your {{destination}} visa.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "APPOINTMENT_BOOKED_IN_APP", channel: "IN_APP", subject: "", body: "Your appointment is booked for {{appointment.date}} at {{appointment.location}}.", variables: ["appointment.date", "appointment.location"] },
  { template_code: "APPOINTMENT_BOOKED_EMAIL", channel: "EMAIL", subject: "Your appointment is booked", body: "Hi {{traveler.first_name}}, your appointment for application #{{application.number}} is on {{appointment.date}} at {{appointment.location}}. Please arrive 15 minutes early.", variables: ["traveler.first_name", "application.number", "appointment.date", "appointment.location"] },
  { template_code: "APPOINTMENT_REMINDER_IN_APP", channel: "IN_APP", subject: "", body: "Reminder: your appointment is on {{appointment.date}} at {{appointment.location}}.", variables: ["appointment.date", "appointment.location"] },
  { template_code: "APPOINTMENT_REMINDER_EMAIL", channel: "EMAIL", subject: "Reminder: your appointment is coming up", body: "Hi {{traveler.first_name}}, this is a reminder that your appointment is on {{appointment.date}} at {{appointment.location}}.", variables: ["traveler.first_name", "appointment.date", "appointment.location"] },
  { template_code: "SUBMISSION_SUCCESS_IN_APP", channel: "IN_APP", subject: "", body: "Your application was submitted successfully.", variables: ["application.number"] },
  { template_code: "SUBMISSION_SUCCESS_EMAIL", channel: "EMAIL", subject: "Your {{destination}} visa application was submitted", body: "Hi {{traveler.first_name}}, your application #{{application.number}} was submitted successfully. We'll update you as it's processed.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "SUBMISSION_SUCCESS_SMS", channel: "SMS", subject: "", body: "Worldz Visa: your {{destination}} application #{{application.number}} was submitted. Track it in the app.", variables: ["destination", "application.number"] },
  { template_code: "APPLICATION_PROCESSING_IN_APP", channel: "IN_APP", subject: "", body: "Your application is now being processed.", variables: ["application.number"] },
  { template_code: "APPLICATION_PROCESSING_EMAIL", channel: "EMAIL", subject: "Your {{destination}} visa is being processed", body: "Hi {{traveler.first_name}}, your application #{{application.number}} is now being processed by the visa authority. No action is required from you right now.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "DECISION_RECEIVED_IN_APP", channel: "IN_APP", subject: "", body: "A decision has been received on your application.", variables: ["application.number"] },
  { template_code: "DECISION_RECEIVED_EMAIL", channel: "EMAIL", subject: "Update on your {{destination}} visa application", body: "Hi {{traveler.first_name}}, a decision has been received on your application #{{application.number}}. Open the app to view the result.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "ORDER_CREATED_EMAIL", channel: "EMAIL", subject: "Order created for your {{destination}} visa", body: "Hi {{traveler.first_name}}, an order (#{{order.number}}) was created for your {{destination}} visa application. Complete payment to continue.", variables: ["traveler.first_name", "destination", "order.number"] },
  { template_code: "PAYMENT_INITIATED_EMAIL", channel: "EMAIL", subject: "Payment started for your {{destination}} visa", body: "Hi {{traveler.first_name}}, your payment for application #{{application.number}} is being processed.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "PAYMENT_FAILED_IN_APP", channel: "IN_APP", subject: "", body: "Your last payment failed. Your application is safe — try again when ready.", variables: ["application.number"] },
  { template_code: "PAYMENT_FAILED_EMAIL", channel: "EMAIL", subject: "Your payment failed — your application is safe", body: "Hi {{traveler.first_name}}, the payment for application #{{application.number}} failed. No application information was lost. Try again any time.", variables: ["traveler.first_name", "application.number"] },
  { template_code: "READY_FOR_SUBMISSION_IN_APP", channel: "IN_APP", subject: "", body: "Your application is paid and ready for the next step.", variables: ["application.number"] },
  { template_code: "READY_FOR_SUBMISSION_EMAIL", channel: "EMAIL", subject: "Your {{destination}} visa application is ready for the next step", body: "Hi {{traveler.first_name}}, your application #{{application.number}} is paid and ready. We'll prepare the submission next.", variables: ["traveler.first_name", "destination", "application.number"] },
  { template_code: "REFUND_ISSUED_IN_APP", channel: "IN_APP", subject: "", body: "A refund has been issued for your order.", variables: ["order.number"] },
  { template_code: "GENERAL_IN_APP", channel: "IN_APP", subject: "", body: "{{message}}", variables: ["message"] },
];

const RULES: any[] = [
  { rule_code: "APPLICATION_CREATED_IN_APP", event_type: "APPLICATION_CREATED", channel: "IN_APP", template_code: "APPLICATION_CREATED_IN_APP", category: "application_updates", priority: "INFO" },
  { rule_code: "APPLICATION_CREATED_EMAIL", event_type: "APPLICATION_CREATED", channel: "EMAIL", template_code: "APPLICATION_CREATED_EMAIL", category: "application_updates", priority: "INFO" },
  { rule_code: "DOCUMENTS_STARTED_IN_APP", event_type: "DOCUMENTS_STARTED", channel: "IN_APP", template_code: "DOCUMENT_REQUIRED_IN_APP", category: "document_updates", priority: "ACTION_REQUIRED" },
  { rule_code: "ADDITIONAL_INFO_IN_APP", event_type: "ADDITIONAL_INFORMATION_REQUIRED", channel: "IN_APP", template_code: "DOCUMENT_REQUIRED_IN_APP", category: "document_updates", priority: "ACTION_REQUIRED" },
  { rule_code: "PAYMENT_COMPLETED_IN_APP", event_type: "PAYMENT_COMPLETED", channel: "IN_APP", template_code: "PAYMENT_SUCCESS_IN_APP", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "PAYMENT_COMPLETED_EMAIL", event_type: "PAYMENT_COMPLETED", channel: "EMAIL", template_code: "PAYMENT_SUCCESS_EMAIL", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "APPOINTMENT_BOOKED_IN_APP", event_type: "APPOINTMENT_BOOKED", channel: "IN_APP", template_code: "APPOINTMENT_BOOKED_IN_APP", category: "appointment_reminders", priority: "IMPORTANT" },
  { rule_code: "APPOINTMENT_BOOKED_EMAIL", event_type: "APPOINTMENT_BOOKED", channel: "EMAIL", template_code: "APPOINTMENT_BOOKED_EMAIL", category: "appointment_reminders", priority: "IMPORTANT" },
  { rule_code: "SUBMISSION_COMPLETED_IN_APP", event_type: "SUBMISSION_COMPLETED", channel: "IN_APP", template_code: "SUBMISSION_SUCCESS_IN_APP", category: "application_updates", priority: "IMPORTANT" },
  { rule_code: "SUBMISSION_COMPLETED_EMAIL", event_type: "SUBMISSION_COMPLETED", channel: "EMAIL", template_code: "SUBMISSION_SUCCESS_EMAIL", category: "application_updates", priority: "IMPORTANT" },
  { rule_code: "APPLICATION_PROCESSING_IN_APP", event_type: "APPLICATION_PROCESSING", channel: "IN_APP", template_code: "APPLICATION_PROCESSING_IN_APP", category: "application_updates", priority: "INFO" },
  { rule_code: "APPLICATION_PROCESSING_EMAIL", event_type: "APPLICATION_PROCESSING", channel: "EMAIL", template_code: "APPLICATION_PROCESSING_EMAIL", category: "application_updates", priority: "INFO" },
  { rule_code: "DECISION_RECEIVED_IN_APP", event_type: "DECISION_RECEIVED", channel: "IN_APP", template_code: "DECISION_RECEIVED_IN_APP", category: "application_updates", priority: "CRITICAL" },
  { rule_code: "DECISION_RECEIVED_EMAIL", event_type: "DECISION_RECEIVED", channel: "EMAIL", template_code: "DECISION_RECEIVED_EMAIL", category: "application_updates", priority: "CRITICAL" },
  { rule_code: "ORDER_CREATED_EMAIL", event_type: "ORDER_CREATED", channel: "EMAIL", template_code: "ORDER_CREATED_EMAIL", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "PAYMENT_INITIATED_EMAIL", event_type: "PAYMENT_INITIATED", channel: "EMAIL", template_code: "PAYMENT_INITIATED_EMAIL", category: "payment_updates", priority: "INFO" },
  { rule_code: "PAYMENT_INITIATED_IN_APP", event_type: "PAYMENT_INITIATED", channel: "IN_APP", template_code: "PAYMENT_SUCCESS_IN_APP", category: "payment_updates", priority: "INFO" },
  { rule_code: "PAYMENT_FAILED_IN_APP", event_type: "PAYMENT_FAILED", channel: "IN_APP", template_code: "PAYMENT_FAILED_IN_APP", category: "payment_updates", priority: "ACTION_REQUIRED" },
  { rule_code: "PAYMENT_FAILED_EMAIL", event_type: "PAYMENT_FAILED", channel: "EMAIL", template_code: "PAYMENT_FAILED_EMAIL", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "PAYMENT_SUCCESSFUL_IN_APP", event_type: "PAYMENT_SUCCESSFUL", channel: "IN_APP", template_code: "PAYMENT_SUCCESS_IN_APP", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "PAYMENT_SUCCESSFUL_EMAIL", event_type: "PAYMENT_SUCCESSFUL", channel: "EMAIL", template_code: "PAYMENT_SUCCESS_EMAIL", category: "payment_updates", priority: "IMPORTANT" },
  { rule_code: "READY_FOR_SUBMISSION_IN_APP", event_type: "READY_FOR_SUBMISSION", channel: "IN_APP", template_code: "READY_FOR_SUBMISSION_IN_APP", category: "application_updates", priority: "IMPORTANT" },
  { rule_code: "READY_FOR_SUBMISSION_EMAIL", event_type: "READY_FOR_SUBMISSION", channel: "EMAIL", template_code: "READY_FOR_SUBMISSION_EMAIL", category: "application_updates", priority: "IMPORTANT" },
];

export async function ensureTemplateCatalog(svc: any): Promise<void> {
  for (const t of TEMPLATES) {
    const rows: any[] = await svc.entities.VisaNotificationTemplate.filter({ template_code: t.template_code, language: "en" }).catch(() => []);
    if (rows && rows.length) {
      await svc.entities.VisaNotificationTemplate.update(rows[0].id, { ...t, language: "en", status: "ACTIVE" }).catch(() => {});
    } else {
      await svc.entities.VisaNotificationTemplate.create({ ...t, language: "en", version: "v1", status: "ACTIVE" }).catch(() => {});
    }
  }
}

export async function ensureRuleCatalog(svc: any): Promise<void> {
  for (const r of RULES) {
    const rows: any[] = await svc.entities.VisaNotificationRule.filter({ rule_code: r.rule_code }).catch(() => []);
    if (rows && rows.length) {
      await svc.entities.VisaNotificationRule.update(rows[0].id, { ...r, enabled: true }).catch(() => {});
    } else {
      await svc.entities.VisaNotificationRule.create({ ...r, enabled: true, metadata: {} }).catch(() => {});
    }
  }
}

// Resolve enabled rules for an event_type.
export async function rulesForEvent(svc: any, eventType: string): Promise<any[]> {
  const rows: any[] = await svc.entities.VisaNotificationRule.filter({ event_type: eventType, enabled: true }).catch(() => []);
  return rows || [];
}

export async function templateByCode(svc: any, code: string, language = "en"): Promise<any> {
  const rows: any[] = await svc.entities.VisaNotificationTemplate.filter({ template_code: code, language }).catch(() => []);
  if (rows && rows.length) return rows[0];
  // Language fallback to English (§24).
  if (language !== "en") {
    const en: any[] = await svc.entities.VisaNotificationTemplate.filter({ template_code: code, language: "en" }).catch(() => []);
    if (en && en.length) return en[0];
  }
  return null;
}