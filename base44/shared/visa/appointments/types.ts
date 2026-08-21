// Worldz Visa (Phase 9) — Appointment + VAC/Embassy Operations.
//
// Provider-neutral appointment layer mirroring the Phase 8 submission architecture:
// the VisaApplication, requirements, documents, and orchestrator core are NEVER
// changed by a provider. A provider owns ONLY external-system interaction and
// returns normalized results.
//
// Invariants (spec §§1-57):
//   - Appointment REQUIREMENT is derived deterministically from pinned visa
//     requirements + submission route + provider capabilities. No LLM, no
//     hard-coded country logic in the UI (§12).
//   - Provider SELECTION is deterministic (route → provider with the needed
//     appointment capability). No LLM selection (§11).
//   - Booking is DANGEROUS: book() is idempotent by application_id +
//     appointment_requirement_id + slot_id. Calling twice must NOT create two
//     external bookings (§19/§47).
//   - Slots EXPIRE: expires_at governs validity; the engine REVALIDATES a slot
//     before booking. A displayed slot is never assumed available (§16).
//   - Timezone-aware: scheduled_at_utc + location_timezone; display in the
//     location's TZ, never the browser's alone (§23).
//   - Reschedule preserves history via AppointmentEvent; the old booking is
//     recorded, never overwritten (§24/§48).
//   - Confirmation documents live in the Document Vault (document_type =
//     APPOINTMENT_CONFIRMATION), never a second storage system (§21/§49).
//   - Payment is OUT OF SCOPE of the appointment engine: a PAYMENT_REQUIRED
//     status hands off to the existing payment subsystem (§43).

import type { ProviderContext } from "../../providers/types.ts";
import { djb2, stable } from "../../operations/idempotency.ts";

// ---------- Capabilities (§9) ----------
export type AppointmentCapability =
  | "APPOINTMENT_SEARCH"
  | "APPOINTMENT_HOLD"
  | "APPOINTMENT_BOOK"
  | "APPOINTMENT_CANCEL"
  | "APPOINTMENT_RESCHEDULE"
  | "APPOINTMENT_STATUS"
  | "LOCATION_LIST"
  | "SLOT_LIST";

export const ALL_APPOINTMENT_CAPABILITIES: AppointmentCapability[] = [
  "APPOINTMENT_SEARCH", "APPOINTMENT_HOLD", "APPOINTMENT_BOOK",
  "APPOINTMENT_CANCEL", "APPOINTMENT_RESCHEDULE", "APPOINTMENT_STATUS",
  "LOCATION_LIST", "SLOT_LIST",
];

// ---------- Appointment types (§5) ----------
export type AppointmentType =
  | "BIOMETRICS" | "INTERVIEW" | "DOCUMENT_SUBMISSION"
  | "PASSPORT_SUBMISSION" | "PASSPORT_COLLECTION" | "OTHER";

export const APPOINTMENT_TYPES: AppointmentType[] = [
  "BIOMETRICS", "INTERVIEW", "DOCUMENT_SUBMISSION",
  "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION", "OTHER",
];

// ---------- Requirement + appointment statuses (§4/§6) ----------
export type RequirementStatus = "REQUIRED" | "NOT_REQUIRED" | "WAIVED" | "COMPLETED";
export type AppointmentStatus =
  | "REQUIRED" | "SEARCHING" | "AVAILABLE" | "BOOKING"
  | "BOOKED" | "RESCHEDULE_REQUIRED" | "CANCELLED"
  | "COMPLETED" | "NO_SHOW" | "FAILED";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "REQUIRED", "SEARCHING", "AVAILABLE", "BOOKING",
  "BOOKED", "RESCHEDULE_REQUIRED", "CANCELLED",
  "COMPLETED", "NO_SHOW", "FAILED",
];

export type SlotAvailability = "AVAILABLE" | "HELD" | "BOOKED" | "EXPIRED";

// ---------- Error categories ----------
export type ErrorCategory = "TRANSIENT" | "PERMANENT" | "REQUIRES_USER" | "REQUIRES_OPERATOR" | "UNKNOWN";

