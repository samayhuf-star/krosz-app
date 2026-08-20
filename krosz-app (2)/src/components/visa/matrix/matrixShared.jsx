// Worldz Visa (Phase 23) — ability-value tone + label maps shared across the matrix UI.
export const STATUS_TONE = {
  PUBLISHED: 'bg-orange-50 text-orange-700 border-orange-200',
  VERIFIED: 'bg-blue-50 text-blue-700 border-blue-200',
  RESEARCHING: 'bg-slate-50 text-slate-600 border-slate-200',
  DRAFT: 'bg-slate-50 text-slate-400 border-slate-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
  CONFLICT: 'bg-rose-50 text-rose-700 border-rose-200',
  SUSPENDED: 'bg-rose-50 text-rose-700 border-rose-200',
  READY_FOR_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
  DATA_FOUND: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  CROSS_CHECKING: 'bg-blue-50 text-blue-700 border-blue-200',
  NOT_STARTED: 'bg-slate-50 text-slate-500 border-slate-200',
};
export const ABILITY_TONE = {
  YES: 'bg-orange-50 text-orange-700 border-orange-200',
  NO: 'bg-rose-50 text-rose-700 border-rose-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
};
export const AV_TONE = {
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
  YES: 'bg-orange-50 text-orange-700 border-orange-200',
  NO: 'bg-rose-50 text-rose-700 border-rose-200',
};
export const JOURNEY_LABEL = {
  VISA_FREE: 'Visa-free', VISA_ON_ARRIVAL: 'VOA', ETA: 'ETA', EVISA: 'eVisa',
  OTHER_LOW_FRICTION: 'Low-friction', EMBASSY_VISA: 'Embassy', CONSULAR_VISA: 'Consular',
  TRANSIT_VISA: 'Transit', WORK_VISA: 'Work', STUDENT_VISA: 'Student', OTHER: 'Other', ANY: '—',
};
export const AUTOMATION_LABEL = {
  FULLY_AUTOMATED: 'Fully automated', SEMI_AUTOMATED: 'Semi-automated', GUIDED: 'Guided',
  MANUAL: 'Manual', UNSUPPORTED: 'Unsupported',
};
export const CLASS_LABEL = { A: 'A · Fully auto opp', B: 'B · Semi', C: 'C · Guided', D: 'D · Manual', E: 'E · Unsupported', UNKNOWN: 'Unclassified' };
export const CONF_LABEL = {
  VERIFIED: 'Verified', CROSS_CHECKED: 'Cross-checked', SINGLE_SOURCE: 'Single source',
  CONFLICT: 'Conflict', STALE: 'Stale', UNKNOWN: 'Unknown',
};
// Phase 24 verification + execution tones.
export const VERIF_TONE = {
  INVENTORIED: 'bg-slate-50 text-slate-500 border-slate-200',
  RESEARCHING: 'bg-amber-50 text-amber-700 border-amber-200',
  PARTIALLY_VERIFIED: 'bg-blue-50 text-blue-700 border-blue-200',
  VERIFIED: 'bg-orange-50 text-orange-700 border-orange-200',
  STALE: 'bg-orange-50 text-orange-700 border-orange-200',
  BLOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
};
export const EXEC_LABEL = {
  GUIDANCE_ONLY: 'Guidance only', INTELLIGENCE_ONLY: 'Intelligence only', PARTIAL_ASSIST: 'Partial assist',
  DOCUMENT_ASSIST: 'Document assist', APPLICATION_ASSIST: 'Application assist', END_TO_END: 'End-to-end', UNKNOWN: '—',
};
export const VCLASS_LABEL = { A: 'A · Production', B: 'B · Strong', C: 'C · Partial', D: 'D · Research needed', E: 'E · Unknown', UNKNOWN: 'Unclassified' };
export const TRI = {
  YES: 'bg-orange-50 text-orange-700 border-orange-200',
  NO: 'bg-rose-50 text-rose-700 border-rose-200',
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
};
export const LIFECYCLE_TONE = {
  DISCOVERED: 'bg-slate-50 text-slate-500 border-slate-200',
  RESEARCHING: 'bg-amber-50 text-amber-700 border-amber-200',
  CONTACTED: 'bg-amber-50 text-amber-700 border-amber-200',
  DOCUMENTATION_RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  SANDBOX: 'bg-blue-50 text-blue-700 border-blue-200',
  TESTING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  VERIFIED: 'bg-orange-50 text-orange-700 border-orange-200',
  PRODUCTION: 'bg-orange-50 text-orange-700 border-orange-200',
  SUSPENDED: 'bg-rose-50 text-rose-700 border-rose-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
};
export const EV_STATUS_TONE = {
  UNVERIFIED: 'bg-slate-50 text-slate-500 border-slate-200',
  PARTIALLY_VERIFIED: 'bg-blue-50 text-blue-700 border-blue-200',
  VERIFIED: 'bg-orange-50 text-orange-700 border-orange-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  STALE: 'bg-orange-50 text-orange-700 border-orange-200',
};
export function Chip({ value, tone = '', items = {} }) {
  const cls = (items && value && items[value]) || 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${value ? cls : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{value || '—'}</span>;
}