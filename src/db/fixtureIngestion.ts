import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalStatus, TrustLayer } from "../domain/index.js";
import type { ContextUnitRecord, Phase1Store } from "./types.js";
import { ingestPostsIntoStore } from "../ingestion/storeIngestion.js";

interface FixturePost {
  post_id: string;
  expert_handle: string;
  text: string;
  created_at: string;
  trust_layer: TrustLayer;
  is_rt_only: boolean;
  retweeted_post_id?: string;
  structural_basis: string[];
}

interface FixtureData {
  posts: FixturePost[];
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function fixturePath(): string {
  return resolve(projectRoot(), "fixtures/korean-sample-run.json");
}

function statusForTrustLayer(trustLayer: TrustLayer): CanonicalStatus {
  return trustLayer === "canonical" ? "verified" : "pending";
}

function toContextUnit(post: FixturePost): ContextUnitRecord {
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

export async function ingestFixtureIntoStore(store: Phase1Store) {
  const fixture = JSON.parse(readFileSync(fixturePath(), "utf8")) as FixtureData;
  return ingestPostsIntoStore(store, fixture.posts, "fixture");
}
