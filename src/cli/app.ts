import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhase1FileStore, createPhase1Store, ingestFixtureIntoStore, withFileStoreBatch, type Phase1Store } from "../db/index.js";
import { parseManualImportFile } from "../ingestion/manualImport.js";
import { ingestPostsIntoStore } from "../ingestion/storeIngestion.js";
import { ingestXApiContextUnitsIntoStore, parseXApiContextUnitFile } from "../ingestion/xApiContextUnits.js";
import {
  TelegramBotClient,
  type TelegramMessagePayload,
  buildTelegramInternalizationMessage,
  buildTelegramOpsMenuMessage,
  buildTelegramTriageMessage,
  requireTelegramToken,
} from "../telegram/client.js";
import { handleTelegramCallback } from "../telegram/callbacks.js";
import { handleTelegramTextAttempt } from "../telegram/internalization.js";
import { loadTelegramOffset, saveTelegramOffset } from "../telegram/pollState.js";
import { TRIAGE_ACTION_BUTTONS } from "../telegram/labels.js";
import {
  advanceBtcusdcPaperTradingState,
  appendBtcusdcPaperTradingEvents,
  buildBtcusdcPaperTelegramMessage,
  createInitialBtcusdcPaperTradingState,
  loadBtcusdcPaperTradingState,
  saveBtcusdcPaperTradingState,
} from "../trading/btcusdcPaperTrading.js";
import {
  buildBtcusdcDailyPerformanceTelegramMessage,
  loadBtcusdcPaperTradingEventLog,
} from "../trading/btcusdcDailyReport.js";
import {
  recordBtcusdcTelegramReportSend,
  shouldSendBtcusdcTelegramReport,
} from "../trading/btcusdcTelegramReportQuota.js";
import { buildBtcusdcSixMonthCoreResearchReport } from "../trading/btcusdcCoreResearch.js";
import {
  buildBtcusdcActivePaperCandidateSets,
  defaultBtcusdcStrategyRegistry,
  filterBtcusdcCoreTelegramEvents,
  loadBtcusdcStrategyRegistryOrDefault,
} from "../trading/btcusdcStrategyRegistry.js";
import {
  buildBtcusdtEdgeZoneFragilityReport,
  buildBtcusdtEdgeZonePortfolioReport,
  buildBtcusdtEdgeZonePortfolioRobustnessReport,
  buildBtcusdtEdgeZonePortfolioRollingReport,
  buildBtcusdtEdgeZonePortfolioExecutionSweepReport,
  buildBtcusdtEdgeZoneStressReport,
  buildBtcusdtResearchReport,
  buildBtcusdtResearchSweep,
  buildBtcusdtStrategylessOhlcvReport,
  buildBtcusdtWalkForwardReport,
  fetchBinanceBtcusdtOneMinuteCandles,
  loadCandlesFromBinanceKlineFile,
  type EdgeZonePortfolioCandidate,
  type ReplayEntryMode,
} from "../trading/btcusdtResearch.js";
import {
  buildCostDecision,
  canEnterTriage,
  enqueueJitBatch,
  loadPhase1Config,
  type CanonicalStatus,
} from "../domain/index.js";

interface FixturePost {
  post_id: string;
  expert_handle: string;
  text: string;
  created_at: string;
  trust_layer: "canonical" | "gray" | "pending";
  is_rt_only: boolean;
  structural_basis: string[];
}

interface FixtureData {
  experts: string[];
  posts: FixturePost[];
}

export interface CommandResult {
  ok: boolean;
  data: unknown;
}

interface TelegramPollSummary {
  updatesSeen: number;
  callbacksHandled: number;
  textCommandsHandled: number;
  textAttemptsHandled: number;
  nextOffset?: number;
  results: unknown[];
}

const memoryStores = new Map<string, Phase1Store>();
const OPS_MENU_VERSION = "triage-internalization-split-v1";
const REPLAY_ENTRY_MODES = new Set<ReplayEntryMode>([
  "next-open",
  "limit-signal-close",
  "limit-quarter-pullback",
  "limit-half-pullback",
]);

interface TelegramMenuState {
  chatId: string;
  messageId: number;
  menuVersion: string;
  sentAt: string;
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function loadFixture(): FixtureData {
  const path = resolve(projectRoot(), "fixtures/korean-sample-run.json");
  return JSON.parse(readFileSync(path, "utf8")) as FixtureData;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function btcusdcTelegramQuotaPath(args: string[], env: Record<string, string | undefined>): string {
  return flagValue(args, "--telegram-quota-path") ?? env.BTCUSDC_TELEGRAM_REPORT_QUOTA_PATH ?? "/data/btcusdc-telegram-report-quota.json";
}

function btcusdcTelegramQuotaMax(args: string[], env: Record<string, string | undefined>): number {
  return Number(flagValue(args, "--telegram-quota-max-per-day") ?? env.BTCUSDC_TELEGRAM_REPORT_MAX_PER_DAY ?? "2");
}

async function sendBtcusdcTelegramReport(input: {
  args: string[];
  env: Record<string, string | undefined>;
  chatId: string;
  payload: TelegramMessagePayload;
  nowIso: string;
}): Promise<{ telegramSent: boolean; telegramMessageId: number | null; telegramSkippedReason: string | null }> {
  const quotaPath = btcusdcTelegramQuotaPath(input.args, input.env);
  const maxPerDay = btcusdcTelegramQuotaMax(input.args, input.env);
  const decision = shouldSendBtcusdcTelegramReport({
    quotaPath,
    nowIso: input.nowIso,
    maxPerDay,
  });
  if (!decision.allowed) {
    return {
      telegramSent: false,
      telegramMessageId: null,
      telegramSkippedReason: "daily_quota_exhausted",
    };
  }

  const client = new TelegramBotClient({ token: requireTelegramToken(input.env) });
  const sent = await client.sendMessage(input.chatId, input.payload);
  recordBtcusdcTelegramReportSend({ quotaPath, nowIso: input.nowIso, messageId: sent.message_id });
  return {
    telegramSent: true,
    telegramMessageId: sent.message_id,
    telegramSkippedReason: null,
  };
}

function parseNumberList(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
}

function parsePortfolioCandidates(value: string): EdgeZonePortfolioCandidate[] {
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [label, strategyId, zoneId, entryMode, targetR, maxHoldFiveMinuteBars] = entry
        .split("|")
        .map((part) => part.trim());
      if (
        !label ||
        !strategyId ||
        !zoneId ||
        !REPLAY_ENTRY_MODES.has(entryMode as ReplayEntryMode) ||
        !Number.isFinite(Number(targetR)) ||
        !Number.isFinite(Number(maxHoldFiveMinuteBars))
      ) {
        throw new Error(
          "--portfolio-candidates entries must be label|strategyId|zoneId|entryMode|targetR|hold5m separated by semicolons",
        );
      }
      return {
        label,
        strategyId,
        zoneId,
        entryMode: entryMode as ReplayEntryMode,
        targetR: Number(targetR),
        maxHoldFiveMinuteBars: Number(maxHoldFiveMinuteBars),
      };
    });
}

function getStore(env: Record<string, string | undefined>): Phase1Store {
  if (env.DATABASE_URL) {
    return createPhase1Store(env);
  }

  const key = env.PHASE1_MEMORY_STORE_KEY ?? env.PHASE1_STORE_PATH ?? "default";
  const existing = memoryStores.get(key);
  if (existing) return existing;

  const store = createPhase1FileStore(env);
  memoryStores.set(key, store);
  return store;
}

