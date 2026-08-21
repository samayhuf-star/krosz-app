// Worldz Visa (Phase 10) — commerce catalog seed.
//
// Idempotent. Seeds VisaProduct + VisaPrice fixture rows and the mock + manual
// payment Providers so Phase 10 is operational out of the box. Mirrors Phase 9's
// appointment catalog shape. The mock provider exercises the full flow; the
// manual provider is the operator-recorded fallback. A Stripe Provider row +
// adapter wiring is left to operators (ProviderCredential admin UI + secrets);
// the resolver picks it automatically once enabled.
//
// Products:
//   - FRANCE_SCHENGEN_TOURIST (pay before submission, partially refundable)
//   - FRANCE_SCHENGEN_BUSINESS
//   - JAPAN_EVISA_TOURIST (pay before submission)
//   + a NO_PAYMENT_REQUIRED product to exercise the no-payment route.

import { registerPaymentAdapter } from "./registry.ts";
import { MockPaymentProvider } from "./adapters/mock.ts";
import { ManualPaymentProvider } from "./adapters/manual.ts";
import { StripePaymentProvider } from "./adapters/stripe.ts";

// Register payment adapters as a side effect of importing this module, so the
// resolver can look them up by adapter_key once the catalog is seeded.
registerPaymentAdapter(MockPaymentProvider as any);
registerPaymentAdapter(ManualPaymentProvider as any);
registerPaymentAdapter(StripePaymentProvider as any);

export interface ProductFixture {
  product: any;
  price: any;
}

function minor(units: number): number { return Math.round(units * 100); }

export const PRODUCT_FIXTURES: ProductFixture[] = [
  {
    product: {
      code: "FRANCE_SCHENGEN_TOURIST", name: "France Schengen — Tourist", country: "FR",
      visa_type_key: "schengen_short_stay", purpose: "tourism", status: "ACTIVE",
      refund_policy: "PARTIALLY_REFUNDABLE", payment_gate: "PAYMENT_BEFORE_SUBMISSION",
      description: "Short-stay Schengen tourist visa for France.",
      metadata: {},
    },
    price: {
      currency: "INR", version: "v1", status: "active",
      components: [
        { type: "GOVERNMENT_FEE", code: "gov_fee", label: "Government fee", amount_minor: minor(2000), government_fee_basis: "included", refundable: false },
        { type: "SERVICE_FEE", code: "service_fee", label: "Visa processing", amount_minor: minor(5000), refundable: true },
        { type: "COURIER_FEE", code: "courier", label: "Courier", amount_minor: minor(500), refundable: true },
        { type: "TAX", code: "gst", label: "GST (18%)", amount_minor: minor(450) },
      ],
      effective_from: "2026-01-01",
    },
  },
  {
    product: {
      code: "FRANCE_SCHENGEN_BUSINESS", name: "France Schengen — Business", country: "FR",
      visa_type_key: "schengen_short_stay", purpose: "business", status: "ACTIVE",
      refund_policy: "OPERATOR_REVIEW", payment_gate: "PAYMENT_BEFORE_SUBMISSION",
      description: "Short-stay Schengen business visa for France.",
      metadata: {},
    },
    price: {
      currency: "INR", version: "v1", status: "active",
      components: [
        { type: "GOVERNMENT_FEE", code: "gov_fee", label: "Government fee", amount_minor: minor(2000), government_fee_basis: "included", refundable: false },
        { type: "SERVICE_FEE", code: "service_fee", label: "Visa processing", amount_minor: minor(7000), refundable: true },
        { type: "COURIER_FEE", code: "courier", label: "Courier", amount_minor: minor(500), refundable: true },
        { type: "TAX", code: "gst", label: "GST (18%)", amount_minor: minor(630) },
      ],
      effective_from: "2026-01-01",
    },
  },
  {
    product: {
      code: "JAPAN_EVISA_TOURIST", name: "Japan eVisa — Tourist", country: "JP",
      visa_type_key: "evisa", purpose: "tourism", status: "ACTIVE",
      refund_policy: "NON_REFUNDABLE", payment_gate: "PAYMENT_BEFORE_SUBMISSION",
      description: "Japan eVisa for tourism.",
      metadata: {},
    },
    price: {
      currency: "INR", version: "v1", status: "active",
      components: [
        { type: "GOVERNMENT_FEE", code: "gov_fee", label: "Government fee", amount_minor: minor(1500), government_fee_basis: "included", refundable: false },
        { type: "SERVICE_FEE", code: "service_fee", label: "Visa processing", amount_minor: minor(3000), refundable: true },
        { type: "TAX", code: "gst", label: "GST (18%)", amount_minor: minor(270) },
      ],
      effective_from: "2026-01-01",
    },
  },
  {
    product: {
      code: "JAPAN_EVISA_NOFEE", name: "Japan eVisa — No Fee (test route)", country: "JP",
      visa_type_key: "evisa", purpose: "tourism", status: "ACTIVE",
      refund_policy: "FULLY_REFUNDABLE", payment_gate: "NO_PAYMENT_REQUIRED",
      description: "Test product: no payment required before services.",
      metadata: { test_route: true },
    },
    price: {
      currency: "INR", version: "v1", status: "active",
      components: [], effective_from: "2026-01-01",
    },
  },
];

