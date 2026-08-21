// Worldz Visa (Phase 22) — Discovery/eligibility enrichment via the Visa
// Intelligence service. The provider can EXPAND discovery coverage (add a
// provider-suggested option for nationality×destination pairs our catalog
// lacks) and ATTACH provenance, but it NEVER overrides the rule engine:
//   - existing routes keep their rule-engine eligibility verdict
//   - provider-suggested options are always `possibly_eligible` / `requires_review`,
//     never `eligible`
// Applications pin their rule_snapshot from the internal VisaRoute/Requirements
// model, so historical applications never change because Pipeworx later differs.

import type { VisaOption, EligibilityOutcome, DiscoveryResult } from "../discovery/engine.ts";
import { getVisaRequirement } from "./service.ts";
import { VISA_STATUS, statusToChannel, CONFIDENCE, type NormalizedVisaRequirement } from "./types.ts";

const RANK: Record<EligibilityOutcome, number> = { eligible: 3, possibly_eligible: 2, requires_review: 1, not_eligible: 0 };

function providerPresentation(norm: NormalizedVisaRequirement) {
  const key = String(norm.provider || "PIPEWORX").toUpperCase();
  if (key === "TRAVEL_BUDDY") {
    return {
      key,
      source_type: "travel_buddy",
      source_name: "Travel Buddy Visa Requirement API",
      source_url: "https://visa-requirement.p.rapidapi.com/v2/visa/check",
    };
  }
  return {
    key: "PIPEWORX",
    source_type: "pipeworx",
    source_name: "Pipeworx Visa Requirements",
    source_url: "https://pipeworx.io/packs/visa-requirements",
  };
}

function providerToOption(input: { nationality: string; destination: string }, norm: NormalizedVisaRequirement): VisaOption {
  const { category, channel } = statusToChannel(norm.visa_status as any);
  const name = norm.visa_status_label || norm.visa_status.replace(/_/g, " ");
  const presentation = providerPresentation(norm);
  const id = `provider:${presentation.key}:${norm.nationality}:${norm.destination}:${norm.visa_status}`;
  return {
    id,
    route_id: id,
    visa_type_key: norm.visa_status,
    name,
    category,
    channel,
    entry_type: norm.visa_status === VISA_STATUS.VISA_FREE ? "single" : undefined,
    application_method: undefined,
    authority: undefined,
    max_stay_days: norm.stay_duration_days ?? undefined,
    validity_days: undefined,
    entries: undefined,
    appointment_required: false,
    processing: {},
    fees: undefined,
    // Provider suggestions are NEVER eligible from raw provider data.
    eligibility: norm.visa_status === VISA_STATUS.OTHER || norm.confidence === CONFIDENCE.NEEDS_REVIEW ? "requires_review" : "possibly_eligible",
    requirements_version: undefined,
    source: presentation.source_type,
    source_name: presentation.source_name,
    source_url: presentation.source_url,
    verified_at: norm.dataset_last_updated,
    confidence: norm.confidence === CONFIDENCE.HIGH_CONFIDENCE ? 0.75 : norm.confidence === CONFIDENCE.NORMAL ? 0.6 : 0.4,
    // Provider-specific provenance fields (optional extensions of VisaOption).
    provider: presentation.key,
    provider_status: norm.visa_status,
    provider_stay_days: norm.stay_duration_days ?? undefined,
    provider_retrieved_at: norm.retrieved_at,
    provider_source: norm.source,
    provider_dataset_last_updated: norm.dataset_last_updated,
    provider_confidence: norm.confidence,
  } as VisaOption;
}

// Attach provider provenance to an existing rule-engine option WITHOUT changing
// its eligibility verdict (rule engine stays authoritative, §18).
export function attachProviderToOption(option: VisaOption, norm: NormalizedVisaRequirement): VisaOption {
  const presentation = providerPresentation(norm);
  const legacySeed = !option.source || option.source === "dev_seed";
  return {
    ...option,
    ...(legacySeed ? {
      source: presentation.source_type,
      source_name: presentation.source_name,
      source_url: presentation.source_url,
    } : {}),
    provider: option.provider || presentation.key,
    provider_status: norm.visa_status,
    provider_stay_days: norm.stay_duration_days ?? undefined,
    provider_retrieved_at: norm.retrieved_at,
    provider_source: norm.source,
    provider_dataset_last_updated: norm.dataset_last_updated,
    provider_confidence: norm.confidence,
  } as VisaOption;
}

