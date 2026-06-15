import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TelegramBotClient, requireTelegramToken } from "../telegram/client.js";
import {
  buildBtcusdcDailyPerformanceTelegramMessage,
  loadBtcusdcPaperTradingEventLog,
  shouldRunBtcusdcWeeklyResearch,
  shouldSendBtcusdcDailyReport,
} from "./btcusdcDailyReport.js";
import { buildBtcusdcPaperTelegramMessage, loadBtcusdcPaperTradingState } from "./btcusdcPaperTrading.js";
import { buildBtcusdcActivePaperCandidateSets, loadBtcusdcStrategyRegistryOrDefault } from "./btcusdcStrategyRegistry.js";
import {
  recordBtcusdcTelegramReportSend,
  shouldSendBtcusdcTelegramReport,
} from "./btcusdcTelegramReportQuota.js";
import {
  buildBinanceFuturesKlineStreamUrl,
  loadRealtimeCandles,
  parseBinanceFuturesClosedKline,
  processBtcusdcRealtimeClosedCandle,
  saveRealtimeCandles,
} from "./btcusdcRealtimeWorker.js";
import { fetchBinanceBtcusdtOneMinuteCandles, type Candle } from "./btcusdtResearch.js";

interface WebSocketLike {
  addEventListener?: (type: string, listener: (event?: { data?: unknown; message?: unknown }) => void) => void;
  close: () => void;
  onopen?: () => void;
  onmessage?: (event: { data?: unknown }) => void;
  onerror?: (event?: unknown) => void;
  onclose?: (event?: unknown) => void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface DailyReportRuntimeState {
  lastSentDate?: string;
  lastSentAtIso?: string;
  lastTelegramMessageId?: number;
  lastSkippedReason?: string;
}

interface CoreResearchRuntimeState {
  lastStartedWeek?: string;
  lastStartedAtIso?: string;
  lastFinishedAtIso?: string;
  lastExitCode?: number | null;
  lastSignal?: NodeJS.Signals | null;
  lastStdoutTail?: string;
  lastStderrTail?: string;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function envOptionalNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestOpenTime(candles: Candle[]): number | null {
  return candles.length === 0 ? null : candles[candles.length - 1].openTime;
}

function loadDailyReportRuntimeState(path: string): DailyReportRuntimeState {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as DailyReportRuntimeState;
}

function saveDailyReportRuntimeState(path: string, state: DailyReportRuntimeState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function loadCoreResearchRuntimeState(path: string): CoreResearchRuntimeState {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as CoreResearchRuntimeState;
}

function saveCoreResearchRuntimeState(path: string, state: CoreResearchRuntimeState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function tailText(current: string, chunk: Buffer | string, maxLength = 8_000): string {
  const next = current + chunk.toString();
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

async function bootstrapCandles(input: {
  symbol: string;
  candlesPath: string;
  warmupCandles: number;
  maxCandles: number;
}): Promise<void> {
  const existing = loadRealtimeCandles(input.candlesPath);
  if (existing.length >= Math.min(input.warmupCandles, input.maxCandles)) {
    console.log(
      JSON.stringify({
        event: "warmup_existing",
        candles: existing.length,
        latestOpenTime: latestOpenTime(existing),
      }),
    );
    return;
  }

  const warmup = await fetchBinanceBtcusdtOneMinuteCandles({
    symbol: input.symbol,
    days: Math.ceil(input.warmupCandles / 1440),
    maxCandles: input.warmupCandles,
  });
  const bounded = warmup.slice(Math.max(0, warmup.length - input.maxCandles));
  saveRealtimeCandles(input.candlesPath, bounded);
  console.log(
    JSON.stringify({
      event: "warmup_fetched",
      candles: bounded.length,
      latestOpenTime: latestOpenTime(bounded),
    }),
  );
}

function wireWebSocket(
  ws: WebSocketLike,
  handlers: {
    open: () => void;
    message: (data: unknown) => void;
    error: (event?: unknown) => void;
    close: (event?: unknown) => void;
  },
): void {
  if (ws.addEventListener) {
    ws.addEventListener("open", handlers.open);
    ws.addEventListener("message", (event) => handlers.message(event?.data));
    ws.addEventListener("error", handlers.error);
    ws.addEventListener("close", handlers.close);
    return;
  }

  ws.onopen = handlers.open;
  ws.onmessage = (event) => handlers.message(event.data);
  ws.onerror = handlers.error;
  ws.onclose = handlers.close;
}

async function main(): Promise<void> {
  const symbol = process.env.BTCUSDC_REALTIME_SYMBOL ?? "BTCUSDC";
  const displaySymbol = process.env.BTCUSDC_REALTIME_DISPLAY_SYMBOL ?? "BTCUSDC.P";
  const interval = process.env.BTCUSDC_REALTIME_INTERVAL ?? "1m";
  const streamUrl = process.env.BTCUSDC_REALTIME_WS_URL ?? buildBinanceFuturesKlineStreamUrl(symbol, interval);
  const candlesPath = process.env.BTCUSDC_REALTIME_CANDLES_PATH ?? "/data/btcusdc-1m-candles.json";
  const statePath = process.env.BTCUSDC_REALTIME_STATE_PATH ?? "/data/btcusdc-paper-state.json";
  const logPath = process.env.BTCUSDC_REALTIME_LOG_PATH ?? "/data/btcusdc-paper-events.jsonl";
  const registryPath = process.env.BTCUSDC_STRATEGY_REGISTRY_PATH;
  const warmupCandles = envNumber("BTCUSDC_REALTIME_WARMUP_CANDLES", 6_000);
  const maxCandles = envNumber("BTCUSDC_REALTIME_MAX_CANDLES", 6_000);
  const reconnectBaseMs = envNumber("BTCUSDC_REALTIME_RECONNECT_BASE_MS", 1_000);
  const reconnectMaxMs = envNumber("BTCUSDC_REALTIME_RECONNECT_MAX_MS", 30_000);
  const riskPct = envOptionalNumber("BTCUSDC_PAPER_RISK_PCT");
  const initialEquity = envNumber("BTCUSDC_PAPER_INITIAL_EQUITY", 1_000);
  const dailyReportAtKst = process.env.BTCUSDC_DAILY_REPORT_AT_KST ?? "09:00";
  const dailyReportStatePath = process.env.BTCUSDC_DAILY_REPORT_STATE_PATH ?? "/data/btcusdc-daily-report-state.json";
  const telegramReportQuotaPath = process.env.BTCUSDC_TELEGRAM_REPORT_QUOTA_PATH ?? "/data/btcusdc-telegram-report-quota.json";
  const telegramReportMaxPerDay = envNumber("BTCUSDC_TELEGRAM_REPORT_MAX_PER_DAY", 2);
  const autoResearchEnabled = (process.env.BTCUSDC_AUTO_RESEARCH_ENABLED ?? "true").toLowerCase() !== "false";
  const coreResearchRunDayOfWeek = envNumber("BTCUSDC_CORE_RESEARCH_DAY_OF_WEEK", 1);
  const coreResearchAtKst = process.env.BTCUSDC_CORE_RESEARCH_AT_KST ?? "01:20";
  const coreResearchStatePath = process.env.BTCUSDC_CORE_RESEARCH_STATE_PATH ?? "/data/btcusdc-core-research-state.json";
  const coreResearchDays = envNumber("BTCUSDC_CORE_RESEARCH_DAYS", 180);
  const coreResearchMaxCandles = envNumber("BTCUSDC_CORE_RESEARCH_MAX_CANDLES", coreResearchDays * 24 * 60);
  const coreResearchCliPath = process.env.BTCUSDC_CORE_RESEARCH_CLI_PATH ?? "dist/src/cli.js";
  const chatId = process.env.TRADING_TELEGRAM_CHAT_ID;
  const telegramClient = chatId && process.env.TELEGRAM_BOT_TOKEN ? new TelegramBotClient({ token: requireTelegramToken(process.env) }) : null;
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!WebSocketCtor) throw new Error("A global WebSocket implementation is required. Use Node.js 22 or newer.");

  await bootstrapCandles({ symbol, candlesPath, warmupCandles, maxCandles });

  let stopped = false;
  let reconnectAttempt = 0;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let coreResearchInFlight = false;

  const sendTelegramReport = async (payload: { text: string }, nowIso: string) => {
    if (!telegramClient || !chatId) {
      return { telegramSent: false, telegramMessageId: null, telegramSkippedReason: "telegram_not_configured" };
    }
    const quota = shouldSendBtcusdcTelegramReport({
      quotaPath: telegramReportQuotaPath,
      nowIso,
      maxPerDay: telegramReportMaxPerDay,
    });
    if (!quota.allowed) {
      return { telegramSent: false, telegramMessageId: null, telegramSkippedReason: "daily_quota_exhausted" };
    }
    const sent = await telegramClient.sendMessage(chatId, payload);
    recordBtcusdcTelegramReportSend({ quotaPath: telegramReportQuotaPath, nowIso, messageId: sent.message_id });
    return { telegramSent: true, telegramMessageId: sent.message_id, telegramSkippedReason: null };
  };

  const maybeSendDailyReport = async () => {
    if (!telegramClient || !chatId) return;
    const nowIso = new Date().toISOString();
    const runtimeState = loadDailyReportRuntimeState(dailyReportStatePath);
    const decision = shouldSendBtcusdcDailyReport({
      nowIso,
      reportAtKst: dailyReportAtKst,
      lastSentDate: runtimeState.lastSentDate,
    });
    if (!decision.due) return;

    const registry = loadBtcusdcStrategyRegistryOrDefault(registryPath);
    const registrySets = buildBtcusdcActivePaperCandidateSets(registry);
    const message = buildBtcusdcDailyPerformanceTelegramMessage(loadBtcusdcPaperTradingEventLog(logPath), {
      state: loadBtcusdcPaperTradingState(statePath),
      seedEquity: initialEquity,
      strategyStatuses: registrySets.strategyStatuses,
      generatedAtIso: nowIso,
    });
    const sendResult = await sendTelegramReport({ text: message }, nowIso);
    saveDailyReportRuntimeState(dailyReportStatePath, {
      lastSentDate: decision.currentDate,
      lastSentAtIso: nowIso,
      lastTelegramMessageId: sendResult.telegramMessageId ?? undefined,
      lastSkippedReason: sendResult.telegramSkippedReason ?? undefined,
    });
    console.log(
      JSON.stringify({
        event: sendResult.telegramSent ? "daily_report_sent" : "daily_report_skipped",
        date: decision.currentDate,
        telegramMessageId: sendResult.telegramMessageId,
        reason: sendResult.telegramSkippedReason,
      }),
    );
  };

  const maybeRunCoreResearch = async () => {
    if (!autoResearchEnabled || coreResearchInFlight) return;
    const nowIso = new Date().toISOString();
    const runtimeState = loadCoreResearchRuntimeState(coreResearchStatePath);
    const decision = shouldRunBtcusdcWeeklyResearch({
      nowIso,
      runDayOfWeek: coreResearchRunDayOfWeek,
      runAtKst: coreResearchAtKst,
      lastStartedWeek: runtimeState.lastStartedWeek,
    });
    if (!decision.due) return;

    coreResearchInFlight = true;
    const startedState: CoreResearchRuntimeState = {
      ...runtimeState,
      lastStartedWeek: decision.currentWeek,
      lastStartedAtIso: nowIso,
      lastExitCode: null,
      lastSignal: null,
      lastStdoutTail: "",
      lastStderrTail: "",
    };
    saveCoreResearchRuntimeState(coreResearchStatePath, startedState);
    console.log(JSON.stringify({ event: "core_research_started", week: decision.currentWeek, days: coreResearchDays }));

    let stdoutTail = "";
    let stderrTail = "";
    const child = spawn(
      process.execPath,
      [
        coreResearchCliPath,
        "trading:research-btcusdc-core-gate",
        "--days",
        String(coreResearchDays),
        "--max-candles",
        String(coreResearchMaxCandles),
        "--registry-path",
        registryPath ?? "/data/btcusdc-strategy-registry.json",
        "--registry-out",
        registryPath ?? "/data/btcusdc-strategy-registry.json",
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=384",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (chunk) => {
      stdoutTail = tailText(stdoutTail, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrTail = tailText(stderrTail, chunk);
    });
    child.on("error", (error) => {
      stderrTail = tailText(stderrTail, error instanceof Error ? error.message : String(error));
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    const finishedAtIso = new Date().toISOString();
    saveCoreResearchRuntimeState(coreResearchStatePath, {
      ...startedState,
      lastFinishedAtIso: finishedAtIso,
      lastExitCode: result.code,
      lastSignal: result.signal,
      lastStdoutTail: stdoutTail,
      lastStderrTail: stderrTail,
    });
    coreResearchInFlight = false;
    console.log(
      JSON.stringify({
        event: "core_research_finished",
        week: decision.currentWeek,
        exitCode: result.code,
        signal: result.signal,
      }),
    );
    if (result.code !== 0 && telegramClient && chatId) {
      await sendTelegramReport({
        text: `BTCUSDC.P 주간 core 연구 실패\n주차 ${decision.currentWeek} | 종료코드 ${result.code ?? "null"} | signal ${result.signal ?? "none"}\n${stderrTail.slice(-1200)}`,
      }, finishedAtIso);
    }
  };

  while (!stopped) {
    await new Promise<void>((resolve) => {
      const ws = new WebSocketCtor(streamUrl);
      wireWebSocket(ws, {
        open: () => {
          reconnectAttempt = 0;
          console.log(JSON.stringify({ event: "websocket_open", streamUrl, symbol, interval }));
        },
        message: (data) => {
          void (async () => {
            try {
              const text = typeof data === "string" ? data : data instanceof Buffer ? data.toString("utf8") : String(data);
              const candle = parseBinanceFuturesClosedKline(JSON.parse(text));
              if (!candle) return;
              const result = processBtcusdcRealtimeClosedCandle(candle, {
                candlesPath,
                statePath,
                logPath,
                maxCandles,
                symbol,
                displaySymbol,
                initialEquity,
                riskPct,
                strategyRegistry: loadBtcusdcStrategyRegistryOrDefault(registryPath),
              });
              console.log(
                JSON.stringify({
                  event: "closed_kline_processed",
                  openTime: candle.openTime,
                  events: result.events,
                  closedTrades: result.closedTrades,
                  equity: result.equity,
                }),
              );
              if (telegramClient && chatId && result.telegramEventRows.length > 0) {
                const sendResult = await sendTelegramReport(buildBtcusdcPaperTelegramMessage(result.telegramEventRows, result), new Date().toISOString());
                if (!sendResult.telegramSent) {
                  console.log(JSON.stringify({ event: "trade_report_skipped", reason: sendResult.telegramSkippedReason }));
                }
              }
              await maybeSendDailyReport();
              void maybeRunCoreResearch().catch((error) => {
                coreResearchInFlight = false;
                console.error(
                  JSON.stringify({ event: "core_research_error", error: error instanceof Error ? error.message : String(error) }),
                );
              });
            } catch (error) {
              console.error(JSON.stringify({ event: "message_error", error: error instanceof Error ? error.message : String(error) }));
            }
          })();
        },
        error: (event) => {
          console.error(JSON.stringify({ event: "websocket_error", detail: String(event ?? "") }));
        },
        close: (event) => {
          console.log(JSON.stringify({ event: "websocket_close", detail: String(event ?? "") }));
          resolve();
        },
      });

      const closeOnStop = setInterval(() => {
        if (!stopped) return;
        clearInterval(closeOnStop);
        ws.close();
        resolve();
      }, 1_000);
    });

    if (stopped) break;
    reconnectAttempt += 1;
    const backoffMs = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** Math.min(reconnectAttempt, 8));
    console.log(JSON.stringify({ event: "websocket_reconnect_wait", backoffMs }));
    await delay(backoffMs);
  }

  console.log(JSON.stringify({ event: "worker_stopped" }));
}

await main();
