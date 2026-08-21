// Worldz Visa (Phase 10) — Payments, Pricing, Orders & Refunds.
//
// Provider-neutral financial layer mirroring the Phase 8/9 architecture: the
// VisaApplication, orchestrator, and products are NEVER changed by a payment
// provider. A provider owns ONLY external payment interaction and returns
// normalized results.
//
// Invariants (spec §§1-58):
//   - Money is INTEGER minor units (§26). No floating-point arithmetic.
//   - Pricing is CONFIGURATION on VisaPrice (§6/§7); Orders SNAPSHOT it (§8).
//   - Historical orders never recalculate from the catalog (§8/§56).
//   - Payments belong to ORDERS, not VisaApplications (§3/§12); the application
//     only knows payment_required/paid_at (§21), it never owns the payment.
//   - Pay is DANGEROUS: idempotent by order_id + op + attempt (§16/§47/§52).
//   - Webhooks are AUTHORITATIVE for payment status (§17/§18); the browser never
//     authoritatively marks an order paid.
//   - Refunds are separate transactions with their own state machine (§31/§32);
//     an operator click never immediately marks COMPLETED.
//   - The orchestrator REACTS to payment state; it never owns payment processing.
//   - Price tampering from the frontend is rejected (§49/§50); the backend
//     recalculates authoritative values.

import type { ProviderContext } from "../../providers/types.ts";
import { djb2, stable } from "../../operations/idempotency.ts";

// ---------- Capabilities (§14) ----------
export type PaymentCapability =
  | "CREATE_CHECKOUT"
  | "AUTHORIZE"
  | "CAPTURE"
  | "REFUND"
  | "STATUS";

export const ALL_PAYMENT_CAPABILITIES: PaymentCapability[] = [
  "CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS",
];

// ---------- Product / price / order statuses (§5/§6/§9) ----------
export type ProductStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
export type PriceStatus = "active" | "archived";
export type RefundPolicy = "FULLY_REFUNDABLE" | "PARTIALLY_REFUNDABLE" | "NON_REFUNDABLE" | "OPERATOR_REVIEW";
export type PaymentGate = "NO_PAYMENT_REQUIRED" | "PAYMENT_BEFORE_APPLICATION" | "PAYMENT_BEFORE_PROCESSING" | "PAYMENT_BEFORE_SUBMISSION";

export type OrderStatus =
  | "DRAFT" | "PENDING_PAYMENT" | "PAID" | "PARTIALLY_PAID"
  | "FAILED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED"
  | "PARTIALLY_REFUNDED" | "COMPLETED";

export const ORDER_STATUSES: OrderStatus[] = [
  "DRAFT", "PENDING_PAYMENT", "PAID", "PARTIALLY_PAID",
  "FAILED", "CANCELLED", "REFUND_PENDING", "REFUNDED",
  "PARTIALLY_REFUNDED", "COMPLETED",
];

export type PaymentStatus =
  | "CREATED" | "PENDING" | "AUTHORIZED" | "SUCCEEDED"
  | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export type PaymentAttemptStatus =
  | "CREATED" | "PENDING" | "AUTHORIZED" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type RefundStatus = "REQUESTED" | "APPROVED" | "PROCESSING" | "COMPLETED" | "FAILED" | "REJECTED";
export type RefundType = "FULL" | "PARTIAL";
export type RefundReason =
  | "CUSTOMER_REQUEST" | "APPLICATION_CANCELLED" | "DUPLICATE_PAYMENT"
  | "PROVIDER_FAILURE" | "OPERATOR_ADJUSTMENT" | "OTHER";

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID" | "REFUNDED";

// ---------- Price components (§7) ----------
export type PriceComponentType =
  | "GOVERNMENT_FEE" | "SERVICE_FEE" | "PROCESSING_FEE"
  | "APPOINTMENT_FEE" | "COURIER_FEE" | "DOCUMENT_SERVICE_FEE"
  | "OPTIONAL_SERVICE" | "TAX" | "DISCOUNT";

export interface PriceComponent {
  type: PriceComponentType;
  code: string;
  label: string;
  amount_minor: number;
  government_fee_basis?: "included" | "estimated" | "variable" | "unknown";
  refundable?: boolean;
}

// ---------- Normalized provider errors (§48) ----------
export type FailureCategory =
  | "CARD_DECLINED" | "INSUFFICIENT_FUNDS" | "AUTHENTICATION_FAILED"
  | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "PAYMENT_EXPIRED" | "UNKNOWN";

