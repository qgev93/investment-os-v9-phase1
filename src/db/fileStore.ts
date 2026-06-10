import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryPhase1Store, type MemoryStoreSnapshot } from "./memoryStore.js";
import type { ChairmanAttemptRecord, ContextUnitRecord, LedgerPostInput, Phase1Store, RtArchiveInput } from "./types.js";
import type { TriageDecision } from "../domain/index.js";

function emptySnapshot(): MemoryStoreSnapshot {
  return {
    ledger: [],
    rtArchive: [],
    contextUnits: [],
    jitQueue: [],
    chairmanAttempts: [],
  };
}

export class FilePhase1Store extends MemoryPhase1Store {
  readonly kind = "memory";
  private batchDepth = 0;

  constructor(private readonly filePath: string) {
    super();
    this.loadSnapshot(this.readSnapshot());
  }

  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.batchDepth += 1;
    try {
      return await fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) {
        this.writeSnapshot();
      }
    }
  }

  override async upsertLedgerPost(input: LedgerPostInput): Promise<void> {
    await super.upsertLedgerPost(input);
    this.writeSnapshot();
  }

  override async archiveRtOnly(input: RtArchiveInput): Promise<void> {
    await super.archiveRtOnly(input);
    this.writeSnapshot();
  }

  override async upsertContextUnit(input: ContextUnitRecord): Promise<void> {
    await super.upsertContextUnit(input);
    this.writeSnapshot();
  }

  override async enqueueJitUnits(limit: number): Promise<ContextUnitRecord[]> {
    const queued = await super.enqueueJitUnits(limit);
    this.writeSnapshot();
    return queued;
  }

  override async setTriageDecision(unitId: string, decision: TriageDecision): Promise<void> {
    await super.setTriageDecision(unitId, decision);
    this.writeSnapshot();
  }

  override async markTriageSent(unitId: string, sentAt: string, messageId: number): Promise<void> {
    await super.markTriageSent(unitId, sentAt, messageId);
    this.writeSnapshot();
  }

  override async setInternalizationState(
    unitId: string,
    state: NonNullable<ContextUnitRecord["internalizationState"]>,
  ): Promise<void> {
    await super.setInternalizationState(unitId, state);
    this.writeSnapshot();
  }

  override async addChairmanAttempt(input: ChairmanAttemptRecord): Promise<void> {
    await super.addChairmanAttempt(input);
    this.writeSnapshot();
  }

  private readSnapshot(): MemoryStoreSnapshot {
    if (!existsSync(this.filePath)) return emptySnapshot();
    return JSON.parse(readFileSync(this.filePath, "utf8")) as MemoryStoreSnapshot;
  }

  private writeSnapshot(): void {
    if (this.batchDepth > 0) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.snapshot(), null, 2));
  }
}

export async function withFileStoreBatch<T>(store: Phase1Store, fn: () => Promise<T>): Promise<T> {
  if (store instanceof FilePhase1Store) {
    return store.batch(fn);
  }
  return fn();
}
