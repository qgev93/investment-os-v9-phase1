import type { Phase1Config } from "./types.js";

const DEFAULT_ELITE3 = "@min_anko38,@LNCV34,@Alisvolatprop12";

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAiMode(value: string | undefined): Phase1Config["ai"]["mode"] {
  return value === "off" ? "off" : "needed_only";
}

function parseJudgeMode(value: string | undefined): Phase1Config["ai"]["judgeMode"] {
  return value === "off" ? "off" : "important_only";
}

function parseEliteHandles(raw: string | undefined): [string, string, string] {
  const handles = (raw ?? DEFAULT_ELITE3)
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);

  if (handles.length !== 3) {
    throw new Error("Phase 1 requires exactly three Elite handles");
  }

  return handles as [string, string, string];
}

export function loadPhase1Config(env: Record<string, string | undefined>): Phase1Config {
  return {
    eliteHandles: parseEliteHandles(env.ELITE3_HANDLES),
    allowPaidProviders: parseBoolean(env.ALLOW_PAID_PROVIDERS),
    costSoftAlertKrw: parseNumber(env.COST_SOFT_ALERT_KRW, 300_000),
    costHardStopKrw: parseNumber(env.COST_HARD_STOP_KRW, 500_000),
    krwPerUsd: parseNumber(env.KRW_PER_USD, 1_500),
    ai: {
      mode: parseAiMode(env.AI_MODE),
      primaryProvider: "deepseek",
      primaryModel: env.AI_MODEL_PRIMARY?.trim() || "deepseek-v4-flash",
      judgeProvider: "deepseek",
      judgeModel: env.AI_MODEL_JUDGE?.trim() || "deepseek-v4-flash",
      judgeMode: parseJudgeMode(env.AI_JUDGE_MODE),
      dailyLimitKrw: parseNumber(env.AI_DAILY_LIMIT_KRW, 3_000),
      monthlyLimitKrw: parseNumber(env.AI_MONTHLY_LIMIT_KRW, 30_000),
    },
  };
}
