import type { CanonicalStatus, TrustLayer } from "../domain/index.js";
import type { ContextUnitRecord, Phase1Store } from "../db/index.js";
import type { ManualImportPost } from "./manualImport.js";

function statusForTrustLayer(trustLayer: TrustLayer): CanonicalStatus {
  if (trustLayer === "canonical") return "verified";
  if (trustLayer === "quarantined") return "quarantined";
  return "pending";
}

function toContextUnit(post: ManualImportPost): ContextUnitRecord {
  return {
    unitId: post.post_id,
    expertHandle: post.expert_handle,
    originalText: post.text,
    completedAt: post.created_at,
    canonicalStatus: statusForTrustLayer(post.trust_layer),
    rtOnlyExcluded: post.is_rt_only,
    structuralBasis: post.structural_basis,
  };
}

export async function ingestPostsIntoStore(
  store: Phase1Store,
  posts: ManualImportPost[],
  fetchedVia: "manual" | "fixture" | "twscrape" = "manual",
) {
  for (const post of posts) {
    await store.upsertLedgerPost({
      postId: post.post_id,
      expertHandle: post.expert_handle,
      trustLayer: post.trust_layer,
      fetchedVia,
      isRtOnly: post.is_rt_only,
      costUsd: 0,
      referencedType: post.retweeted_post_id ? "retweeted" : undefined,
      residualTextLen: post.text.length,
    });

    if (post.is_rt_only) {
      await store.archiveRtOnly({
        postId: post.post_id,
        expertHandle: post.expert_handle,
        retweetedPostId: post.retweeted_post_id,
        selfRt: false,
      });
      continue;
    }

    await store.upsertContextUnit(toContextUnit(post));
  }

  return {
    postsFetched: posts.length,
    ledgerRows: await store.countLedgerPosts(),
    rtOnlyArchived: await store.countRtOnlyArchive(),
    contextUnits: (await store.listContextUnits()).length,
    paidCalls: 0,
  };
}