export const PAYMENT_PROVIDER_FIXTURES: any[] = [
  {
    name: "Mock Payment Provider (sandbox)", key: "visa_mock_payment", category: "payment",
    adapter_key: "visa_payment_mock", adapter_config: { provider_type: "GOVERNMENT_API", scenario: "ok" },
    environment: "sandbox", status: "connected", enabled: true, is_default: false, health_status: "healthy",
    capabilities: ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"],
  },
  {
    name: "Manual Payment (Operator)", key: "visa_manual_payment", category: "payment",
    adapter_key: "visa_payment_manual", adapter_config: { provider_type: "MANUAL_OPERATOR" },
    environment: "sandbox", status: "connected", enabled: true, is_default: false, health_status: "healthy",
    capabilities: ["CREATE_CHECKOUT", "STATUS", "REFUND"],
  },
  {
    // Real Stripe — production default. Reads STRIPE_SECRET_KEY from Base44
    // Secrets at call time; engine.ts only routes here when that secret is set.
    name: "Stripe (production)", key: "stripe", category: "payment",
    adapter_key: "visa_payment_stripe", adapter_config: { provider_type: "STRIPE" },
    environment: "production", status: "connected", enabled: true, is_default: true, health_status: "healthy",
    capabilities: ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"],
  },
];

function computeTotals(components: any[]): { subtotal_minor: number; tax_minor: number; discount_minor: number; total_minor: number } {
  let sub = 0, tax = 0, disc = 0;
  for (const c of components || []) {
    if (c.type === "TAX") tax += c.amount_minor;
    else if (c.type === "DISCOUNT") disc += c.amount_minor;
    else sub += c.amount_minor;
  }
  return { subtotal_minor: sub, tax_minor: tax, discount_minor: disc, total_minor: sub + tax - disc };
}

export async function ensurePaymentCatalog(svc: any): Promise<{ products: number; prices: number; providers: number }> {
  let products = 0, prices = 0, providers = 0;

  // Products + prices.
  for (const fx of PRODUCT_FIXTURES) {
    let p: any = (await svc.entities.VisaProduct.filter({ code: fx.product.code }).catch(() => []))[0];
    if (!p) p = await svc.entities.VisaProduct.create(fx.product).catch(() => null);
    else p = await svc.entities.VisaProduct.update(p.id, fx.product).catch(() => p);
    if (!p) continue;
    products++;
    const totals = computeTotals(fx.price.components);
    const priceData = { ...fx.price, product_id: p.id, ...totals };
    let pr: any = (await svc.entities.VisaPrice.filter({ product_id: p.id, version: fx.price.version, status: "active" }).catch(() => []))[0];
    if (!pr) pr = await svc.entities.VisaPrice.create(priceData).catch(() => null);
    else pr = await svc.entities.VisaPrice.update(pr.id, priceData).catch(() => pr);
    if (pr) prices++;
  }

  // Payment providers.
  for (const pf of PAYMENT_PROVIDER_FIXTURES) {
    let row: any = (await svc.entities.Provider.filter({ key: pf.key, category: "payment" }).catch(() => []))[0];
    if (!row) row = await svc.entities.Provider.create(pf).catch(() => null);
    else row = await svc.entities.Provider.update(row.id, pf).catch(() => row);
    if (row) providers++;
  }

  return { products, prices, providers };
}