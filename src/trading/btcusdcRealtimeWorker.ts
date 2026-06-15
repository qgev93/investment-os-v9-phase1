import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BTCUSDC_PAPER_DEFAULT_CONFIG,
  advanceBtcusdcPaperTradingState,
  appendBtcusdcPaperTradingEvents,
  createInitialBtcusdcPaperTradingState,
  loadBtcusdcPaperTradingState,
  saveBtcusdcPaperTradingState,
  type BtcusdcPaperTradingEvent,
  type BtcusdcPaperTradingSummary,
} from "./btcusdcPaperTrading.js";
import {
  buildBtcusdcActivePaperCandidateSets,
  defaultBtcusdcStrategyRegistry,
  filterBtcusdcCoreTelegramEvents,
  type BtcusdcStrategyRegistryEntry,
} from "./btcusdcStrategyRegistry.js";
import type {
  Candle,
  EdgeZonePortfolioCandidate,
  MicroScalpPortfolioCandidate,
  ResearchConfig,
  StrategylessOhlcvPortfolioCandidate,
} from "./btcusdtResearch.js";

export interface ProcessBtcusdcRealtimeClosedCandleOptions {
  candlesPath: string;
  statePath: string;
  logPath: string;
  candidates?: EdgeZonePortfolioCandidate[];
  microCandidates?: MicroScalpPortfolioCandidate[];
  strategylessCandidates?: StrategylessOhlcvPortfolioCandidate[];
  config?: Partial<ResearchConfig>;
  maxCandles?: number;
  nowIso?: string;
  activationOpenTime?: number;
  initialEquity?: number;
  riskPct?: number;
  symbol?: string;
  displaySymbol?: string;
  coreTelegramCandidateLabels?: Set<string> | string[];
  strategyRegistry?: BtcusdcStrategyRegistryEntry[];
}

export interface ProcessBtcusdcRealtimeClosedCandleResult extends BtcusdcPaperTradingSummary {
  acceptedCandle: boolean;
  candles: number;
  eventRows: BtcusdcPaperTradingEvent[];
  telegramEventRows: BtcusdcPaperTradingEvent[];
}

interface BinanceKlinePayload {
  e?: unknown;
  k?: {
    t?: unknown;
    T?: unknown;
    i?: unknown;
    o?: unknown;
    h?: unknown;
    l?: unknown;
    c?: unknown;
    v?: unknown;
    x?: unknown;
  };
  data?: unknown;
}

function numberFromPayload(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Binance kline ${field}: ${String(value)}`);
  }
  return parsed;
}

function candlesEqual(left: Candle | undefined, right: Candle): boolean {
  return Boolean(
    left &&
      left.openTime === right.openTime &&
      left.open === right.open &&
      left.high === right.high &&
      left.low === right.low &&
      left.close === right.close &&
      left.volume === right.volume &&
      left.closeTime === right.closeTime,
  );
}

export function buildBinanceFuturesKlineStreamUrl(symbol = "BTCUSDC", interval = "1m"): string {
  return `wss://fstream.binance.com/market/ws/${symbol.toLowerCase()}@kline_${interval}`;
}

export function parseBinanceFuturesClosedKline(payload: unknown): Candle | null {
  const envelope = payload as BinanceKlinePayload;
  const raw = (envelope.data ?? envelope) as BinanceKlinePayload;
  if (raw.e !== "kline" || !raw.k || raw.k.i !== "1m" || raw.k.x !== true) return null;

  return {
    openTime: numberFromPayload(raw.k.t, "openTime"),
    closeTime: numberFromPayload(raw.k.T, "closeTime"),
    open: numberFromPayload(raw.k.o, "open"),
    high: numberFromPayload(raw.k.h, "high"),
    low: numberFromPayload(raw.k.l, "low"),
    close: numberFromPayload(raw.k.c, "close"),
    volume: numberFromPayload(raw.k.v, "volume"),
  };
}

