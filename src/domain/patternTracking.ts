import type { PatternTrackingStatus } from "./types.js";

interface PatternInput {
  signatureText: string;
  repeatCount: number;
}

export function createPatternAdvisory(input: PatternInput) {
  const status: PatternTrackingStatus =
    input.repeatCount <= 3 ? "advisory_candidate" : "reinforcement";

  return {
    signatureText: input.signatureText,
    status,
    advisoryOnly: true,
    autoSkipAllowed: false,
  };
}
