// Shared Version Engine — the single reusable lifecycle for all versioned modules.
// Supports: draft → approved → published → superseded → archived, plus rollback, history and audit.
// This facade re-exports the engine from modules/lifecycle.ts so future modules
// import from the SDK without reaching into module internals.
export * from '../modules/lifecycle.ts';