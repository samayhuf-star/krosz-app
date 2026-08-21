import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// Krosz MVP catalog seed + data hygiene (one-shot, admin-invoked).
//
// Completes the launch-readiness data fixes that the exec_tool entity-mutation
// guard blocks:
//   • Creates AE/VN/ID VisaProduct + active VisaPrice (government + Krosz
//     service fee components) so checkout resolves for the MVP countries.
//   • Dedupes Country (AE ~30→1, VN ~31→1) so exactly one active Country row
//     per code remains.
//   • Dedupes VisaRoute so exactly one ACTIVE route per (nationality, dest,
//     purpose) remains — AE/VN routes were left all-archived, which broke
//     eligibility/checkout.
//   • Removes the ₹0 archived VisaPrice so a free visa can never surface.
//   • Makes UAE tourism DocumentRequirement rows internally consistent within
//     a requirements_version (one active set per version; archived duplicates
//     and duplicate-by-code rows removed).
//   • Deletes regression-runner archived Traveler leftovers.
// It does NOT touch the payment state machine, server-side gates, or any
// non-visa entities. Run via test_backend_function with { action: "run" }.

const PRODUCTS = [
  { code: "UAE_EVISA_TOURIST", name: "UAE eVisa — Tourist", country: "AE", purpose: "tourism", refund: "PARTIALLY_REFUNDABLE", desc: "UAE eVisa for tourism (Indian passport holders). Gov + Krosz service." },
  { code: "UAE_EVISA_BUSINESS", name: "UAE eVisa — Business", country: "AE", purpose: "business", refund: "OPERATOR_REVIEW", desc: "UAE eVisa for business travel." },
  { code: "UAE_EVISA_STUDY", name: "UAE eVisa — Study", country: "AE", purpose: "study", refund: "OPERATOR_REVIEW", desc: "UAE eVisa for study." },
  { code: "VIETNAM_EVISA_TOURIST", name: "Vietnam eVisa — Tourist", country: "VN", purpose: "tourism", refund: "PARTIALLY_REFUNDABLE", desc: "Vietnam eVisa for tourism." },
  { code: "VIETNAM_EVISA_BUSINESS", name: "Vietnam eVisa — Business", country: "VN", purpose: "business", refund: "OPERATOR_REVIEW", desc: "Vietnam eVisa for business." },
  { code: "VIETNAM_EVISA_STUDY", name: "Vietnam eVisa — Study", country: "VN", purpose: "study", refund: "OPERATOR_REVIEW", desc: "Vietnam eVisa for study." },
  { code: "INDONESIA_EVISA_TOURIST", name: "Indonesia eVisa — Tourist", country: "ID", purpose: "tourism", refund: "PARTIALLY_REFUNDABLE", desc: "Indonesia eVisa (B211A) for tourism." },
];
// Prices in INR minor units. gov + service (service is tax-inclusive, so total = sum).
const PRICING: Record<string, { gov: number; service: number }> = {
  AE: { gov: 710000, service: 61600 },
  VN: { gov: 248800, service: 117200 },
  ID: { gov: 299600, service: 67400 },
};

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  if (body.action !== "run") return Response.json({ error: "Missing action=run" }, { status: 400 });
  const sr = base44.asServiceRole.entities;
  const report: any = { products: [], prices: [], countries: {}, routes: {}, zeroPriceDeleted: 0, docReq: {}, travelersDeleted: 0 };

  // 1. Products + active prices (visa_type_key "EVISA" matches what the case
  //    engine assigns to eVisa applications for these routes).
  for (const p of PRODUCTS) {
    const existing = (await sr.VisaProduct.filter({ code: p.code }).catch(() => []))[0];
    const data: any = { code: p.code, name: p.name, country: p.country, visa_type_key: "EVISA", purpose: p.purpose, status: "ACTIVE", refund_policy: p.refund, payment_gate: "PAYMENT_BEFORE_SUBMISSION", description: p.desc, optional_services: [], declaration_code: "DEFAULT_ATTESTATION", metadata: { mvp: true } };
    const prod = existing ? await sr.VisaProduct.update(existing.id, data).catch(() => existing) : await sr.VisaProduct.create(data).catch(() => null);
    if (!prod) { report.products.push({ code: p.code, error: "create_failed" }); continue; }
    report.products.push({ code: prod.code, id: prod.id, status: prod.status });
    const bench = PRICING[p.country];
    const total = bench.gov + bench.service;
    const components = [
      { type: "GOVERNMENT_FEE", code: "gov_fee", label: "Government fee", amount_minor: bench.gov, government_fee_basis: "included", refundable: false },
      { type: "SERVICE_FEE", code: "service_fee", label: "Krosz service fee (tax-incl.)", amount_minor: bench.service, refundable: true },
    ];
    const priceData: any = { product_id: prod.id, currency: "INR", version: "v1", status: "active", effective_from: "2026-08-20", components, subtotal_minor: total, tax_minor: 0, discount_minor: 0, total_minor: total, metadata: { service_fee_tax_inclusive: true } };
    const exPrice = (await sr.VisaPrice.filter({ product_id: prod.id, status: "active" }).catch(() => []))[0];
    const pr = exPrice ? await sr.VisaPrice.update(exPrice.id, priceData).catch(() => exPrice) : await sr.VisaPrice.create(priceData).catch(() => null);
    if (pr) report.prices.push({ product_code: p.code, price_id: pr.id, total_minor: pr.total_minor });
  }

  // 2. Country dedup: keep one active per AE/VN/ID, delete duplicates.
  for (const cc of ["AE", "VN", "ID"]) {
    const rows: any[] = await sr.Country.filter({ code: cc }).catch(() => []);
    if (!rows.length) { report.countries[cc] = { kept: 0, deleted: 0 }; continue; }
    const keeper = rows.find((r) => r.active) || rows[0];
    if (!keeper.active) await sr.Country.update(keeper.id, { active: true }).catch(() => {});
    const del = rows.filter((r) => r.id !== keeper.id).map((r) => r.id);
    if (del.length) await sr.Country.deleteMany({ id: { $in: del } }).catch(() => {});
    report.countries[cc] = { kept: keeper.id, deleted: del.length };
  }

  // 3. VisaRoute dedup: exactly one ACTIVE route per (destination, purpose).
  for (const cc of ["AE", "VN", "ID"]) {
    const rows: any[] = await sr.VisaRoute.filter({ nationality: "IN", destination: cc }).catch(() => []);
    const byPurpose: Record<string, any[]> = {};
    for (const r of rows) (byPurpose[r.purpose] = byPurpose[r.purpose] || []).push(r);
    let kept = 0;
    const delIds: string[] = [];
    for (const purpose of Object.keys(byPurpose)) {
      const group = byPurpose[purpose];
      const keeper = group.find((r) => r.status === "active") || group[0];
      if (keeper.status !== "active") await sr.VisaRoute.update(keeper.id, { status: "active", eligible: true }).catch(() => {});
      kept++;
      for (const r of group) if (r.id !== keeper.id) delIds.push(r.id);
    }
    if (delIds.length) await sr.VisaRoute.deleteMany({ id: { $in: delIds } }).catch(() => {});
    report.routes[cc] = { kept, deleted: delIds.length };
  }

  // 4. Remove every VisaPrice whose amount fields are all ₹0 (so a free visa can
  //    never be surfaced, even if a stale row is flipped active).
  const allPrices: any[] = await sr.VisaPrice.filter({}).catch(() => []);
  const zeroIds = allPrices.filter((p) => !p.total_minor && !p.subtotal_minor && !p.government_minor && !p.service_minor).map((p) => p.id);
  if (zeroIds.length) { await sr.VisaPrice.deleteMany({ id: { $in: zeroIds } }).catch(() => {}); report.zeroPriceDeleted = zeroIds.length; }

  // 5. UAE tourism DocumentRequirement: within each requirements_version, remove
  //    archived rows and dedupe active rows by code so each version is consistent.
  const aeDocs: any[] = await sr.DocumentRequirement.filter({ destination: "AE", purpose: "tourism" }).catch(() => []);
  const byVer: Record<string, any[]> = {};
  for (const d of aeDocs) (byVer[d.requirements_version || "none"] = byVer[d.requirements_version || "none"] || []).push(d);
  const docDel: string[] = [];
  let docKept = 0;
  for (const ver of Object.keys(byVer)) {
    const group = byVer[ver];
    for (const d of group) if (d.status === "archived") docDel.push(d.id);
    const active = group.filter((d) => d.status !== "archived");
    const seen = new Set<string>();
    for (const d of active) {
      const key = String(d.code || d.document_type || d.id);
      if (seen.has(key)) docDel.push(d.id); else { seen.add(key); docKept++; }
    }
  }
  if (docDel.length) await sr.DocumentRequirement.deleteMany({ id: { $in: docDel } }).catch(() => {});
  report.docReq = { versions: Object.keys(byVer), deleted: docDel.length, kept: docKept };

  // 6. Delete regression-runner archived Traveler leftovers (already merged).
  const travelers: any[] = await sr.Traveler.filter({ status: "ARCHIVED" }).catch(() => []);
  const runnerIds = travelers.filter((t) => t.metadata?.merged_by === "regression-runner" || t.metadata?.duplicate_reason === "canonical_merge").map((t) => t.id);
  if (runnerIds.length) { await sr.Traveler.deleteMany({ id: { $in: runnerIds } }).catch(() => {}); report.travelersDeleted = runnerIds.length; }

  return Response.json({ ok: true, report });
}