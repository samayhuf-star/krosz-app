// Orizn — mocked Travel Buddy adapter contract.
// No RapidAPI calls or credentials are used by this test suite.

import { createTravelBuddyProvider, isTravelBuddyMvpRoute } from "./travel_buddy.ts";
import { VISA_STATUS } from "./types.ts";

const MVP = ["AE", "VN", "ID", "TH", "SG", "LK", "HK", "EG", "OM", "MY"];

function mockFetch(payloadFor: (body: any) => any): any {
  return async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payloadFor(body)),
    };
  };
}

export async function runTravelBuddyContractTests(): Promise<{ passed: number; failed: number; results: any[] }> {
  let passed = 0;
  let failed = 0;
  const results: any[] = [];
  const test = (name: string, condition: boolean, detail?: any) => {
    if (condition) { passed++; results.push({ name, pass: true }); }
    else { failed++; results.push({ name, pass: false, detail }); }
  };

  const provider = createTravelBuddyProvider({
    apiKey: "test-only",
    fetchImpl: mockFetch((body) => ({
      data: {
        passport: { code: body.passport, name: "India" },
        destination: { code: body.destination, name: `Destination ${body.destination}` },
        visa_rules: {
          primary_rule: { name: "eVisa", duration: "30 days", color: "blue", link: `https://example.test/${body.destination}` },
        },
      },
      meta: { version: "2.0", generated_at: "2026-08-01T00:00:00Z" },
    })),
  });

  for (const destination of MVP) {
    const result: any = await provider.getVisaRequirement("IN", destination);
    test(
      `IND->${destination} normalized`,
      result.ok === true &&
        result.result?.nationality === "IN" &&
        result.result?.destination === destination &&
        result.result?.visa_status === VISA_STATUS.EVISA &&
        result.result?.intelligence_only === true &&
        result.result?.submission_capability === "UNSUPPORTED",
      result,
    );
    test(`IND->${destination} is MVP route`, isTravelBuddyMvpRoute("IN", destination));
  }

  const missingSecret = createTravelBuddyProvider({ apiKey: "", fetchImpl: mockFetch(() => ({})) });
  const missing: any = await missingSecret.getVisaRequirement("IN", "AE");
  test("missing secret fails closed", missing.ok === false && missing.error === "travel_buddy_secret_missing" && !missing.result, missing);

  const unknown = createTravelBuddyProvider({
    apiKey: "test-only",
    fetchImpl: mockFetch(() => ({ passport: "IN", destination: "AE", status: "special_case" })),
  });
  const unknownResult: any = await unknown.getVisaRequirement("IN", "AE");
  test("unknown status requires review", unknownResult.ok === true && unknownResult.result?.visa_status === VISA_STATUS.OTHER && unknownResult.result?.confidence === "NEEDS_REVIEW", unknownResult);

  test("provider exposes no submission method", typeof (provider as any).submitApplication === "undefined");
  test("diagnostics never expose key", !("apiKey" in provider.diagnose()) && provider.diagnose().hasApiKey === true);

  return { passed, failed, results };
}
