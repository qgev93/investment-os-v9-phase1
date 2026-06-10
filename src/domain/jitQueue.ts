import type { ContextCandidate } from "./types.js";

export function enqueueJitBatch(candidates: ContextCandidate[], limit: number): ContextCandidate[] {
  return candidates
    .filter((candidate) => candidate.canonicalStatus === "pending")
    .filter((candidate) => !candidate.rtOnlyExcluded)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .slice(0, limit);
}
