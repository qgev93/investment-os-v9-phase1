import type { ContextGateInput } from "./types.js";

export function canEnterTriage(input: ContextGateInput): boolean {
  return input.canonicalStatus === "verified" && !input.rtOnlyExcluded;
}

export function canEnterInternalization(input: ContextGateInput): boolean {
  return canEnterTriage(input) && input.triageDecision === "체화";
}