export function normalizeFailure(errorCode?: string): FailureCategory {
  const c = String(errorCode || "").toUpperCase();
  if (["CARD_DECLINED", "DECLINED", "DO_NOT_HONOR"].includes(c)) return "CARD_DECLINED";
  if (["INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS"].includes(c)) return "INSUFFICIENT_FUNDS";
  if (["AUTHENTICATION_FAILED", "AUTH_FAILURE", "3DS_FAILED", "SCA_REQUIRED"].includes(c)) return "AUTHENTICATION_FAILED";
  if (["PROVIDER_UNAVAILABLE", "UNAVAILABLE", "NETWORK", "5XX", "TIMEOUT"].includes(c)) return "PROVIDER_UNAVAILABLE";
  if (["RATE_LIMIT", "RATE_LIMITED", "429"].includes(c)) return "RATE_LIMITED";
  if (["PAYMENT_EXPIRED", "EXPIRED", "SESSION_EXPIRED"].includes(c)) return "PAYMENT_EXPIRED";
  return "UNKNOWN";
}

// ---------- Provider-facing request (§18) ----------
export interface CheckoutRequest {
  order_id: string;
  order_number: string;
  amount_minor: number;
  currency: string;
  idempotency_key: string;
  traveler?: { first_name?: string; last_name?: string; email?: string };
  application_id: string;
  environment: "sandbox" | "production";
  line_items?: Array<{ type: PriceComponentType; code: string; label: string; amount_minor: number }>;
}

export interface CheckoutResult {
  success: boolean;
  provider_payment_id?: string;
  checkout_url?: string;
  status?: PaymentStatus;
  error_code?: string;
  error_message?: string;
  response_metadata?: Record<string, any>;
}

export interface StatusResult {
  success: boolean;
  status?: PaymentStatus;
  error_code?: string;
  response_metadata?: Record<string, any>;
}

export interface CaptureResult {
  success: boolean;
  status?: PaymentStatus;
  provider_payment_id?: string;
  error_code?: string;
  response_metadata?: Record<string, any>;
}

export interface RefundRequest {
  provider_payment_id: string;
  amount_minor: number;
  currency: string;
  reason?: string;
  type?: RefundType;
  idempotency_key: string;
}

export interface RefundResult {
  success: boolean;
  provider_refund_id?: string;
  status?: RefundStatus;
  amount_minor?: number;
  error_code?: string;
  error_message?: string;
  response_metadata?: Record<string, any>;
}

// ---------- Provider adapter contract (§14) ----------
// Reuses ProviderContext/credentials from the platform provider registry.
export interface PaymentProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly providerType: string;
  readonly capabilities: PaymentCapability[];
  getCapabilities(ctx: ProviderContext): PaymentCapability[];
  createCheckout(ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutResult>;
  capture?(ctx: ProviderContext, opts: { provider_payment_id: string; idempotency_key: string }): Promise<CaptureResult>;
  getStatus(ctx: ProviderContext, opts: { provider_payment_id: string }): Promise<StatusResult>;
  refund(ctx: ProviderContext, req: RefundRequest): Promise<RefundResult>;
  cancel?(ctx: ProviderContext, opts: { provider_payment_id: string }): Promise<{ success: boolean; error_code?: string }>;
  // Optional: verify an inbound webhook signature + return the normalized event
  // the engine should process. Never trusts the raw payload beyond verification.
  verifyWebhook?(ctx: ProviderContext, headers: Record<string, string>, rawBody: string): { verified: boolean; event?: ProviderWebhookEvent; error_code?: string };
}

export interface ProviderWebhookEvent {
  provider_payment_id: string;
  status: PaymentStatus;
  amount_minor?: number;
  event_id: string;
  event_type?: string;
  received_at?: string;
}

// ---------- Idempotency (§16) ----------
export function paymentIdempotencyKey(orderId: string, op: string, attempt: number): string {
  return `payment|${orderId}|${op}|${attempt}|${djb2(stable({ orderId, op, attempt }))}`;
}

export function refundIdempotencyKey(orderId: string, paymentId: string, attempt: number): string {
  return `refund|${orderId}|${paymentId}|${attempt}|${djb2(stable({ orderId, paymentId, attempt }))}`;
}

// ---------- Paid-service gate (§22/§23) ----------
export type PaidService =
  | "application_create"
  | "form_generation"
  | "processing"
  | "submission"
  | "appointment";

// Which gate blocks which service. Called from the engine only; never in the UI.
export function serviceRequiresGate(service: PaidService, gate: PaymentGate): boolean {
  switch (gate) {
    case "NO_PAYMENT_REQUIRED": return false;
    case "PAYMENT_BEFORE_APPLICATION": return ["application_create", "form_generation", "processing", "submission", "appointment"].includes(service);
    case "PAYMENT_BEFORE_PROCESSING": return ["processing", "submission", "appointment"].includes(service);
    case "PAYMENT_BEFORE_SUBMISSION": return ["submission", "appointment"].includes(service);
    default: return false;
  }
}