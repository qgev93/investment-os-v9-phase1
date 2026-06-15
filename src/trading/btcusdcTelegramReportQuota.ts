import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface BtcusdcTelegramReportQuotaState {
  currentDate?: string;
  sentCount?: number;
  sentAtIso?: string[];
  messageIds?: number[];
}

export interface BtcusdcTelegramReportQuotaDecision {
  allowed: boolean;
  currentDate: string;
  sentCount: number;
  maxPerDay: number;
}

function kstDate(nowIso: string): string {
  const time = Date.parse(nowIso);
  if (!Number.isFinite(time)) throw new Error("nowIso must be a valid ISO date");
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function loadQuotaState(path: string): BtcusdcTelegramReportQuotaState {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as BtcusdcTelegramReportQuotaState;
}

function stateForDate(state: BtcusdcTelegramReportQuotaState, currentDate: string): BtcusdcTelegramReportQuotaState {
  if (state.currentDate === currentDate) return state;
  return { currentDate, sentCount: 0, sentAtIso: [], messageIds: [] };
}

export function shouldSendBtcusdcTelegramReport(input: {
  quotaPath: string;
  nowIso: string;
  maxPerDay: number;
}): BtcusdcTelegramReportQuotaDecision {
  const currentDate = kstDate(input.nowIso);
  const state = stateForDate(loadQuotaState(input.quotaPath), currentDate);
  const sentCount = state.sentCount ?? 0;
  return {
    allowed: sentCount < input.maxPerDay,
    currentDate,
    sentCount,
    maxPerDay: input.maxPerDay,
  };
}

export function recordBtcusdcTelegramReportSend(input: {
  quotaPath: string;
  nowIso: string;
  messageId?: number | null;
}): BtcusdcTelegramReportQuotaState {
  const currentDate = kstDate(input.nowIso);
  const state = stateForDate(loadQuotaState(input.quotaPath), currentDate);
  const next: BtcusdcTelegramReportQuotaState = {
    currentDate,
    sentCount: (state.sentCount ?? 0) + 1,
    sentAtIso: [...(state.sentAtIso ?? []), input.nowIso],
    messageIds: input.messageId === undefined || input.messageId === null ? state.messageIds ?? [] : [...(state.messageIds ?? []), input.messageId],
  };
  mkdirSync(dirname(input.quotaPath), { recursive: true });
  writeFileSync(input.quotaPath, JSON.stringify(next, null, 2));
  return next;
}
