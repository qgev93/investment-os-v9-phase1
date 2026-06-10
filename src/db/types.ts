import type { CanonicalStatus, TriageDecision, TrustLayer } from "../domain/index.js";

export interface LedgerPostInput {
  postId: string;
  expertHandle: string;
  trustLayer: TrustLayer;
  fetchedVia: "fixture" | "manual" | "twscrape" | "apify" | "x_ppu" | "scrapfly";
  isRtOnly: boolean;
  costUsd: number;
  conversationId?: string;
  referencedType?: string;
  residualTextLen?: number;
}

export interface RtArchiveInput {
  postId: string;
  expertHandle: string;
  retweetedPostId?: string;
  selfRt: boolean;
  notes?: string;
}

export interface ContextUnitRecord {
  unitId: string;
  expertHandle: string;
  originalText: string;
  completedAt: string;
  canonicalStatus: CanonicalStatus;
  rtOnlyExcluded: boolean;
  structuralBasis: string[];
  triageDecision?: TriageDecision;
  triageSentAt?: string;
  triageMessageId?: number;
  internalizationState?:
    | "in_progress"
    | "hint_requested"
    | "retry_requested"
    | "mastery_check_requested"
    | "rescheduled"
    | "completed";
}

export interface JitQueueRecord {
  unitId: string;
  selectedForBatchAt: string;
  status: "queued" | "verified" | "quarantined" | "failed";
  provider: string;
}

export interface ChairmanAttemptRecord {
  unitId: string;
  attemptText: string;
  attemptedAt: string;
}

export interface Phase1Store {
  kind: "memory" | "postgres";
  upsertLedgerPost(input: LedgerPostInput): Promise<void>;
  archiveRtOnly(input: RtArchiveInput): Promise<void>;
  upsertContextUnit(input: ContextUnitRecord): Promise<void>;
  countLedgerPosts(): Promise<number>;
  countRtOnlyArchive(): Promise<number>;
  listContextUnits(): Promise<ContextUnitRecord[]>;
  getContextUnit(unitId: string): Promise<ContextUnitRecord | null>;
  setTriageDecision(unitId: string, decision: TriageDecision): Promise<void>;
  markTriageSent(unitId: string, sentAt: string, messageId: number): Promise<void>;
  setInternalizationState(unitId: string, state: NonNullable<ContextUnitRecord["internalizationState"]>): Promise<void>;
  findActiveInternalizationUnit(): Promise<ContextUnitRecord | null>;
  addChairmanAttempt(input: ChairmanAttemptRecord): Promise<void>;
  listChairmanAttempts(unitId: string): Promise<ChairmanAttemptRecord[]>;
  enqueueJitUnits(limit: number): Promise<ContextUnitRecord[]>;
  nextTriageUnit(): Promise<ContextUnitRecord | null>;
}
