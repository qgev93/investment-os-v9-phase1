import type { RtOnlyInput } from "./types.js";

export function archiveRtOnly(input: RtOnlyInput) {
  return {
    archive: {
      postId: input.postId,
      expertHandle: input.expertHandle,
      retweetedPostId: input.retweetedPostId,
      selfRt: input.selfRt,
      notes:
        input.residualTextLen === 0
          ? "RT-only archived; excluded from triage"
          : "RT-like post archived for manual review",
    },
    contextCandidate: null,
  };
}
