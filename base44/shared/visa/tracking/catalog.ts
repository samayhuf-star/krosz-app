// Worldz Visa (Phase 19) — tracking provider catalog. Registers the manual and
// mock tracking adapters into the shared provider registry at import time
// (side effect), mirroring the submission catalog (Phase 8). Clearly-labeled
// mock: never presented as a real government API (spec §40).

import { registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import { ManualTrackingProvider } from "./adapters/manual.ts";
import { MockTrackingProvider } from "./adapters/mock.ts";

if (!hasProviderAdapter("visa_tracking_manual")) registerProviderAdapter(ManualTrackingProvider as any);
if (!hasProviderAdapter("visa_tracking_mock")) registerProviderAdapter(MockTrackingProvider as any);

export { ManualTrackingProvider, MockTrackingProvider };