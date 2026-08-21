// Worldz Visa — Phase 21 Discovery presentation layer seed.
// Seeds SearchAlias, FeaturedDestination, and a default DestinationContent row
// for every catalog country. ALL of this is editorial/SEO configuration only —
// visa rules, fees, requirements come from the existing Visa Intelligence domain
// (Country / Nationality / VisaType / VisaRoute / VisaPrice / VisaRequirementsVersion).
// Never duplicate regulatory data here.

import { SEED_COUNTRIES } from "../catalog.ts";

export function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Aliases: common abbreviations, alternate names, demonym, top city. Lowercased.
const ALIASES: Record<string, { alias: string; type: string }[]> = {
  US: [
    { alias: "usa", type: "abbreviation" }, { alias: "u.s.a", type: "abbreviation" },
    { alias: "america", type: "other" }, { alias: "united states of america", type: "name" },
    { alias: "new york", type: "city" }, { alias: "los angeles", type: "city" },
  ],
  GB: [
    { alias: "uk", type: "abbreviation" }, { alias: "u.k", type: "abbreviation" },
    { alias: "britain", type: "other" }, { alias: "great britain", type: "name" },
    { alias: "england", type: "other" }, { alias: "london", type: "city" },
  ],
  AE: [
    { alias: "dubai", type: "city" }, { alias: "emirates", type: "other" },
    { alias: "u.a.e", type: "abbreviation" },
  ],
  TH: [{ alias: "bangkok", type: "city" }, { alias: "siam", type: "historic" }],
  VN: [{ alias: "vietnam", type: "name" }, { alias: "saigon", type: "city" }, { alias: "hanoi", type: "city" }],
  SG: [{ alias: "singapore city", type: "city" }, { alias: "lion city", type: "other" }],
  ID: [{ alias: "indonesia", type: "name" }, { alias: "bali", type: "city" }],
  LK: [{ alias: "sri lanka", type: "name" }, { alias: "srilanka", type: "other" }, { alias: "colombo", type: "city" }],
  HK: [{ alias: "hong kong", type: "name" }, { alias: "hongkong", type: "other" }],
  MY: [{ alias: "malaysia", type: "name" }, { alias: "kuala lumpur", type: "city" }],
  EG: [{ alias: "egypt", type: "name" }, { alias: "cairo", type: "city" }],
  OM: [{ alias: "oman", type: "name" }, { alias: "muscat", type: "city" }],
  FR: [{ alias: "paris", type: "city" }, { alias: "french", type: "demonym" }],
  DE: [{ alias: "berlin", type: "city" }, { alias: "german", type: "demonym" }],
  IT: [{ alias: "rome", type: "city" }, { alias: "italia", type: "name" }, { alias: "italian", type: "demonym" }],
  JP: [{ alias: "tokyo", type: "city" }, { alias: "japanese", type: "demonym" }],
  IN: [{ alias: "bharat", type: "other" }, { alias: "hindustan", type: "historic" }, { alias: "mumbai", type: "city" }, { alias: "delhi", type: "city" }],
};

const FEATURED: Record<string, { popularity: number; featured: boolean; badge?: string; order: number }> = {
  AE: { popularity: 95, featured: true, badge: "Fast e-Visa", order: 1 },
  TH: { popularity: 92, featured: true, badge: "Popular", order: 2 },
  GB: { popularity: 88, featured: true, order: 3 },
  US: { popularity: 90, featured: true, order: 4 },
  FR: { popularity: 80, featured: true, badge: "Schengen", order: 5 },
  VN: { popularity: 70, featured: false, order: 6 },
  SG: { popularity: 68, featured: false, order: 7 },
  JP: { popularity: 66, featured: false, badge: "e-Visa", order: 8 },
  DE: { popularity: 60, featured: false, badge: "Schengen", order: 9 },
  IT: { popularity: 58, featured: false, badge: "Schengen", order: 10 },
};

// Default editorial content (dev seed) per country. Intentionally short and
// clearly editorial — never regulatory. Admins refine via the content admin.
const DEFAULT_OVERVIEW: Record<string, string> = {
  AE: "The UAE offers a quick online e-Visa for short tourist visits, making it one of the fastest visas to obtain for Indian passport holders.",
  TH: "Thailand offers an online e-Visa for tourism. Most travelers receive a decision within a few days.",
  VN: "Vietnam offers an e-Visa valid for up to 90 days with multiple entries for eligible passport holders.",
  SG: "Singapore issues a short multiple-entry e-Visa processed online for short tourist and business visits.",
  FR: "France issues Schengen short-stay visas. An appointment and biometrics are usually required.",
  DE: "Germany issues Schengen short-stay visas. An appointment and biometrics are usually required.",
  IT: "Italy issues Schengen short-stay visas. An appointment and biometrics are usually required.",
  GB: "The UK Standard Visitor visa covers tourism, business, and family visits. An appointment is usually required.",
  US: "The US B1/B2 visitor visa requires an embassy interview. Processing times vary by consulate.",
  JP: "Japan offers an online e-Visa for tourism for eligible passport holders.",
};

