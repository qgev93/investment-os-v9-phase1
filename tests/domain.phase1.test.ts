import { describe, expect, it } from "vitest";
import {
  archiveRtOnly,
  buildCostDecision,
  canEnterInternalization,
  canEnterTriage,
  createPatternAdvisory,
  enqueueJitBatch,
  loadPhase1Config,
  rejectPaidProvider,
  resolveTrustGate,
} from "../src/domain/index.js";

describe("Phase 1 free-by-default policy", () => {
  it("loads the Elite 3 handles and blocks paid providers by default", () => {
    const config = loadPhase1Config({});

    expect(config.eliteHandles).toEqual([
      "@min_anko38",
      "@LNCV34",
      "@Alisvolatprop12",
    ]);
    expect(config.allowPaidProviders).toBe(false);
    expect(() => rejectPaidProvider(config, "x_ppu")).toThrow(
      "Paid provider x_ppu is disabled",
    );
  });

  it("defaults AI to needed-only DeepSeek for scoring judgement", () => {
    const config = loadPhase1Config({});

    expect(config.ai).toEqual({
      mode: "needed_only",
      primaryProvider: "deepseek",
      primaryModel: "deepseek-v4-flash",
      judgeProvider: "deepseek",
      judgeModel: "deepseek-v4-flash",
      judgeMode: "important_only",
      dailyLimitKrw: 3_000,
      monthlyLimitKrw: 30_000,
    });
  });

  it("archives RT-only posts and keeps them out of triage", () => {
    const archived = archiveRtOnly({
      postId: "rt-1",
      expertHandle: "@min_anko38",
      retweetedPostId: "source-1",
      selfRt: false,
      residualTextLen: 0,
    });

    expect(archived.archive.postId).toBe("rt-1");
    expect(archived.contextCandidate).toBeNull();
    expect(canEnterTriage({ canonicalStatus: "verified", rtOnlyExcluded: true }))
      .toBe(false);
  });

  it("keeps gray discovery data out of triage and quarantines conflicts", () => {
    expect(resolveTrustGate({ discoveryLayer: "gray" })).toEqual({
      canonicalStatus: "pending",
      triageEligible: false,
      reason: "gray_discovery_only",
    });

    expect(
      resolveTrustGate({
        discoveryLayer: "gray",
        canonicalLayer: "canonical",
        conflictDetected: true,
      }),
    ).toEqual({
      canonicalStatus: "quarantined",
      triageEligible: false,
      reason: "canonical_conflict",
    });
  });

  it("only verified non-RT units can enter triage and internalization", () => {
    expect(canEnterTriage({ canonicalStatus: "pending", rtOnlyExcluded: false }))
      .toBe(false);
    expect(canEnterTriage({ canonicalStatus: "verified", rtOnlyExcluded: false }))
      .toBe(true);

    expect(
      canEnterInternalization({
        canonicalStatus: "verified",
        rtOnlyExcluded: false,
        triageDecision: "체화",
      }),
    ).toBe(true);
    expect(
      canEnterInternalization({
        canonicalStatus: "verified",
        rtOnlyExcluded: false,
        triageDecision: "보류",
      }),
    ).toBe(false);
  });

  it("enqueues only the next JIT batch without full-corpus verification", () => {
    const batch = enqueueJitBatch(
      [
        { unitId: "u3", completedAt: "2026-01-03T00:00:00.000Z", canonicalStatus: "pending", rtOnlyExcluded: false },
        { unitId: "u1", completedAt: "2026-01-01T00:00:00.000Z", canonicalStatus: "pending", rtOnlyExcluded: false },
        { unitId: "u2", completedAt: "2026-01-02T00:00:00.000Z", canonicalStatus: "verified", rtOnlyExcluded: false },
        { unitId: "rt", completedAt: "2026-01-04T00:00:00.000Z", canonicalStatus: "pending", rtOnlyExcluded: true },
      ],
      1,
    );

    expect(batch.map((item) => item.unitId)).toEqual(["u1"]);
  });

  it("soft-alerts at 300k KRW and hard-stops at 500k KRW", () => {
    expect(buildCostDecision({ spentKrw: 299_999 })).toEqual({
      state: "ok",
      allowOfflineBatch: true,
      allowNewPaidVerification: true,
      allowNewDeepSession: true,
    });
    expect(buildCostDecision({ spentKrw: 300_000 })).toMatchObject({
      state: "soft_alert",
      allowOfflineBatch: false,
      allowNewPaidVerification: true,
    });
    expect(buildCostDecision({ spentKrw: 500_000 })).toEqual({
      state: "hard_stop",
      allowOfflineBatch: false,
      allowNewPaidVerification: false,
      allowNewDeepSession: false,
    });
  });

  it("tracks repeated patterns as advisory-only and never auto-skips", () => {
    expect(createPatternAdvisory({ signatureText: "cashflow discipline", repeatCount: 7 }))
      .toEqual({
        signatureText: "cashflow discipline",
        status: "reinforcement",
        advisoryOnly: true,
        autoSkipAllowed: false,
      });
  });
});
