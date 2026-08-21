// Phase 15A — Memory Store port.
//
// A domain-neutral contract for the persistence layer that stores learned
// facts and generated cognition artifacts on behalf of an AI orchestration
// run. The platform does not enumerate product-specific memory kinds or
// sources; those are defined and validated by the product module. Pure types,
// no runtime, no entity imports.

export interface MemoryRecord {
  id?: string;
  /** The subject this memory belongs to (e.g. a business id in the Business OS product). */
  subject_id: string;
  /** Memory kind — a free-form string owned by the product module (e.g. "fact", "decision", or product-specific brief kinds). */
  kind: string;
  /** Stable logical id within subject+kind (upsert key). */
  key: string;
  title: string;
  /** Human-readable content (markdown/text). */
  body: string;
  /** Structured content (brief sections, review metrics, …) — shape owned by the product module. */
  payload?: any;
  /** Confidence weight 0-1 (product module defines semantics). */
  confidence?: number;
  /** Origin of this record — a free-form string owned by the product module (e.g. "user", "ai"). */
  source?: string;
  tags?: string[];
  /** For time-bounded artifacts (the product module defines the calendar meaning). */
  period_date?: string;
  created_at?: string;
  updated_at?: string;
  provenance?: any;
}

export interface MemoryQuery {
  /** Restrict to a subset of kinds (strings owned by the product module). */
  kinds?: string[];
  limit?: number;
}

export interface MemoryPort {
  /** Collect memory records for a subject (optionally filtered by kind). */
  collect(subject_id: string, query?: MemoryQuery): Promise<MemoryRecord[]>;

  /** Upsert by subject_id + kind + key. Returns the record id. */
  upsert(subject: { id: string; tenant_id: string }, kind: string, key: string, rec: Omit<MemoryRecord, 'id' | 'subject_id' | 'kind' | 'key'>): Promise<string>;

  /** Latest record for a single (subject, kind, key) — for reading the most recent artifact. */
  latest(subject_id: string, kind: string, key: string): Promise<MemoryRecord | null>;
}