import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPhase1Store,
  FilePhase1Store,
  ingestFixtureIntoStore,
  type ContextUnitRecord,
} from "../src/db/index.js";

describe("Phase 1 store", () => {
  it("uses an in-memory store when DATABASE_URL is absent", async () => {
    const store = createPhase1Store({});

    expect(store.kind).toBe("memory");

    await store.upsertLedgerPost({
      postId: "p1",
      expertHandle: "@min_anko38",
      trustLayer: "canonical",
      fetchedVia: "fixture",
      isRtOnly: false,
      costUsd: 0,
    });

    expect(await store.countLedgerPosts()).toBe(1);
  });

  it("selects a Postgres-compatible store when DATABASE_URL is present", () => {
    const store = createPhase1Store({
      DATABASE_URL: "postgresql://example:example@localhost:5432/example",
    });

    expect(store.kind).toBe("postgres");
  });

  it("persists fixture ingestion into ledger, archive, and context buckets", async () => {
    const store = createPhase1Store({});
    const result = await ingestFixtureIntoStore(store);

    expect(result).toEqual({
      postsFetched: 4,
      ledgerRows: 4,
      rtOnlyArchived: 1,
      contextUnits: 3,
      paidCalls: 0,
    });
    expect(await store.countLedgerPosts()).toBe(4);
    expect(await store.countRtOnlyArchive()).toBe(1);
    expect(await store.listContextUnits()).toHaveLength(3);
  });

  it("stores JIT queue entries and returns the next triage-ready unit", async () => {
    const store = createPhase1Store({});
    await ingestFixtureIntoStore(store);

    const queued = await store.enqueueJitUnits(10);
    expect(queued.map((unit) => unit.unitId)).toEqual(["lncv-001"]);

    const triage = (await store.nextTriageUnit()) as ContextUnitRecord;
    expect(triage.unitId).toBe("min-001");
    expect(triage.canonicalStatus).toBe("verified");
    expect(triage.rtOnlyExcluded).toBe(false);
  });

  it("does not return units that already have a triage decision", async () => {
    const store = createPhase1Store({});
    await ingestFixtureIntoStore(store);

    await store.setTriageDecision("min-001", "\uCCB4\uD654");

    const triage = (await store.nextTriageUnit()) as ContextUnitRecord;
    expect(triage.unitId).toBe("alis-001");
    expect(triage.triageDecision).toBeUndefined();
  });

  it("does not return units that already have a triage card awaiting decision", async () => {
    const store = createPhase1Store({});
    await ingestFixtureIntoStore(store);

    await store.markTriageSent("min-001", "2026-01-01T00:00:00.000Z", 69);

    const triage = (await store.nextTriageUnit()) as ContextUnitRecord;
    expect(triage.unitId).toBe("alis-001");
    expect(triage.triageSentAt).toBeUndefined();
  });

  it("uses the latest internalized verified unit as the active internalization target", async () => {
    const store = createPhase1Store({});
    await ingestFixtureIntoStore(store);

    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    await store.setTriageDecision("alis-001", "\uCCB4\uD654");

    const active = await store.findActiveInternalizationUnit();
    expect(active?.unitId).toBe("alis-001");
  });

  it("persists local no-cost state to a JSON file across store instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phase1-store-"));
    const filePath = join(dir, "store.json");

    try {
      const first = new FilePhase1Store(filePath);
      await ingestFixtureIntoStore(first);

      const second = new FilePhase1Store(filePath);
      expect(await second.countLedgerPosts()).toBe(4);
      expect(await second.countRtOnlyArchive()).toBe(1);
      expect((await second.nextTriageUnit())?.unitId).toBe("min-001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
