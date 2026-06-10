export type CanonicalStatus = "pending" | "verified" | "quarantined";
export type TrustLayer = "canonical" | "gray" | "quarantined" | "pending";
export type TriageDecision = "체화" | "체화_안해도_됨" | "보류";
export type PatternTrackingStatus =
  | "advisory_candidate"
  | "reinforcement"
  | "evolution"
  | "reversal";

export interface Phase1Config {
  eliteHandles: [string, string, string];
  allowPaidProviders: boolean;
  costSoftAlertKrw: number;
  costHardStopKrw: number;
  krwPerUsd: number;
  ai: {
    mode: "off" | "needed_only";
    primaryProvider: "deepseek";
    primaryModel: string;
    judgeProvider: "deepseek" | "anthropic";
    judgeModel: string;
    judgeMode: "off" | "important_only";
    dailyLimitKrw: number;
    monthlyLimitKrw: number;
  };
}

export interface RtOnlyInput {
  postId: string;
  expertHandle: string;
  retweetedPostId: string;
  selfRt: boolean;
  residualTextLen: number;
}

export interface ContextGateInput {
  canonicalStatus: CanonicalStatus;
  rtOnlyExcluded: boolean;
  triageDecision?: TriageDecision;
}

export interface ContextCandidate {
  unitId: string;
  completedAt: string;
  canonicalStatus: CanonicalStatus;
  rtOnlyExcluded: boolean;
}
