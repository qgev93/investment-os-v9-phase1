import type { CanonicalStatus, TrustLayer } from "./types.js";

interface TrustGateInput {
  discoveryLayer: TrustLayer;
  canonicalLayer?: TrustLayer;
  conflictDetected?: boolean;
}

interface TrustGateResult {
  canonicalStatus: CanonicalStatus;
  triageEligible: boolean;
  reason: "gray_discovery_only" | "canonical_conflict" | "canonical_verified" | "pending";
}

export function resolveTrustGate(input: TrustGateInput): TrustGateResult {
  if (input.conflictDetected) {
    return {
      canonicalStatus: "quarantined",
      triageEligible: false,
      reason: "canonical_conflict",
    };
  }

  if (input.canonicalLayer === "canonical") {
    return {
      canonicalStatus: "verified",
      triageEligible: true,
      reason: "canonical_verified",
    };
  }

  if (input.discoveryLayer === "gray") {
    return {
      canonicalStatus: "pending",
      triageEligible: false,
      reason: "gray_discovery_only",
    };
  }

  return {
    canonicalStatus: "pending",
    triageEligible: false,
    reason: "pending",
  };
}
