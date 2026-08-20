import { base44 } from '@/api/base44Client';

const invoke = (action, payload = {}) => base44.functions.invoke('industryIntelligence', { action, ...payload }).then((r) => r.data);

export const industryApi = {
  detect: (input) => invoke('detect', input),
  personalize: (business_id, assign = true) => invoke('personalize', { business_id, assign }),
  listIndustries: () => invoke('list-industries'),
  listCategories: () => invoke('list-categories'),
  listBlueprints: (status) => invoke('list-blueprints', { status }),
  getBlueprint: (industry_key) => invoke('get-blueprint', { industry_key }),
  getVersion: (version_id) => invoke('get-blueprint-version', { version_id }),
  seed: () => invoke('seed'),
  generateBlueprint: (industry_key) => invoke('generate-blueprint', { industry_key }),
  publish: (version_id) => invoke('publish', { version_id }),
  verify: (version_id, verified) => invoke('verify', { version_id, verified }),
  update: (version_id, patch) => invoke('update', { version_id, patch }),
  archive: (version_id) => invoke('archive', { version_id }),
  selfImprove: (industry_key) => invoke('self-improve', { industry_key }),
  feedback: (industry_key, rating, note) => invoke('feedback', { industry_key, rating, note }),
  stats: (industry_key) => invoke('stats', { industry_key }),
  upsertBenchmark: (industry_key, metrics, region, confidence) => invoke('upsert-benchmark', { industry_key, metrics, region, confidence }),
  getBenchmark: (industry_key, region) => invoke('get-benchmark', { industry_key, region }),
  listBenchmarks: () => invoke('list-benchmarks'),
  listPatterns: () => invoke('list-patterns'),
  applicablePatterns: (industry_key) => invoke('applicable-patterns', { industry_key }),
  suggestPatterns: (industry_key) => invoke('suggest-patterns', { industry_key }),
  createPattern: (p) => invoke('create-pattern', p),
  applyPattern: (pattern_id, industry_key) => invoke('apply-pattern', { pattern_id, industry_key }),
};