function canonicalStatusFor(post: FixturePost): CanonicalStatus {
  if (post.trust_layer === "canonical") return "verified";
  if (post.trust_layer === "gray") return "pending";
  return "pending";
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function telegramMenuStatePath(env: Record<string, string | undefined>): string {
  return env.TELEGRAM_MENU_STATE_PATH ?? resolve(".phase1/telegram-menu-state.json");
}

function btcusdcPaperStatePath(env: Record<string, string | undefined>): string {
  return env.BTCUSDC_PAPER_STATE_PATH ?? resolve(".phase1/btcusdc-paper-state.json");
}

function btcusdcPaperLogPath(env: Record<string, string | undefined>): string {
  return env.BTCUSDC_PAPER_LOG_PATH ?? resolve(".phase1/btcusdc-paper-events.jsonl");
}

function readTelegramMenuState(path: string): TelegramMenuState | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TelegramMenuState;
}

function writeTelegramMenuState(path: string, state: TelegramMenuState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

async function buildOpsStatus(store: Phase1Store) {
  const contextUnits = await store.listContextUnits();
  const triageDecisions: Record<string, number> = {};
  const internalizationStates: Record<string, number> = {};
  let chairmanAttempts = 0;

  for (const unit of contextUnits) {
    if (unit.triageDecision) {
      triageDecisions[unit.triageDecision] = (triageDecisions[unit.triageDecision] ?? 0) + 1;
    }
    if (unit.internalizationState) {
      internalizationStates[unit.internalizationState] =
        (internalizationStates[unit.internalizationState] ?? 0) + 1;
    }
    chairmanAttempts += (await store.listChairmanAttempts(unit.unitId)).length;
  }

  const activeInternalizationUnit = await store.findActiveInternalizationUnit();

  return {
    store: store.kind,
    ledgerPosts: await store.countLedgerPosts(),
    rtOnlyArchived: await store.countRtOnlyArchive(),
    contextUnits: contextUnits.length,
    verifiedUnits: contextUnits.filter((unit) => unit.canonicalStatus === "verified").length,
    pendingUnits: contextUnits.filter((unit) => unit.canonicalStatus === "pending").length,
    triageDecisions,
    internalizationStates,
    triageSentAwaitingDecision: contextUnits.filter(
      (unit) => unit.triageSentAt && !unit.triageDecision,
    ).length,
    triageSentAwaitingDecisionUnitIds: contextUnits
      .filter((unit) => unit.triageSentAt && !unit.triageDecision)
      .map((unit) => unit.unitId),
    activeInternalizationUnitId: activeInternalizationUnit?.unitId ?? null,
    activeInternalizationState: activeInternalizationUnit?.internalizationState ?? null,
    nextUnsentTriageUnitId: (await store.nextTriageUnit())?.unitId ?? null,
    chairmanAttempts,
    paidCalls: 0,
  };
}

function formatOpsStatus(status: Awaited<ReturnType<typeof buildOpsStatus>>): string {
  return [
    "체화구분 봇 상태",
    "X 글을 가져와서, 체화할 글인지 먼저 고르는 곳이에요.",
    "체화 봇은 고른 글을 넘겨받아 따로 공부를 도와줘요.",
    `저장 위치: ${status.store === "memory" ? "내 컴퓨터" : "외부 DB"}`,
    `모은 글: ${status.ledgerPosts}`,
    `리트윗만 있던 글: ${status.rtOnlyArchived}`,
    `전체 글 묶음: ${status.contextUnits}`,
    `고를 수 있는 글: ${status.verifiedUnits}`,
    `확인이 더 필요한 글: ${status.pendingUnits}`,
    `아직 안 고른 글: ${status.triageSentAwaitingDecision}`,
    `안 고른 글 번호: ${status.triageSentAwaitingDecisionUnitIds.join(", ") || "없음"}`,
    `체화 봇에 넘긴 글: ${status.activeInternalizationUnitId ?? "없음"}`,
    `체화 진행: ${formatInternalizationState(status.activeInternalizationState)}`,
    `다음에 고를 글: ${status.nextUnsentTriageUnitId ?? "없음"}`,
    `내가 써본 답: ${status.chairmanAttempts}`,
    `유료 기능 사용: ${status.paidCalls}번`,
  ].join("\n");
}

function formatInternalizationState(state: string | null): string {
  if (state === "in_progress") return "\uD559\uC2B5 \uC911";
  if (state === "hint_requested") return "\uD78C\uD2B8 \uBCF4\uB294 \uC911";
  if (state === "retry_requested") return "\uB2E4\uC2DC \uD574\uBCF4\uB294 \uC911";
  if (state === "mastery_check_requested") return "\uC774\uD574\uD588\uB294\uC9C0 \uD655\uC778 \uC911";
  if (state === "rescheduled") return "\uB098\uC911\uC5D0 \uB2E4\uC2DC \uBCFC \uC608\uC815";
  return "\uC5C6\uC74C";
}

function formatPendingCards(units: Awaited<ReturnType<Phase1Store["listContextUnits"]>>): string {
  if (units.length === 0) {
    return "\uB300\uAE30 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
  }

  return [
    "\uB300\uAE30 \uCE74\uB4DC",
    "\uC544\uC9C1 \uD559\uC2B5 \uCE74\uB4DC\uB85C \uBCF4\uB0B4\uAE30 \uC804\uC5D0 \uD655\uC778\uC774 \uD544\uC694\uD55C \uCE74\uB4DC\uC785\uB2C8\uB2E4.",
    "\uD14C\uC2A4\uD2B8 \uBC84\uC804\uC774\uB77C \uC790\uB3D9 \uD655\uC778\uC740 \uAEBC\uC838 \uC788\uC2B5\uB2C8\uB2E4.",
    "",
    ...units.map((unit, index) =>
      [
        `${index + 1}. ${unit.unitId} / ${unit.expertHandle}`,
        `\uC6D0\uBB38: ${unit.originalText}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function withBackToMenuButton(text: string): TelegramMessagePayload {
  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "\uBA54\uB274\uB85C \uB3CC\uC544\uAC00\uAE30", callback_data: "ops:menu" }],
      ],
    },
  };
}

async function handleOpsCallback(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  callbackQueryId: string;
  chatId: string;
  data: string;
}) {
  if (input.data === "ops:menu") {
    await input.client.sendMessage(input.chatId, buildTelegramOpsMenuMessage());
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uBA54\uB274\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return { handled: true as const, action: "menu" as const, menuSent: true };
  }

  if (input.data === "ops:status") {
    await input.client.sendMessage(
      input.chatId,
      withBackToMenuButton(formatOpsStatus(await buildOpsStatus(input.store))),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uC0C1\uD0DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return { handled: true as const, action: "status" as const, statusSent: true };
  }

  if (input.data === "ops:send_next_triage") {
    const unit = await input.store.nextTriageUnit();
    if (!unit) {
      await input.client.sendMessage(
        input.chatId,
        withBackToMenuButton("\uC9C0\uAE08 \uBCF4\uB0BC \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."),
      );
      await input.client.answerCallbackQuery(input.callbackQueryId, "\uBCF4\uB0BC \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
      return {
        handled: true as const,
        action: "send_next_triage" as const,
        sent: false,
        reason: "no_triage_unit" as const,
        requiresPaidModel: false,
      };
    }

    const sent = await input.client.sendMessage(
      input.chatId,
      buildTelegramTriageMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
        canonicalStatus: unit.canonicalStatus,
      }),
    );
    await input.store.markTriageSent(unit.unitId, new Date().toISOString(), sent.message_id);
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return {
      handled: true as const,
      action: "send_next_triage" as const,
      sent: true,
      unitId: unit.unitId,
      messageId: sent.message_id,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:resume_learning") {
    const unit = await input.store.findActiveInternalizationUnit();
    if (!unit) {
      await input.client.sendMessage(
        input.chatId,
        withBackToMenuButton("\uC9C0\uAE08 \uC774\uC5B4\uAC08 \uD559\uC2B5 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."),
      );
      await input.client.answerCallbackQuery(input.callbackQueryId, "\uC774\uC5B4\uAC08 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
      return {
        handled: true as const,
        action: "resume_learning" as const,
        sent: false,
        reason: "no_active_learning" as const,
        requiresPaidModel: false,
      };
    }

    const sent = await input.client.sendMessage(
      input.chatId,
      buildTelegramInternalizationMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
      }),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uD559\uC2B5 \uCE74\uB4DC\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return {
      handled: true as const,
      action: "resume_learning" as const,
      sent: true,
      unitId: unit.unitId,
      messageId: sent.message_id,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:pending_cards") {
    const units = (await input.store.listContextUnits()).filter(
      (unit) => unit.canonicalStatus === "pending" && !unit.rtOnlyExcluded,
    );

    await input.client.sendMessage(input.chatId, withBackToMenuButton(formatPendingCards(units)));
    await input.client.answerCallbackQuery(
      input.callbackQueryId,
      units.length > 0
        ? "\uB300\uAE30 \uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4"
        : "\uB300\uAE30 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
    );
    return {
      handled: true as const,
      action: "pending_cards" as const,
      count: units.length,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:help") {
    await input.client.sendMessage(
      input.chatId,
      withBackToMenuButton([
        "버튼 설명",
        "구분할 글 받기: 체화할지 고를 글을 하나 받아요.",
        "보류 글 보기: 아직 고르기 애매해서 미뤄둔 글을 봐요.",
        "구분봇 상태: 몇 개를 모았고, 몇 개를 골랐는지 봐요.",
        "체화할래요를 누르면 체화 봇으로 넘어가요.",
        "체화구분 봇에서는 유료 AI를 쓰지 않아요.",
      ].join("\n")),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "버튼 설명을 보냈어요");
    return { handled: true as const, action: "help" as const, helpSent: true };
  }

  return { handled: false as const };
}

async function handleTelegramTextCommand(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  chatId: string;
  text: string;
}) {
  const command = input.text.trim().split(/\s+/)[0]?.toLowerCase();
  if (!command?.startsWith("/")) {
    return { handled: false as const, reason: "not_command" as const };
  }

  if (command === "/status") {
    await input.client.sendMessage(input.chatId, {
      text: formatOpsStatus(await buildOpsStatus(input.store)),
    });
    return {
      handled: true as const,
      command: "status" as const,
      statusSent: true,
      requiresPaidModel: false,
    };
  }

  await input.client.sendMessage(input.chatId, {
    text: "\uBA85\uB839\uC5B4\uB97C \uC9C1\uC811 \uCE58\uC9C0 \uC54A\uC544\uB3C4 \uB3FC\uC694. \uBA54\uB274 \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.",
  });
  return {
    handled: true as const,
    command: "unknown" as const,
    supportedCommandsSent: true,
    requiresPaidModel: false,
  };
}

async function pollTelegramOnce(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  offsetPath: string;
  internalizationChatId?: string;
  internalizationClient?: TelegramBotClient;
}): Promise<TelegramPollSummary> {
  const updates = await input.client.getUpdates(loadTelegramOffset(input.offsetPath));
  const results = [];
  let callbacksHandled = 0;
  let textCommandsHandled = 0;
  let textAttemptsHandled = 0;

  for (const update of updates) {
    if (update.callbackQueryId && update.callbackData && update.chatId) {
      const opsResult = await handleOpsCallback({
        store: input.store,
        client: input.client,
        callbackQueryId: update.callbackQueryId,
        chatId: update.chatId,
        data: update.callbackData,
      });
      if (opsResult.handled) {
        results.push(opsResult);
        callbacksHandled += 1;
        continue;
      }

      const result = await handleTelegramCallback({
        store: input.store,
        client: input.client,
        callbackQueryId: update.callbackQueryId,
        chatId: update.chatId,
        data: update.callbackData,
        internalizationChatId: input.internalizationChatId,
        internalizationClient: input.internalizationClient,
      });
      results.push(result);
      if (result.handled) callbacksHandled += 1;
      continue;
    }

    if (update.text && update.chatId) {
      const commandResult = await handleTelegramTextCommand({
        store: input.store,
        client: input.client,
        chatId: update.chatId,
        text: update.text,
      });
      if (commandResult.handled) {
        results.push(commandResult);
        textCommandsHandled += 1;
        continue;
      }

      const result = await handleTelegramTextAttempt({
        store: input.store,
        client: input.client,
        chatId: update.chatId,
        text: update.text,
      });
      results.push(result);
      if (result.handled) textAttemptsHandled += 1;
    }
  }

  const maxUpdateId = updates.reduce(
    (max, update) => Math.max(max, update.updateId),
    -1,
  );
  if (maxUpdateId >= 0) {
    saveTelegramOffset(input.offsetPath, maxUpdateId + 1);
  }

  return {
    updatesSeen: updates.length,
    callbacksHandled,
    textCommandsHandled,
    textAttemptsHandled,
    nextOffset: maxUpdateId >= 0 ? maxUpdateId + 1 : loadTelegramOffset(input.offsetPath),
    results,
  };
}

export async function runPhase1Command(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const command = args[0];
  const config = loadPhase1Config(env);
  const runBtcusdcPaperOnce = async () => {
    const filePath = flagValue(args, "--file");
    const symbol = flagValue(args, "--symbol") ?? env.BTCUSDC_PAPER_SYMBOL ?? "BTCUSDC";
    const displaySymbol = flagValue(args, "--display-symbol") ?? env.BTCUSDC_PAPER_DISPLAY_SYMBOL ?? "BTCUSDC.P";
    const days = Number(flagValue(args, "--days") ?? env.BTCUSDC_PAPER_DAYS ?? "3");
    const maxCandlesFlag = flagValue(args, "--max-candles") ?? flagValue(args, "--limit");
    const statePath = flagValue(args, "--state-path") ?? btcusdcPaperStatePath(env);
    const logPath = flagValue(args, "--log-path") ?? btcusdcPaperLogPath(env);
    const riskPctValue = flagValue(args, "--risk-pct") ?? env.BTCUSDC_PAPER_RISK_PCT;
    const riskPct = riskPctValue === undefined || riskPctValue.trim() === "" ? undefined : Number(riskPctValue);
    const initialEquity = Number(flagValue(args, "--initial-equity") ?? env.BTCUSDC_PAPER_INITIAL_EQUITY ?? "1000");
    const portfolioCandidateFlag = flagValue(args, "--portfolio-candidates");
    const registry = loadBtcusdcStrategyRegistryOrDefault(
      flagValue(args, "--registry-path") ?? env.BTCUSDC_STRATEGY_REGISTRY_PATH,
    );
    const registrySets = buildBtcusdcActivePaperCandidateSets(registry);
    const candidates = portfolioCandidateFlag ? parsePortfolioCandidates(portfolioCandidateFlag) : registrySets.runtimeCandidates;
    const microCandidates = portfolioCandidateFlag ? [] : registrySets.runtimeMicroCandidates;
    const strategylessCandidates = portfolioCandidateFlag ? [] : registrySets.runtimeStrategylessCandidates;
    const coreTelegramCandidateLabels = portfolioCandidateFlag
      ? new Set(candidates.map((candidate) => candidate.label ?? candidate.strategyId))
      : registrySets.coreTelegramCandidateLabels;
    const candles = filePath
      ? loadCandlesFromBinanceKlineFile(filePath)
      : await fetchBinanceBtcusdtOneMinuteCandles({
          symbol,
          days,
          maxCandles: maxCandlesFlag ? Number(maxCandlesFlag) : undefined,
        });
    const activationOpenTime =
      flagValue(args, "--activation-open-time") === undefined
        ? undefined
        : Number(flagValue(args, "--activation-open-time"));
    const state =
      loadBtcusdcPaperTradingState(statePath) ??
      createInitialBtcusdcPaperTradingState({
        candles,
        activationOpenTime,
        initialEquity,
        riskPct,
        symbol,
        displaySymbol,
      });
    const entryModes = (
      flagValue(args, "--entry-modes") ??
      env.BTCUSDC_PAPER_ENTRY_MODES ??
      "limit-signal-close,limit-half-pullback"
    )
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is ReplayEntryMode => REPLAY_ENTRY_MODES.has(value as ReplayEntryMode));
    const result = advanceBtcusdcPaperTradingState(candles, state, {
      candidates,
      microCandidates,
      strategylessCandidates,
      symbol,
      displaySymbol,
      riskPct,
      initialEquity,
      config: {
        minTrades: Number(flagValue(args, "--min-trades") ?? env.BTCUSDC_PAPER_MIN_TRADES ?? "20"),
        feeRate: Number(flagValue(args, "--fee-rate") ?? env.BTCUSDC_PAPER_FEE_RATE ?? "0"),
        tickSize: Number(flagValue(args, "--tick-size") ?? env.BTCUSDC_PAPER_TICK_SIZE ?? "0.1"),
        adverseTicks: Number(flagValue(args, "--adverse-ticks") ?? env.BTCUSDC_PAPER_ADVERSE_TICKS ?? "0"),
        kellyFraction: Number(flagValue(args, "--kelly-fraction") ?? env.BTCUSDC_PAPER_KELLY_FRACTION ?? "0.25"),
        riskCapPct: Number(flagValue(args, "--risk-cap-pct") ?? env.BTCUSDC_PAPER_RISK_CAP_PCT ?? "0.005"),
        minRiskPct: Number(flagValue(args, "--min-risk-pct") ?? env.BTCUSDC_PAPER_MIN_RISK_PCT ?? "0.00035"),
        entryModes,
        entryWaitBars: Number(flagValue(args, "--entry-wait-bars") ?? env.BTCUSDC_PAPER_ENTRY_WAIT_BARS ?? "3"),
        entryFillBufferTicks: Number(
          flagValue(args, "--entry-fill-buffer-ticks") ?? env.BTCUSDC_PAPER_ENTRY_FILL_BUFFER_TICKS ?? "2",
        ),
        minFillRate: Number(flagValue(args, "--min-fill-rate") ?? env.BTCUSDC_PAPER_MIN_FILL_RATE ?? "0.15"),
      },
    });

    saveBtcusdcPaperTradingState(statePath, result.state);
    appendBtcusdcPaperTradingEvents(logPath, result.events);

    const chatId = flagValue(args, "--chat-id") ?? env.TRADING_TELEGRAM_CHAT_ID;
    const telegramEvents = filterBtcusdcCoreTelegramEvents(result.events, coreTelegramCandidateLabels);
    let telegramMessageId: number | null = null;
    let telegramSkippedReason: string | null = null;
    if (chatId && (telegramEvents.length > 0 || hasFlag(args, "--notify-empty"))) {
      const telegramResult = await sendBtcusdcTelegramReport({
        args,
        env,
        chatId,
        payload: buildBtcusdcPaperTelegramMessage(telegramEvents, result.summary),
        nowIso: new Date().toISOString(),
      });
      telegramMessageId = telegramResult.telegramMessageId;
      telegramSkippedReason = telegramResult.telegramSkippedReason;
    }

    return {
      mode: "paper_forward_once",
      symbol,
      displaySymbol,
      statePath,
      logPath,
      candles: candles.length,
      events: result.events.length,
      telegramEvents: telegramEvents.length,
      newClosedTrades: result.summary.newClosedTrades,
      closedTrades: result.summary.closedTrades,
      openOrders: result.summary.openOrders,
      totalPnlR: result.summary.totalPnlR,
      equity: result.summary.equity,
      maxDrawdownPct: result.summary.maxDrawdownPct,
      telegramSent: telegramMessageId !== null,
      telegramMessageId,
      telegramSkippedReason,
    };
  };

  const runBtcusdcPaperDailyReport = async () => {
    const statePath = flagValue(args, "--state-path") ?? btcusdcPaperStatePath(env);
    const logPath = flagValue(args, "--log-path") ?? btcusdcPaperLogPath(env);
    const state = loadBtcusdcPaperTradingState(statePath);
    const events = loadBtcusdcPaperTradingEventLog(logPath);
    const registry = loadBtcusdcStrategyRegistryOrDefault(
      flagValue(args, "--registry-path") ?? env.BTCUSDC_STRATEGY_REGISTRY_PATH,
    );
    const registrySets = buildBtcusdcActivePaperCandidateSets(registry);
    const generatedAtIso = flagValue(args, "--generated-at") ?? new Date().toISOString();
    const message = buildBtcusdcDailyPerformanceTelegramMessage(events, {
      state,
      seedEquity: Number(flagValue(args, "--seed-equity") ?? env.BTCUSDC_PAPER_INITIAL_EQUITY ?? "1000"),
      strategyStatuses: registrySets.strategyStatuses,
      generatedAtIso,
      workflowStatus: {
        realtimeWorker: "Fly worker 기준",
        dailyReport: "일일보고 CLI 실행",
        weeklyResearch: "주간연구 Fly/GitHub Actions 기준",
        telegramQuota: `Telegram 하루 최대 ${Number(flagValue(args, "--telegram-quota-max-per-day") ?? env.BTCUSDC_TELEGRAM_REPORT_MAX_PER_DAY ?? "2")}회`,
      },
    });

    const chatId = flagValue(args, "--chat-id") ?? env.TRADING_TELEGRAM_CHAT_ID;
    let telegramMessageId: number | null = null;
    let telegramSkippedReason: string | null = null;
    if (chatId && !hasFlag(args, "--no-send")) {
      const telegramResult = await sendBtcusdcTelegramReport({
        args,
        env,
        chatId,
        payload: { text: message },
        nowIso: generatedAtIso,
      });
      telegramMessageId = telegramResult.telegramMessageId;
      telegramSkippedReason = telegramResult.telegramSkippedReason;
    }

    return {
      mode: "paper_daily_report",
      symbol: "BTCUSDC",
      displaySymbol: "BTCUSDC.P",
      statePath,
      logPath,
      events: events.length,
      telegramSent: telegramMessageId !== null,
      telegramMessageId,
      telegramSkippedReason,
      text: message,
    };
  };

  if (command === "config:check") {
    return {
      ok: true,
      data: {
        eliteHandles: config.eliteHandles,
        allowPaidProviders: config.allowPaidProviders,
        mode: config.allowPaidProviders ? "paid_enabled" : "local_or_free_tier",
      },
    };
  }

  if (command === "ingest:historical" || command === "ingest:daily") {
    const source = flagValue(args, "--source") ?? "fixtures";
    if (source !== "fixtures" && source !== "manual" && source !== "xapi") {
      throw new Error(`Only fixtures, manual, and xapi sources are enabled without provider credentials: ${source}`);
    }

    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      if (source === "xapi") {
        const filePath = flagValue(args, "--file") ?? flagValue(args, "--context-units");
        const contextTreesPath = flagValue(args, "--context-trees");
        const enrichedPostsPath = flagValue(args, "--raw-posts-enriched") ?? flagValue(args, "--enriched-posts");
        if (!filePath) {
          throw new Error("X API import requires --file or --context-units");
        }
        const persisted = await withFileStoreBatch(
          store,
          () => ingestXApiContextUnitsIntoStore(store, filePath, { contextTreesPath, enrichedPostsPath }),
        );
        return {
          ok: true,
          data: {
            store: store.kind,
            ...persisted,
          },
        };
      }

      if (source === "manual") {
        const filePath = flagValue(args, "--file");
        if (!filePath) {
          throw new Error("Manual import requires --file");
        }
        const persisted = await ingestPostsIntoStore(
          store,
          parseManualImportFile(filePath),
          "manual",
        );
        return {
          ok: true,
          data: {
            source,
            store: store.kind,
            ...persisted,
          },
        };
      }

      const persisted = await ingestFixtureIntoStore(store);
      return {
        ok: true,
        data: {
          store: store.kind,
          ...persisted,
        },
      };
    }

    if (source === "xapi") {
      const filePath = flagValue(args, "--file") ?? flagValue(args, "--context-units");
      if (!filePath) {
        throw new Error("X API import requires --file or --context-units");
      }
      const units = parseXApiContextUnitFile(filePath);
      const posts = units.flatMap((unit) => unit.posts ?? []);
      return {
        ok: true,
        data: {
          source,
          dryRun: hasFlag(args, "--dry-run"),
          postsFetched: posts.length,
          rtOnlyArchived: posts.filter((post) => post.retweeted_tweet && !post.text?.trim()).length,
          pendingCandidates: 0,
          canonicalCandidates: units.length,
          paidCalls: 0,
        },
      };
    }

    const fixture = loadFixture();
    const rtOnlyArchived = fixture.posts.filter((post) => post.is_rt_only).length;
    const pendingCandidates = fixture.posts.filter(
      (post) => !post.is_rt_only && post.trust_layer !== "canonical",
    ).length;
    const canonicalCandidates = fixture.posts.filter(
      (post) => !post.is_rt_only && post.trust_layer === "canonical",
    ).length;

    return {
      ok: true,
      data: {
        source,
        dryRun: hasFlag(args, "--dry-run"),
        postsFetched: fixture.posts.length,
        rtOnlyArchived,
        pendingCandidates,
        canonicalCandidates,
        paidCalls: 0,
      },
    };
  }

  if (command === "jit:enqueue") {
    const limit = Number(flagValue(args, "--limit") ?? "100");
    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      const queued = await store.enqueueJitUnits(limit);
      return {
        ok: true,
        data: {
          store: store.kind,
          queued: queued.map((item) => item.unitId),
          paidCalls: 0,
        },
      };
    }

    const fixture = loadFixture();
    const batch = enqueueJitBatch(
      fixture.posts
        .filter((post) => !post.is_rt_only)
        .map((post) => ({
          unitId: post.post_id,
          completedAt: post.created_at,
          canonicalStatus: canonicalStatusFor(post),
          rtOnlyExcluded: post.is_rt_only,
        })),
      limit,
    );

    return {
      ok: true,
      data: {
        queued: batch.map((item) => item.unitId),
        paidCalls: 0,
      },
    };
  }

  if (command === "triage:next") {
    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      const post = await store.nextTriageUnit();

      return {
        ok: true,
        data: post
          ? {
              store: store.kind,
              unitId: post.unitId,
              expertHandle: post.expertHandle,
              originalText: post.originalText,
              structuralBasis: post.structuralBasis,
              canonicalStatus: post.canonicalStatus,
              aiSummary: null,
              aiRecommendation: null,
              buttons: TRIAGE_ACTION_BUTTONS,
            }
          : null,
      };
    }

    const fixture = loadFixture();
    const post = fixture.posts.find((candidate) =>
      canEnterTriage({
        canonicalStatus: canonicalStatusFor(candidate),
        rtOnlyExcluded: candidate.is_rt_only,
      }),
    );

    if (!post) {
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        unitId: post.post_id,
        expertHandle: post.expert_handle,
        originalText: post.text,
        structuralBasis: post.structural_basis,
        canonicalStatus: "verified",
        aiSummary: null,
        aiRecommendation: null,
        buttons: TRIAGE_ACTION_BUTTONS,
      },
    };
  }

  if (command === "cost:status") {
    const spentKrw = Number(flagValue(args, "--spent-krw") ?? "0");
    return {
      ok: true,
      data: buildCostDecision({
        spentKrw,
        softAlertKrw: config.costSoftAlertKrw,
        hardStopKrw: config.costHardStopKrw,
      }),
    };
  }

  if (command === "ops:status") {
    return {
      ok: true,
      data: await buildOpsStatus(getStore(env)),
    };
  }

  if (command === "trading:research-btcusdc-core-gate") {
    const filePath = flagValue(args, "--file");
    const symbol = flagValue(args, "--symbol") ?? env.BTCUSDT_RESEARCH_SYMBOL ?? "BTCUSDC";
    const displaySymbol = flagValue(args, "--display-symbol") ?? env.BTCUSDT_RESEARCH_DISPLAY_SYMBOL ?? "BTCUSDC.P";
    const days = Number(flagValue(args, "--days") ?? env.BTCUSDT_RESEARCH_DAYS ?? "180");
    const maxCandlesFlag = flagValue(args, "--max-candles") ?? flagValue(args, "--limit");
    const minTrades = Number(flagValue(args, "--min-trades") ?? env.BTCUSDT_RESEARCH_MIN_TRADES ?? "20");
    const registry = loadBtcusdcStrategyRegistryOrDefault(
      flagValue(args, "--registry-path") ?? env.BTCUSDC_STRATEGY_REGISTRY_PATH,
    );
    const registrySets = buildBtcusdcActivePaperCandidateSets(registry);
    const portfolioCandidateFlag = flagValue(args, "--portfolio-candidates");
    const candidates = portfolioCandidateFlag
      ? parsePortfolioCandidates(portfolioCandidateFlag)
      : [...registrySets.coreCandidates, ...registrySets.shadowCandidates];
    if (candidates.length === 0) {
      throw new Error("trading:research-btcusdc-core-gate requires at least one edge portfolio candidate");
    }
    const candles = filePath
      ? loadCandlesFromBinanceKlineFile(filePath)
      : await fetchBinanceBtcusdtOneMinuteCandles({
          symbol,
          days,
          maxCandles: maxCandlesFlag ? Number(maxCandlesFlag) : days * 24 * 60,
        });
    const config = {
      minTrades,
      feeRate: Number(flagValue(args, "--fee-rate") ?? env.BTCUSDT_FEE_RATE ?? "0"),
      tickSize: Number(flagValue(args, "--tick-size") ?? env.BTCUSDT_TICK_SIZE ?? "0.1"),
      adverseTicks: Number(flagValue(args, "--adverse-ticks") ?? env.BTCUSDT_ADVERSE_TICKS ?? "0"),
      kellyFraction: Number(flagValue(args, "--kelly-fraction") ?? env.BTCUSDT_KELLY_FRACTION ?? "0.25"),
      riskCapPct: Number(flagValue(args, "--risk-cap-pct") ?? env.BTCUSDT_RISK_CAP_PCT ?? "0.005"),
      minRiskPct: Number(flagValue(args, "--min-risk-pct") ?? env.BTCUSDT_MIN_RISK_PCT ?? "0.00035"),
      entryModes: (flagValue(args, "--entry-modes") ?? env.BTCUSDT_ENTRY_MODES ?? "limit-signal-close,limit-half-pullback")
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is ReplayEntryMode => REPLAY_ENTRY_MODES.has(value as ReplayEntryMode)),
      entryWaitBars: Number(flagValue(args, "--entry-wait-bars") ?? env.BTCUSDT_ENTRY_WAIT_BARS ?? "3"),
      entryFillBufferTicks: Number(
        flagValue(args, "--entry-fill-buffer-ticks") ?? env.BTCUSDT_ENTRY_FILL_BUFFER_TICKS ?? "2",
      ),
      minFillRate: Number(flagValue(args, "--min-fill-rate") ?? env.BTCUSDT_MIN_FILL_RATE ?? "0.15"),
    };
    const report = buildBtcusdcSixMonthCoreResearchReport(candles, {
      symbol,
      displaySymbol,
      candidates,
      config,
      initialEquity: Number(flagValue(args, "--initial-equity") ?? env.BTCUSDC_PAPER_INITIAL_EQUITY ?? "1000"),
      riskPct: Number(flagValue(args, "--risk-pct") ?? env.BTCUSDT_RISK_CAP_PCT ?? "0.005"),
      foldDays: Number(flagValue(args, "--fold-days") ?? "14"),
    });
    const registryOut = flagValue(args, "--registry-out");
    const byLabel = new Map(report.candidates.map((row) => [row.label, row]));
    if (registryOut) {
      const updatedRegistry = registry.map((entry) => {
        const label = entry.candidate.label ?? entry.name;
        const row = entry.candidateType === "edge" ? byLabel.get(label) : null;
        if (!row) return entry;
        return {
          ...entry,
          status: row.gate.passed ? ("core" as const) : ("shadow" as const),
          coreTest: row.coreTest,
          notes: row.gate.passed
            ? "Promoted by the latest six-month core gate."
            : `Demoted by the latest six-month core gate: ${row.gate.reasons.join(", ")}`,
        };
      });
      mkdirSync(dirname(registryOut), { recursive: true });
      writeFileSync(registryOut, JSON.stringify(updatedRegistry, null, 2));
    }

    const summaryLines = [
      `${displaySymbol} 6개월 Core Gate 연구보고`,
      `캔들 ${report.candles}개 | 기간 ${report.lookbackDays.toFixed(1)}일 | 통과 ${report.candidates.filter((row) => row.gate.passed).length}/${report.candidates.length}`,
      `포트폴리오 거래 ${report.portfolio.filledTrades} | 기대값 ${report.portfolio.expectancyR.toFixed(3)}R | PF ${Number.isFinite(report.portfolio.profitFactor) ? report.portfolio.profitFactor.toFixed(2) : "inf"} | 최대DD ${report.portfolio.maxDrawdownR.toFixed(2)}R`,
      ...report.candidates.slice(0, 12).map((row) =>
        `${row.gate.passed ? "core" : "shadow"} ${row.label}: 거래 ${row.coreTest.filledTrades}/${row.coreTest.submittedOrders} | 기대값 ${row.coreTest.expectancyR.toFixed(3)}R | PF ${Number.isFinite(row.coreTest.profitFactor) ? row.coreTest.profitFactor.toFixed(2) : "inf"} | 양수 fold ${(row.coreTest.positiveFoldRate * 100).toFixed(0)}%${row.gate.passed ? "" : ` | 탈락: ${row.gate.reasons.slice(0, 3).join("; ")}`}`,
      ),
    ];
    const chatId = flagValue(args, "--chat-id") ?? env.TRADING_TELEGRAM_CHAT_ID;
    let telegramMessageId: number | null = null;
    let telegramSkippedReason: string | null = null;
    if (chatId && !hasFlag(args, "--no-send")) {
      const telegramResult = await sendBtcusdcTelegramReport({
        args,
        env,
        chatId,
        payload: { text: summaryLines.join("\n") },
        nowIso: new Date().toISOString(),
      });
      telegramMessageId = telegramResult.telegramMessageId;
      telegramSkippedReason = telegramResult.telegramSkippedReason;
    }

    return {
      ok: true,
      data: {
        mode: "six_month_core_gate",
        registryOut: registryOut ?? null,
        telegramSent: telegramMessageId !== null,
        telegramMessageId,
        telegramSkippedReason,
        report,
      },
    };
  }

  if (command === "trading:research-btcusdt" || command === "trading:research-btcusdc") {
    const filePath = flagValue(args, "--file");
    const defaultSymbol = command === "trading:research-btcusdc" ? "BTCUSDC" : "BTCUSDT";
    const symbol = flagValue(args, "--symbol") ?? env.BTCUSDT_RESEARCH_SYMBOL ?? defaultSymbol;
    const displaySymbol =
      flagValue(args, "--display-symbol") ??
      env.BTCUSDT_RESEARCH_DISPLAY_SYMBOL ??
      (symbol === "BTCUSDC" ? "BTCUSDC.P" : symbol);
    const makerLimit = hasFlag(args, "--maker-limit") || flagValue(args, "--execution") === "maker-limit";
    const days = Number(flagValue(args, "--days") ?? env.BTCUSDT_RESEARCH_DAYS ?? "7");
    const maxCandlesFlag = flagValue(args, "--max-candles") ?? flagValue(args, "--limit");
    const minTrades = Number(flagValue(args, "--min-trades") ?? env.BTCUSDT_RESEARCH_MIN_TRADES ?? "20");
    const feeRate = Number(
      flagValue(args, "--fee-rate") ??
        flagValue(args, "--maker-fee-rate") ??
        env.BTCUSDT_FEE_RATE ??
        (makerLimit ? "0" : "0.0004"),
    );
    const tickSize = Number(flagValue(args, "--tick-size") ?? env.BTCUSDT_TICK_SIZE ?? "0.1");
    const adverseTicks = Number(flagValue(args, "--adverse-ticks") ?? env.BTCUSDT_ADVERSE_TICKS ?? (makerLimit ? "0" : "1"));
    const kellyFraction = Number(flagValue(args, "--kelly-fraction") ?? env.BTCUSDT_KELLY_FRACTION ?? "0.25");
    const riskCapPct = Number(flagValue(args, "--risk-cap-pct") ?? env.BTCUSDT_RISK_CAP_PCT ?? "0.005");
    const minRiskPct = Number(flagValue(args, "--min-risk-pct") ?? env.BTCUSDT_MIN_RISK_PCT ?? "0.0005");
    const entryModes = (
      flagValue(args, "--entry-modes") ??
      env.BTCUSDT_ENTRY_MODES ??
      (makerLimit ? "limit-signal-close,limit-quarter-pullback,limit-half-pullback" : "next-open")
    )
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is ReplayEntryMode => REPLAY_ENTRY_MODES.has(value as ReplayEntryMode));
    const entryWaitBars = Number(flagValue(args, "--entry-wait-bars") ?? env.BTCUSDT_ENTRY_WAIT_BARS ?? (makerLimit ? "3" : "0"));
    const entryFillBufferTicks = Number(
      flagValue(args, "--entry-fill-buffer-ticks") ?? env.BTCUSDT_ENTRY_FILL_BUFFER_TICKS ?? "0",
    );
    const minFillRate = Number(flagValue(args, "--min-fill-rate") ?? env.BTCUSDT_MIN_FILL_RATE ?? (makerLimit ? "0.15" : "0"));
    const market = flagValue(args, "--market") ?? (symbol === "BTCUSDC" ? "USD-M perpetual futures" : "USDT-M perpetual futures");
    const candles = filePath
      ? loadCandlesFromBinanceKlineFile(filePath)
      : await fetchBinanceBtcusdtOneMinuteCandles({
          symbol,
          days,
          maxCandles: maxCandlesFlag ? Number(maxCandlesFlag) : undefined,
        });
    const config = {
      minTrades,
      feeRate,
      tickSize,
      adverseTicks,
      kellyFraction,
      riskCapPct,
      minRiskPct,
      entryModes,
      entryWaitBars,
      entryFillBufferTicks,
      minFillRate,
    };

    if (hasFlag(args, "--strategyless-ohlcv") || hasFlag(args, "--strategyless-scan")) {
      const report = buildBtcusdtStrategylessOhlcvReport(candles, {
        config,
        targetRs:
          flagValue(args, "--target-rs") === undefined
            ? undefined
            : parseNumberList(flagValue(args, "--target-rs") ?? ""),
        holdMinutes:
          flagValue(args, "--hold-minutes") === undefined
            ? undefined
            : parseNumberList(flagValue(args, "--hold-minutes") ?? ""),
        maxConditions:
          flagValue(args, "--max-conditions") === undefined
            ? undefined
            : Number(flagValue(args, "--max-conditions")),
        maxConditionSetsPerSignal:
          flagValue(args, "--max-condition-sets") === undefined
            ? undefined
            : Number(flagValue(args, "--max-condition-sets")),
        maxRawBuckets:
          flagValue(args, "--max-raw-buckets") === undefined
            ? undefined
            : Number(flagValue(args, "--max-raw-buckets")),
        maxCandidates:
          flagValue(args, "--max-candidates") === undefined
            ? undefined
            : Number(flagValue(args, "--max-candidates")),
        minTrades,
        minFillRate,
        minExpectancyR:
          flagValue(args, "--min-expectancy-r") === undefined
            ? undefined
            : Number(flagValue(args, "--min-expectancy-r")),
        minProfitFactor:
          flagValue(args, "--min-profit-factor") === undefined
            ? undefined
            : Number(flagValue(args, "--min-profit-factor")),
      });
      return {
        ok: true,
        data: {
          symbol,
          displaySymbol,
          exchange: "Binance",
          market,
          ...report,
        },
      };
    }

    if (hasFlag(args, "--stress-zone")) {
      const strategyId = flagValue(args, "--strategy-id");
      const zoneId = flagValue(args, "--zone-id");
      const entryModeFlag = flagValue(args, "--entry-mode");
      const entryMode = REPLAY_ENTRY_MODES.has(entryModeFlag as ReplayEntryMode)
        ? (entryModeFlag as ReplayEntryMode)
        : entryModes[0] ?? "next-open";
      if (!strategyId || !zoneId) {
        throw new Error("--stress-zone requires --strategy-id and --zone-id");
      }
      return {
        ok: true,
        data: buildBtcusdtEdgeZoneStressReport(candles, {
          strategyId,
          zoneId,
          entryMode,
          targetR: Number(flagValue(args, "--target-r") ?? "3"),
          maxHoldFiveMinuteBars: Number(flagValue(args, "--max-hold-5m-bars") ?? "6"),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    if (hasFlag(args, "--fragility-zone")) {
      const strategyId = flagValue(args, "--strategy-id");
      const zoneId = flagValue(args, "--zone-id");
      const entryModeFlag = flagValue(args, "--entry-mode");
      const entryMode = REPLAY_ENTRY_MODES.has(entryModeFlag as ReplayEntryMode)
        ? (entryModeFlag as ReplayEntryMode)
        : entryModes[0] ?? "next-open";
      if (!strategyId || !zoneId) {
        throw new Error("--fragility-zone requires --strategy-id and --zone-id");
      }
      return {
        ok: true,
        data: buildBtcusdtEdgeZoneFragilityReport(candles, {
          strategyId,
          zoneId,
          entryMode,
          targetR: Number(flagValue(args, "--target-r") ?? "3"),
          maxHoldFiveMinuteBars: Number(flagValue(args, "--max-hold-5m-bars") ?? "6"),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    const portfolioCandidateFlag = flagValue(args, "--portfolio-candidates");
    if (hasFlag(args, "--portfolio-robustness")) {
      if (!portfolioCandidateFlag) {
        throw new Error("--portfolio-robustness requires --portfolio-candidates");
      }
      return {
        ok: true,
        data: buildBtcusdtEdgeZonePortfolioRobustnessReport(candles, {
          candidates: parsePortfolioCandidates(portfolioCandidateFlag),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          riskPctValues:
            flagValue(args, "--risk-pct-values") === undefined
              ? undefined
              : parseNumberList(flagValue(args, "--risk-pct-values") ?? ""),
          topProfitDayCounts:
            flagValue(args, "--top-profit-day-counts") === undefined
              ? undefined
              : parseNumberList(flagValue(args, "--top-profit-day-counts") ?? ""),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    if (hasFlag(args, "--portfolio-rolling")) {
      if (!portfolioCandidateFlag) {
        throw new Error("--portfolio-rolling requires --portfolio-candidates");
      }
      return {
        ok: true,
        data: buildBtcusdtEdgeZonePortfolioRollingReport(candles, {
          candidates: parsePortfolioCandidates(portfolioCandidateFlag),
          windowDays: Number(flagValue(args, "--rolling-window-days") ?? "30"),
          stepDays:
            flagValue(args, "--rolling-step-days") === undefined
              ? undefined
              : Number(flagValue(args, "--rolling-step-days")),
          minEntryGroups:
            flagValue(args, "--min-entry-groups") === undefined ? undefined : Number(flagValue(args, "--min-entry-groups")),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    if (hasFlag(args, "--portfolio-execution-sweep")) {
      if (!portfolioCandidateFlag) {
        throw new Error("--portfolio-execution-sweep requires --portfolio-candidates");
      }
      return {
        ok: true,
        data: buildBtcusdtEdgeZonePortfolioExecutionSweepReport(candles, {
          candidates: parsePortfolioCandidates(portfolioCandidateFlag),
          entryWaitBarsValues: parseNumberList(flagValue(args, "--entry-wait-bars-values") ?? "1,2,3"),
          entryFillBufferTicksValues: parseNumberList(flagValue(args, "--entry-fill-buffer-ticks-values") ?? "2,3,5,8"),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    if (portfolioCandidateFlag) {
      return {
        ok: true,
        data: buildBtcusdtEdgeZonePortfolioReport(candles, {
          candidates: parsePortfolioCandidates(portfolioCandidateFlag),
          riskPct: flagValue(args, "--risk-pct") === undefined ? undefined : Number(flagValue(args, "--risk-pct")),
          initialEquity:
            flagValue(args, "--initial-equity") === undefined
              ? undefined
              : Number(flagValue(args, "--initial-equity")),
          config,
        }),
      };
    }

    if (hasFlag(args, "--walk-forward")) {
      return {
        ok: true,
        data: buildBtcusdtWalkForwardReport(candles, {
          foldFiveMinuteBars: Number(flagValue(args, "--fold-5m-bars") ?? env.BTCUSDT_WALK_FORWARD_FOLD_5M_BARS ?? "1440"),
          minTrades,
          minPositiveFoldRate: Number(flagValue(args, "--min-positive-fold-rate") ?? env.BTCUSDT_MIN_POSITIVE_FOLD_RATE ?? "0.6"),
          minEligibleFolds: Number(flagValue(args, "--min-eligible-folds") ?? env.BTCUSDT_MIN_ELIGIBLE_FOLDS ?? "3"),
          minTradesPerFold: Number(flagValue(args, "--min-trades-per-fold") ?? env.BTCUSDT_MIN_TRADES_PER_FOLD ?? Math.min(10, minTrades)),
          minWorstFoldExpectancyR: Number(
            flagValue(args, "--min-worst-fold-expectancy-r") ?? env.BTCUSDT_MIN_WORST_FOLD_EXPECTANCY_R ?? "-0.25",
          ),
          config,
        }),
      };
    }

    if (hasFlag(args, "--sweep")) {
      const minRiskPctValues = (flagValue(args, "--min-risk-pct-values") ?? "0,0.00075,0.001,0.0015,0.002,0.003,0.005")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite);
      const feeRateValues = (flagValue(args, "--fee-rate-values") ?? "0,0.0004,0.0006,0.001")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite);
      return {
        ok: true,
        data: buildBtcusdtResearchSweep(candles, {
          minRiskPctValues,
          feeRateValues,
          baseConfig: config,
        }),
      };
    }

    return {
      ok: true,
      data: buildBtcusdtResearchReport(candles, config, {
        symbol,
        displaySymbol,
        market,
      }),
    };
  }

  if (command === "trading:paper-btcusdc-once") {
    return {
      ok: true,
      data: await runBtcusdcPaperOnce(),
    };
  }

  if (command === "trading:paper-btcusdc-daily-report") {
    return {
      ok: true,
      data: await runBtcusdcPaperDailyReport(),
    };
  }

  if (command === "trading:paper-btcusdc-loop") {
    const intervalMs = Number(flagValue(args, "--interval-ms") ?? env.BTCUSDC_PAPER_INTERVAL_MS ?? "60000");
    const maxIterationsFlag = flagValue(args, "--max-iterations");
    const maxIterations = maxIterationsFlag ? Number(maxIterationsFlag) : Number.POSITIVE_INFINITY;
    const aggregate = {
      mode: "paper_forward_loop",
      iterations: 0,
      events: 0,
      newClosedTrades: 0,
      closedTrades: 0,
      openOrders: 0,
      equity: 0,
      telegramMessages: 0,
    };

    while (aggregate.iterations < maxIterations) {
      const step = await runBtcusdcPaperOnce();
      aggregate.iterations += 1;
      aggregate.events += step.events;
      aggregate.newClosedTrades += step.newClosedTrades;
      aggregate.closedTrades = step.closedTrades;
      aggregate.openOrders = step.openOrders;
      aggregate.equity = step.equity;
      if (step.telegramSent) aggregate.telegramMessages += 1;

      if (aggregate.iterations < maxIterations) {
        await delay(intervalMs);
      }
    }

    return {
      ok: true,
      data: aggregate,
    };
  }

  if (command === "telegram:get-me") {
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    return {
      ok: true,
      data: await client.getMe(),
    };
  }

  if (command === "telegram:updates") {
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    return {
      ok: true,
      data: await client.getUpdates(),
    };
  }

  if (command === "telegram:poll-once") {
    const store = getStore(env);
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const internalizationClient = env.INTERNALIZATION_BOT_TOKEN
      ? new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN })
      : undefined;
    const offsetPath = env.TELEGRAM_OFFSET_PATH ?? resolve(".phase1/telegram-offset.json");

    return {
      ok: true,
      data: await pollTelegramOnce({
        store,
        client,
        offsetPath,
        internalizationChatId: env.INTERNALIZATION_CHAT_ID,
        internalizationClient,
      }),
    };
  }

  if (command === "telegram:poll-loop") {
    const store = getStore(env);
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const internalizationClient = env.INTERNALIZATION_BOT_TOKEN
      ? new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN })
      : undefined;
    const offsetPath = env.TELEGRAM_OFFSET_PATH ?? resolve(".phase1/telegram-offset.json");
    const intervalMs = Number(flagValue(args, "--interval-ms") ?? env.TELEGRAM_POLL_INTERVAL_MS ?? "3000");
    const maxIterationsFlag = flagValue(args, "--max-iterations");
    const maxIterations = maxIterationsFlag ? Number(maxIterationsFlag) : Number.POSITIVE_INFINITY;
    const aggregate = {
      mode: "local_polling",
      iterations: 0,
      updatesSeen: 0,
      callbacksHandled: 0,
      textCommandsHandled: 0,
      textAttemptsHandled: 0,
      paidCalls: 0,
    };

    while (aggregate.iterations < maxIterations) {
      const summary = await pollTelegramOnce({
        store,
        client,
        offsetPath,
        internalizationChatId: env.INTERNALIZATION_CHAT_ID,
        internalizationClient,
      });
      aggregate.iterations += 1;
      aggregate.updatesSeen += summary.updatesSeen;
      aggregate.callbacksHandled += summary.callbacksHandled;
      aggregate.textCommandsHandled += summary.textCommandsHandled;
      aggregate.textAttemptsHandled += summary.textAttemptsHandled;

      if (aggregate.iterations < maxIterations) {
        await delay(intervalMs);
      }
    }

    return {
      ok: true,
      data: aggregate,
    };
  }

  if (command === "telegram:send-triage") {
    const chatId = flagValue(args, "--chat-id") ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-triage requires --chat-id or TRIAGE_CHAT_ID");
    }

    const store = getStore(env);
    const post = await store.nextTriageUnit();
    if (!post) {
      return { ok: true, data: { sent: false, reason: "no_triage_unit" } };
    }
    if (post.triageSentAt && !hasFlag(args, "--force")) {
      return {
        ok: true,
        data: {
          sent: false,
          reason: "triage_already_sent",
          unitId: post.unitId,
          messageId: post.triageMessageId,
          paidCalls: 0,
        },
      };
    }

    const client = new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN?.trim() || requireTelegramToken(env) });
    const sent = await client.sendMessage(
      chatId,
      buildTelegramTriageMessage({
        unitId: post.unitId,
        expertHandle: post.expertHandle,
        originalText: post.originalText,
        canonicalStatus: post.canonicalStatus,
      }),
    );
    await store.markTriageSent(post.unitId, new Date().toISOString(), sent.message_id);

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        unitId: post.unitId,
      },
    };
  }

  if (command === "telegram:send-menu") {
    const chatId = flagValue(args, "--chat-id") ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-menu requires --chat-id or TRIAGE_CHAT_ID");
    }

    const statePath = telegramMenuStatePath(env);
    const previous = readTelegramMenuState(statePath);
    if (
      previous?.chatId === chatId &&
      previous.menuVersion === OPS_MENU_VERSION &&
      !hasFlag(args, "--force")
    ) {
      return {
        ok: true,
        data: {
          sent: false,
          reason: "menu_already_sent",
          messageId: previous.messageId,
          paidCalls: 0,
        },
      };
    }

    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const sent = await client.sendMessage(chatId, buildTelegramOpsMenuMessage());
    writeTelegramMenuState(statePath, {
      chatId,
      messageId: sent.message_id,
      menuVersion: OPS_MENU_VERSION,
      sentAt: new Date().toISOString(),
    });

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        paidCalls: 0,
      },
    };
  }

  if (command === "telegram:mark-triage-sent") {
    const unitId = flagValue(args, "--unit-id");
    const messageId = Number(flagValue(args, "--message-id"));
    if (!unitId || !Number.isFinite(messageId)) {
      throw new Error("telegram:mark-triage-sent requires --unit-id and --message-id");
    }

    const store = getStore(env);
    const unit = await store.getContextUnit(unitId);
    if (!unit) {
      return { ok: true, data: { marked: false, reason: "unit_not_found", unitId } };
    }

    await store.markTriageSent(unitId, new Date().toISOString(), messageId);
    return {
      ok: true,
      data: {
        marked: true,
        unitId,
        messageId,
        paidCalls: 0,
      },
    };
  }

  if (command === "telegram:send-internalization") {
    const chatId = flagValue(args, "--chat-id") ?? env.INTERNALIZATION_CHAT_ID ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-internalization requires --chat-id, INTERNALIZATION_CHAT_ID, or TRIAGE_CHAT_ID");
    }

    const store = getStore(env);
    const unitId = flagValue(args, "--unit-id");
    const unit = unitId ? await store.getContextUnit(unitId) : await store.findActiveInternalizationUnit();
    if (!unit) {
      return { ok: true, data: { sent: false, reason: "no_internalization_unit" } };
    }

    await store.setTriageDecision(unit.unitId, "\uCCB4\uD654");
    await store.setInternalizationState(unit.unitId, "in_progress");

    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const sent = await client.sendMessage(
      chatId,
      buildTelegramInternalizationMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
      }),
    );

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        unitId: unit.unitId,
        paidCalls: 0,
      },
    };
  }

  throw new Error(`Unknown command: ${command}`);
}