// Mutates/returns the DiscoveryResult by enriching options + provenance.
export async function enrichEligibility(
  svc: any,
  input: { nationality: string; destination: string },
  result: DiscoveryResult,
): Promise<DiscoveryResult> {
  try {
    // Cache-only: discovery reads never block on a live external provider call.
    const svcRes = await getVisaRequirement(svc, input.nationality, input.destination, { cacheOnly: true });
    if (!svcRes.available || !svcRes.normalized) {
      // Provider unavailable: do not fabricate. Mark provenance provider as unavailable.
      return {
        ...result,
        provenance: { ...result.provenance, provider: { key: "VISA_INTELLIGENCE", status: "unavailable", degraded: svcRes.degraded, error: svcRes.error } } as any,
      };
    }
    const norm = svcRes.normalized;
    const presentation = providerPresentation(norm);

    // Attach provenance to existing rule-engine options (never flips eligibility).
    let options = result.options.map((o) => attachProviderToOption(o, norm));

    // Expand coverage: if no internal route produced an option the engine could use
    // (i.e. outcome is not_eligible because there were no routes), and the provider
    // suggests a real path, add a provider-suggested option (always possibly_eligible /
    // requires_review — never eligible).
    const hadInternalPath = options.length > 0;
    const suggestable = [VISA_STATUS.VISA_FREE, VISA_STATUS.VISA_ON_ARRIVAL, VISA_STATUS.EVISA, VISA_STATUS.ETA].includes(norm.visa_status as any);
    if (!hadInternalPath && suggestable) {
      options = [providerToOption(input, norm)];
      if (RANK["possibly_eligible"] > RANK[result.outcome]) {
        result = { ...result, outcome: "possibly_eligible", reason: "provider_suggests_path", options };
      } else {
        result = { ...result, options };
      }
    } else {
      result = { ...result, options };
    }

    const legacySeed = !result.provenance?.source_type || result.provenance.source_type === "dev_seed";
    return {
      ...result,
      // For customer presentation, never surface the legacy seed catalog when a
      // fresh provider snapshot exists. This does NOT promote provider data to an
      // official-government verification or change the rule-engine verdict.
      provenance: {
        ...result.provenance,
        ...(legacySeed ? {
          source_type: presentation.source_type,
          source_name: presentation.source_name,
          source_url: presentation.source_url,
          verified_at: norm.verified_at || norm.dataset_last_updated || norm.retrieved_at,
          confidence: norm.confidence,
          verified: false,
        } : {}),
        provider: {
          key: presentation.key,
          status: svcRes.freshness,
          cached: svcRes.cached,
          degraded: svcRes.degraded,
          visa_status: norm.visa_status,
          stay_duration_days: norm.stay_duration_days ?? null,
          source: norm.source,
          dataset_last_updated: norm.dataset_last_updated,
          retrieved_at: norm.retrieved_at,
          confidence: norm.confidence,
          disclaimer: norm.disclaimer,
          // Source transparency (§34): explicitly NOT an official embassy decision.
          official: false,
        } as any,
      },
    };
  } catch {
    // Any unexpected error: leave the rule-engine result untouched. Never fabricate.
    return result;
  }
}

// Light provider enrichment for destination detail / sample option (§17):
// attaches provider provenance to a single synthesized option.
export async function enrichSampleOption(
  svc: any,
  option: VisaOption | null,
  nationality: string,
  destination: string,
): Promise<{ option: VisaOption | null; provider?: any }> {
  if (!option) return { option };
  try {
    // Cache-only: destination detail reads never block on a live provider call.
    const svcRes = await getVisaRequirement(svc, nationality, destination, { cacheOnly: true });
    if (!svcRes.available || !svcRes.normalized) return { option, provider: { status: "unavailable" } };
    return {
      option: attachProviderToOption(option, svcRes.normalized),
      provider: {
        key: providerPresentation(svcRes.normalized).key, status: svcRes.freshness, cached: svcRes.cached, degraded: svcRes.degraded,
        visa_status: svcRes.normalized.visa_status, stay_duration_days: svcRes.normalized.stay_duration_days,
        source: svcRes.normalized.source, dataset_last_updated: svcRes.normalized.dataset_last_updated,
        retrieved_at: svcRes.normalized.retrieved_at, confidence: svcRes.normalized.confidence,
        official: false, disclaimer: svcRes.normalized.disclaimer,
      },
    };
  } catch {
    return { option, provider: { status: "unavailable" } };
  }
}