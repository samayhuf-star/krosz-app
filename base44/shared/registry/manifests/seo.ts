import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'seo',
  name: 'SEO Factory',
  version: '2.0.0',
  icon: 'Search',
  available: true,
  stage: 'seo',
  dependencies: ['BusinessBlueprint', 'WebsiteGeneration', 'CRM'],
  capabilities: ['SEOGeneration', 'KeywordStrategy', 'MetadataGeneration', 'SchemaGeneration', 'TechnicalSEO', 'ContentPlanning'],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['seo:read', 'seo:generate', 'seo:approve', 'seo:publish', 'seo:rollback'],
  routes: [{ path: '/seo', label: 'SEO Factory' }],
  sidebar: [{ path: '/seo', label: 'SEO Factory', icon: 'Search' }],
};

const capabilities: Capability[] = [
  { key: 'SEOGeneration', moduleId: 'seo', kind: 'engine', description: 'Complete SEO operating program from approved blueprint + published website + published CRM.' },
  { key: 'KeywordStrategy', moduleId: 'seo', kind: 'engine', description: 'Primary/secondary/long-tail/commercial/local/question keywords with intent, difficulty, priority, volume.' },
  { key: 'MetadataGeneration', moduleId: 'seo', kind: 'engine', description: 'Per-page SEO titles, meta descriptions, canonicals, Open Graph, Twitter cards, slugs.' },
  { key: 'SchemaGeneration', moduleId: 'seo', kind: 'engine', description: 'Schema.org definitions (Organization, LocalBusiness, Product, Service, FAQ, Review, Article, Breadcrumb, Event, Person).' },
  { key: 'TechnicalSEO', moduleId: 'seo', kind: 'engine', description: 'Core Web Vitals, indexability, robots, sitemap, redirects, duplicate content, broken links, image optimization.' },
  { key: 'ContentPlanning', moduleId: 'seo', kind: 'engine', description: 'Topic clusters, internal linking, image SEO, and content opportunities (blogs, landing pages, FAQs, guides).' },
];

registerModule(manifest, capabilities);