export function categorizeError(errorCode?: string, retryable?: boolean): ErrorCategory {
  const c = String(errorCode || "").toUpperCase();
  if (!c) return retryable ? "TRANSIENT" : "UNKNOWN";
  if (["TIMEOUT", "PROVIDER_TIMEOUT", "RATE_LIMIT", "PROVIDER_UNAVAILABLE", "NETWORK", "5XX"].includes(c)) return "TRANSIENT";
  if (["AUTH_FAILURE", "EXPIRED_CREDENTIAL", "INVALID_KEY", "NO_CREDENTIALS", "UNAUTHORIZED", "CONFIG_ERROR"].includes(c)) return "REQUIRES_OPERATOR";
  if (["PAYMENT_REQUIRED", "ADDITIONAL_INFO_REQUIRED", "SLOT_EXPIRED", "SLOT_UNAVAILABLE"].includes(c)) return "REQUIRES_USER";
  if (["INVALID_SLOT", "INVALID_LOCATION", "DUPLICATE_BOOKING", "PERMANENT", "BAD_REQUEST"].includes(c)) return "PERMANENT";
  return retryable ? "TRANSIENT" : "UNKNOWN";
}

// ---------- Normalized provider data (§7/§8) ----------
export interface ProviderLocation {
  external_location_id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  appointment_types?: AppointmentType[];
  metadata?: Record<string, any>;
}

export interface ProviderSlot {
  external_slot_id: string;
  location_id: string;
  appointment_type: AppointmentType;
  start_at_utc: string;
  end_at_utc: string;
  duration_minutes?: number;
  location_timezone?: string;
  availability_status?: SlotAvailability;
  expires_at?: string;
  provider_reference?: string;
}

// ---------- Provider result shapes ----------
export interface LocationResult { success: boolean; locations: ProviderLocation[]; error_code?: string; error_message?: string; response_metadata?: Record<string, any>; }
export interface SlotResult { success: boolean; slots: ProviderSlot[]; expires_at?: string; error_code?: string; error_message?: string; response_metadata?: Record<string, any>; }
export interface HoldResult { success: boolean; provider_reference?: string; expires_at?: string; error_code?: string; error_message?: string; }
export interface BookResult {
  success: boolean;
  external_reference?: string;
  provider_reference?: string;
  scheduled_at_utc?: string;
  duration_minutes?: number;
  error_code?: string;
  error_message?: string;
  error_category?: ErrorCategory;
  retryable?: boolean;
  response_metadata?: Record<string, any>;
  // Mock/sandbox providers may return a confirmation document inline; the engine
  // stores it in the Document Vault (never a second storage system).
  confirmation_payload?: { storage_uri: string; mime_type: string; file_size: number; display_name?: string };
}

// ---------- Booking request (§18) ----------
export interface BookRequest {
  application_id: string;
  appointment_requirement_id: string;
  slot_id: string;
  external_slot_id: string;
  location_id: string;
  external_location_id: string;
  appointment_type: AppointmentType;
  scheduled_at_utc: string;
  duration_minutes: number;
  location_timezone: string;
  idempotency_key: string;
  environment: "sandbox" | "production";
  traveler?: { first_name?: string; last_name?: string; email?: string };
}

// ---------- Provider adapter contract (§10) ----------
// Lives in the SAME provider registry as submission/AI adapters (reuses
// ProviderContext/credentials). An appointment provider implements only the
// capabilities it advertises.
export interface AppointmentProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly providerType: string;
  readonly capabilities: AppointmentCapability[];
  getCapabilities(ctx: ProviderContext): AppointmentCapability[];
  getLocations(ctx: ProviderContext, opts: { appointment_type?: AppointmentType }): Promise<LocationResult>;
  getSlots(ctx: ProviderContext, opts: { location_id: string; external_location_id: string; appointment_type: AppointmentType; date_from?: string; date_to?: string }): Promise<SlotResult>;
  holdSlot?(ctx: ProviderContext, opts: { external_slot_id: string }): Promise<HoldResult>;
  book(ctx: ProviderContext, req: BookRequest): Promise<BookResult>;
  cancel?(ctx: ProviderContext, opts: { external_reference: string; appointment_id?: string }): Promise<{ success: boolean; error_code?: string; error_message?: string }>;
  reschedule?(ctx: ProviderContext, opts: { appointment_id: string; external_reference: string; new_external_slot_id: string; new_scheduled_at_utc: string; idempotency_key: string }): Promise<BookResult>;
  getStatus?(ctx: ProviderContext, opts: { external_reference: string }): Promise<{ success: boolean; status?: AppointmentStatus; error_code?: string; response_metadata?: Record<string, any> }>;
}

// ---------- Idempotency (§19) ----------
export function appointmentIdempotencyKey(applicationId: string, requirementId: string, slotId: string): string {
  return `appointment|${applicationId}|${requirementId}|${slotId}|${djb2(stable({ applicationId, requirementId, slotId }))}`;
}

export function rescheduleIdempotencyKey(appointmentId: string, newSlotId: string): string {
  return `reschedule|${appointmentId}|${newSlotId}|${djb2(stable({ appointmentId, newSlotId }))}`;
}