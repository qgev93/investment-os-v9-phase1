import { TelegramBotClient, requireTelegramToken } from "../telegram/client.js";
import { buildBtcusdcPaperTelegramMessage } from "./btcusdcPaperTrading.js";
import { loadBtcusdcStrategyRegistryOrDefault } from "./btcusdcStrategyRegistry.js";
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
  const strategyRegistry = loadBtcusdcStrategyRegistryOrDefault(registryPath);
  const warmupCandles = envNumber("BTCUSDC_REALTIME_WARMUP_CANDLES", 6_000);
  const maxCandles = envNumber("BTCUSDC_REALTIME_MAX_CANDLES", 6_000);
  const reconnectBaseMs = envNumber("BTCUSDC_REALTIME_RECONNECT_BASE_MS", 1_000);
  const reconnectMaxMs = envNumber("BTCUSDC_REALTIME_RECONNECT_MAX_MS", 30_000);
  const riskPct = envOptionalNumber("BTCUSDC_PAPER_RISK_PCT");
  const initialEquity = envNumber("BTCUSDC_PAPER_INITIAL_EQUITY", 1_000);
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
                strategyRegistry,
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
                await telegramClient.sendMessage(chatId, buildBtcusdcPaperTelegramMessage(result.telegramEventRows, result));
              }
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