export function mergeRealtimeClosedCandle(candles: Candle[], candle: Candle, maxCandles = 6_000): Candle[] {
  const byOpenTime = new Map<number, Candle>();
  for (const item of candles) byOpenTime.set(item.openTime, item);
  byOpenTime.set(candle.openTime, candle);
  const merged = [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);
  return merged.slice(Math.max(0, merged.length - maxCandles));
}

export function loadRealtimeCandles(path: string): Candle[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Realtime candle store must contain a JSON array");
  }
  return parsed.map((item) => {
    const row = item as Partial<Candle>;
    if (
      typeof row.openTime !== "number" ||
      typeof row.open !== "number" ||
      typeof row.high !== "number" ||
      typeof row.low !== "number" ||
      typeof row.close !== "number" ||
      typeof row.volume !== "number"
    ) {
      throw new Error("Realtime candle rows must include numeric openTime, open, high, low, close, and volume");
    }
    return {
      openTime: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      closeTime: row.closeTime,
    };
  });
}

export function saveRealtimeCandles(path: string, candles: Candle[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(candles, null, 2));
}

export function processBtcusdcRealtimeClosedCandle(
  candle: Candle,
  options: ProcessBtcusdcRealtimeClosedCandleOptions,
): ProcessBtcusdcRealtimeClosedCandleResult {
  const registrySets = buildBtcusdcActivePaperCandidateSets(options.strategyRegistry ?? defaultBtcusdcStrategyRegistry());
  const usesExplicitCandidates = Boolean(options.candidates || options.microCandidates || options.strategylessCandidates);
  const candidates = options.candidates ?? registrySets.runtimeCandidates;
  const microCandidates = options.microCandidates ?? registrySets.runtimeMicroCandidates;
  const strategylessCandidates = options.strategylessCandidates ?? registrySets.runtimeStrategylessCandidates;
  const explicitCoreLabels = options.coreTelegramCandidateLabels
    ? new Set(options.coreTelegramCandidateLabels)
    : null;
  const coreTelegramCandidateLabels =
    explicitCoreLabels ??
    (usesExplicitCandidates
      ? new Set([
          ...candidates.map((candidate) => candidate.label ?? candidate.strategyId),
          ...microCandidates.map((candidate) => candidate.label ?? candidate.strategyId),
          ...strategylessCandidates.map((candidate) => candidate.label ?? candidate.conditionId),
        ])
      : registrySets.coreTelegramCandidateLabels);
  const previousCandles = loadRealtimeCandles(options.candlesPath);
  const previousSameOpenTime = previousCandles.find((item) => item.openTime === candle.openTime);
  const candles = mergeRealtimeClosedCandle(previousCandles, candle, options.maxCandles ?? 6_000);
  saveRealtimeCandles(options.candlesPath, candles);

  const state =
    loadBtcusdcPaperTradingState(options.statePath) ??
    createInitialBtcusdcPaperTradingState({
      candles,
      activationOpenTime: options.activationOpenTime,
      initialEquity: options.initialEquity,
      riskPct: options.riskPct,
      nowIso: options.nowIso,
      symbol: options.symbol,
      displaySymbol: options.displaySymbol,
    });

  const result = advanceBtcusdcPaperTradingState(candles, state, {
    candidates,
    microCandidates,
    strategylessCandidates,
    initialEquity: options.initialEquity,
    riskPct: options.riskPct,
    nowIso: options.nowIso,
    symbol: options.symbol,
    displaySymbol: options.displaySymbol,
    config: { ...BTCUSDC_PAPER_DEFAULT_CONFIG, ...(options.config ?? {}) },
  });

  saveBtcusdcPaperTradingState(options.statePath, result.state);
  appendBtcusdcPaperTradingEvents(options.logPath, result.events);
  const telegramEventRows = filterBtcusdcCoreTelegramEvents(result.events, coreTelegramCandidateLabels);

  return {
    ...result.summary,
    acceptedCandle: !candlesEqual(previousSameOpenTime, candle),
    candles: candles.length,
    eventRows: result.events,
    telegramEventRows,
  };
}
