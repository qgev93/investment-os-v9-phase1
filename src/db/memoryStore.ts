import type {
  ContextUnitRecord,
  ChairmanAttemptRecord,
  JitQueueRecord,
  LedgerPostInput,
  Phase1Store,
  RtArchiveInput,
} from "./types.js";
import type { TriageDecision } from "../domain/index.js";

export interface MemoryStoreSnapshot {
  ledger: LedgerPostInput[];
  rtArchive: RtArchiveInput[];
  contextUnits: ContextUnitRecord[];
  jitQueue: JitQueueRecord[];
  chairmanAttempts: ChairmanAttemptRecord[];
}

export class MemoryPhase1Store implements Phase1Store {
  readonly kind = "memory";
  private ledger = new Map<string, LedgerPostInput>();
  private rtArchive = new Map<string, RtArchiveInput>();
  private contextUnits = new Map<string, ContextUnitRecord>();
  private jitQueue = new Map<string, JitQueueRecord>();
  private chairmanAttempts: ChairmanAttemptRecord[] = [];

  async upsertLedgerPost(input: LedgerPostInput): Promise<void> {
    this.ledger.set(input.postId, input);
  }

  async archiveRtOnly(input: RtArchiveInput): Promise<void> {
    this.rtArchive.set(input.postId, input);
  }

  async upsertContextUnit(input: ContextUnitRecord): Promise<void> {
    this.contextUnits.set(input.unitId, input);
  }

  async countLedgerPosts(): Promise<number> {
    return this.ledger.size;
  }

  async countRtOnlyArchive(): Promise<number> {
    return this.rtArchive.size;
  }

  async listContextUnits(): Promise<ContextUnitRecord[]> {
    return [...this.contextUnits.values()].sort((a, b) =>
      a.completedAt.localeCompare(b.completedAt),
    );
  }

  async getContextUnit(unitId: string): Promise<ContextUnitRecord | null> {
    return this.contextUnits.get(unitId) ?? null;
  }

  async setTriageDecision(unitId: string, decision: TriageDecision): Promise<void> {
    const existing = this.contextUnits.get(unitId);
    if (!existing) {
      throw new Error(`Context unit not found: ${unitId}`);
    }
    this.contextUnits.set(unitId, { ...existing, triageDecision: decision });
  }

  async markTriageSent(unitId: string, sentAt: string, messageId: number): Promise<void> {
    const existing = this.contextUnits.get(unitId);
    if (!existing) {
      throw new Error(`Context unit not found: ${unitId}`);
    }
    this.contextUnits.set(unitId, {
      ...existing,
      triageSentAt: sentAt,
      triageMessageId: messageId,
    });
  }

  async setInternalizationState(
    unitId: string,
    state: NonNullable<ContextUnitRecord["internalizationState"]>,
  ): Promise<void> {
    const existing = this.contextUnits.get(unitId);
    if (!existing) {
      throw new Error(`Context unit not found: ${unitId}`);
    }
    this.contextUnits.set(unitId, { ...existing, internalizationState: state });
  }

  async findActiveInternalizationUnit(): Promise<ContextUnitRecord | null> {
    const activeUnits = (await this.listContextUnits()).filter(
      (unit) =>
        unit.triageDecision === "\uCCB4\uD654" &&
        unit.canonicalStatus === "verified" &&
        !unit.rtOnlyExcluded &&
        unit.internalizationState !== "completed",
    );
    return activeUnits.at(-1) ?? null;
  }

  async addChairmanAttempt(input: ChairmanAttemptRecord): Promise<void> {
    this.chairmanAttempts.push(input);
  }

  async listChairmanAttempts(unitId: string): Promise<ChairmanAttemptRecord[]> {
    return this.chairmanAttempts.filter((attempt) => attempt.unitId === unitId);
  }

  async enqueueJitUnits(limit: number): Promise<ContextUnitRecord[]> {
    const queued = (await this.listContextUnits())
      .filter((unit) => unit.canonicalStatus === "pending")
      .filter((unit) => !unit.rtOnlyExcluded)
      .slice(0, limit);
    const now = new Date().toISOString();
    for (const unit of queued) {
      this.jitQueue.set(unit.unitId, {
        unitId: unit.unitId,
        selectedForBatchAt: now,
        status: "queued",
        provider: "manual",
      });
    }
    return queued;
  }

  async nextTriageUnit(): Promise<ContextUnitRecord | null> {
    return (
      (await this.listContextUnits()).find(
        (unit) =>
          unit.canonicalStatus === "verified" &&
          !unit.rtOnlyExcluded &&
          unit.triageDecision === undefined &&
          unit.triageSentAt === undefined,
      ) ?? null
    );
  }

  snapshot(): MemoryStoreSnapshot {
    return {
      ledger: [...this.ledger.values()],
      rtArchive: [...this.rtArchive.values()],
      contextUnits: [...this.contextUnits.values()],
      jitQueue: [...this.jitQueue.values()],
      chairmanAttempts: [...this.chairmanAttempts],
    };
  }

  loadSnapshot(snapshot: MemoryStoreSnapshot): void {
    this.ledger = new Map(snapshot.ledger.map((row) => [row.postId, row]));
    this.rtArchive = new Map(snapshot.rtArchive.map((row) => [row.postId, row]));
    this.contextUnits = new Map(snapshot.contextUnits.map((row) => [row.unitId, row]));
    this.jitQueue = new Map(snapshot.jitQueue.map((row) => [row.unitId, row]));
    this.chairmanAttempts = snapshot.chairmanAttempts ?? [];
  }
}