function defaultFaqs(countryName: string): any[] {
  return [
    { question: `Do Indian citizens need a visa for ${countryName}?`, answer: "This depends on your passport and trip purpose. Use the eligibility checker on this page to see your options." },
    { question: `How long does it take to get a ${countryName} visa?`, answer: "Processing times vary by visa type. See the estimated processing range on each visa option card." },
    { question: `Can I apply for a ${countryName} visa online?`, answer: "Some routes support an online e-Visa. Check the visa options below to see which channels are available." },
  ];
}

export async function ensurePublishCatalog(svc: any): Promise<{ aliases: number; featured: number; content: number }> {
  let aliases = 0, featuredCount = 0, contentCount = 0;

  // SearchAliases — upsert by alias.
  const aliasRows: { alias: string; country_code: string; alias_type: string; status: string }[] = [];
  for (const c of SEED_COUNTRIES) {
    aliasRows.push({ alias: c.name.toLowerCase(), country_code: c.code, alias_type: "name", status: "active" });
    for (const a of ALIASES[c.code] || []) aliasRows.push({ alias: a.alias, country_code: c.code, alias_type: a.type, status: "active" });
  }
  for (const a of aliasRows) {
    const existing: any[] = await svc.entities.SearchAlias.filter({ alias: a.alias }).catch(() => []);
    if (existing.length) await svc.entities.SearchAlias.update(existing[0].id, a).catch(() => {});
    else await svc.entities.SearchAlias.create(a).catch(() => {});
    aliases++;
  }

  // Featured — upsert by country_code.
  for (const c of SEED_COUNTRIES) {
    const f = FEATURED[c.code] || { popularity: 40, featured: false, order: 100 };
    const row = { country_code: c.code, popularity: f.popularity, featured: f.featured, badge: f.badge || null, order: f.order, status: "active" };
    const existing: any[] = await svc.entities.FeaturedDestination.filter({ country_code: c.code }).catch(() => []);
    if (existing.length) await svc.entities.FeaturedDestination.update(existing[0].id, row).catch(() => {});
    else await svc.entities.FeaturedDestination.create(row).catch(() => {});
    featuredCount++;
  }

  // DestinationContent — default PUBLISHED row for every catalog country so the
  // public destination page and sitemap render out of the box. Admins refine.
  for (const c of SEED_COUNTRIES) {
    if (c.code === "IN") continue; // India is a source nationality, not a destination in seed.
    const slug = slugify(c.name);
    const existing: any[] = await svc.entities.DestinationContent.filter({ country_code: c.code, language: "en" }).catch(() => []);
    const row = {
      country_code: c.code, slug, language: "en", status: "PUBLISHED",
      intro: `Visa options for travelling to ${c.name}.`,
      overview: DEFAULT_OVERVIEW[c.code] || `Find visa options, requirements, fees, and processing times for ${c.name}.`,
      visa_summary: "",
      how_it_works: [
        { title: "Check eligibility", description: "Enter your passport and trip purpose to see your visa options." },
        { title: "Start application", description: "Pick a visa option and begin your application online." },
        { title: "Upload documents", description: "Use your document vault to attach the required paperwork." },
        { title: "Submit & track", description: "We submit and track your application end to end." },
      ],
      travel_notes: "",
      important_notes: ["Visa rules can change. Always confirm requirements before booking non-refundable travel."],
      faq: defaultFaqs(c.name),
      related_destinations: relatedDefaults(c.code),
      seo: {},
      content_quality_score: 60,
      metadata: { seed: true },
    };
    if (existing.length) {
      // Only fill if currently empty (don't overwrite admin edits).
      const cur = existing[0];
      const patch: any = {};
      if (cur.status === "DRAFT") patch.status = "PUBLISHED";
      if (!cur.slug) patch.slug = slug;
      if (!cur.intro) patch.intro = row.intro;
      if (!cur.overview) patch.overview = row.overview;
      if (!Array.isArray(cur.faq) || !cur.faq.length) patch.faq = row.faq;
      if (!Array.isArray(cur.how_it_works) || !cur.how_it_works.length) patch.how_it_works = row.how_it_works;
      if (!Array.isArray(cur.related_destinations) || !cur.related_destinations.length) patch.related_destinations = row.related_destinations;
      if (!cur.content_quality_score) patch.content_quality_score = row.content_quality_score;
      if (Object.keys(patch).length) await svc.entities.DestinationContent.update(cur.id, { ...cur, ...patch }).catch(() => {});
    } else {
      await svc.entities.DestinationContent.create(row).catch(() => {});
    }
    contentCount++;
  }

  return { aliases, featured: featuredCount, content: contentCount };
}

// Related-destination defaults by region (used when no editorial override exists).
const REGION_FALLBACK: Record<string, string[]> = {
  Asia: ["TH", "VN", "SG", "JP", "IN"],
  Europe: ["FR", "DE", "IT", "GB"],
  "Middle East": ["AE"],
  "North America": ["US"],
};
function relatedDefaults(code: string): string[] {
  const country = SEED_COUNTRIES.find((c) => c.code === code);
  if (!country) return [];
  const region = REGION_FALLBACK[country.region] || [];
  return region.filter((c) => c !== code).slice(0, 4);
}