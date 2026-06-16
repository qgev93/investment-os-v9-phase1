import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPhase1Command } from "../src/cli/app.js";
import {
  advanceBtcusdcPaperTradingState,
  appendBtcusdcPaperTradingEvents,
  buildBtcusdcPaperTelegramMessage,
  createInitialBtcusdcPaperTradingState,
  saveBtcusdcPaperTradingState,
  type BtcusdcPaperTradingEvent,
  type BtcusdcPaperTradingState,
} from "../src/trading/btcusdcPaperTrading.js";
import {
  buildBtcusdcWorkflowTelegramMessage,
  buildBtcusdcDailyPerformanceTelegramMessage,
  shouldRunBtcusdcWeeklyResearch,
  shouldSendBtcusdcDailyReport,
} from "../src/trading/btcusdcDailyReport.js";
import {
  recordBtcusdcTelegramReportSend,
  shouldSendBtcusdcTelegramReport,
} from "../src/trading/btcusdcTelegramReportQuota.js";
import {
  buildBtcusdcActivePaperCandidateSets,
  evaluateBtcusdcCoreTestGate,
  filterBtcusdcCoreTelegramEvents,
  type BtcusdcCoreTestResult,
  type BtcusdcStrategyRegistryEntry,
} from "../src/trading/btcusdcStrategyRegistry.js";
import {
  buildBtcusdtEdgeZonePortfolioOrders,
  buildBtcusdtMicroScalpPortfolioOrders,
  buildBtcusdtStrategylessOhlcvPortfolioOrders,
  type Candle,
  type MicroScalpPortfolioCandidate,
  type StrategylessOhlcvPortfolioCandidate,
} from "../src/trading/btcusdtResearch.js";

function candle(openTime: number, open: number, high: number, low: number, close: number, volume = 10): Candle {
  return { openTime, open, high, low, close, volume };
}

function pushFiveMinuteCandle(
  target: Candle[],
  groupIndex: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 10,
): void {
  const start = groupIndex * 5 * 60_000;
  const step = (close - open) / 5;
  for (let minute = 0; minute < 5; minute += 1) {
    const minuteOpen = open + step * minute;
    const minuteClose = minute === 4 ? close : open + step * (minute + 1);
    target.push(
      candle(
        start + minute * 60_000,
        minuteOpen,
        minute === 0 ? high : Math.max(minuteOpen, minuteClose),
        minute === 0 ? low : Math.min(minuteOpen, minuteClose),
        minuteClose,
        volume / 5,
      ),
    );
  }
}

function klineFromCandle(item: Candle): unknown[] {
  return [
    item.openTime,
    String(item.open),
    String(item.high),
    String(item.low),
    String(item.close),
    String(item.volume),
    item.openTime + 59_999,
  ];
}

function buildInsideVolumeWinCandles(): Candle[] {
  const oneMinute: Candle[] = [];
  for (let group = 0; group < 6; group += 1) {
    pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
  }
  pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
  pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
  pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
  pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);
  return oneMinute;
}

function appendInsideVolumeOutcome(target: Candle[], groupOffset: number, outcome: "win" | "loss"): void {
  for (let group = 0; group < 6; group += 1) {
    pushFiveMinuteCandle(target, groupOffset + group, 100, 101, 99.5, 100.2, 20);
  }
  pushFiveMinuteCandle(target, groupOffset + 6, 100, 106, 96, 101, 40);
  pushFiveMinuteCandle(target, groupOffset + 7, 101, 102.5, 99, 102, 18);
  pushFiveMinuteCandle(target, groupOffset + 8, 102, 108, 101.5, 107, 80);
  if (outcome === "win") {
    pushFiveMinuteCandle(target, groupOffset + 9, 107, 116, 106, 115, 40);
  } else {
    pushFiveMinuteCandle(target, groupOffset + 9, 107, 108, 98, 100, 40);
  }
}

function buildRepeatedInsideVolumeCandles(outcomes: Array<"win" | "loss">): Candle[] {
  const oneMinute: Candle[] = [];
  outcomes.forEach((outcome, index) => appendInsideVolumeOutcome(oneMinute, index * 20, outcome));
  return oneMinute;
}

const TEST_CANDIDATES = [
  {
    label: "inside-volume",
    strategyId: "inside-bar-expansion-retest-long",
    zoneId: "volumeRank:high",
    entryMode: "limit-signal-close" as const,
    targetR: 1,
    maxHoldFiveMinuteBars: 1,
  },
];

const TEST_MICRO_CANDIDATES: MicroScalpPortfolioCandidate[] = [
  {
    label: "micro-squeeze-short",
    strategyId: "micro-squeeze-break-q35-short",
    zoneId: "width:2+quietRangeRank:lte0.35",
    entryMode: "limit-half-pullback",
    targetR: 4,
    maxHoldBars: 5,
  },
];

const TEST_STRATEGYLESS_CANDIDATES: StrategylessOhlcvPortfolioCandidate[] = [
  {
    label: "strategyless-bear-flat-short",
    conditionId: "bodyDirection:bear+recentDrift:flat",
    direction: "short",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
];
const TEST_CANDIDATE_LABEL = "inside-volume";
const TEST_MICRO_CANDIDATE_LABEL = "micro-squeeze-short";
const TEST_STRATEGYLESS_CANDIDATE_LABEL = "strategyless-bear-flat-short";

function buildStrategylessBearFlatShortCandles(): Candle[] {
  const oneMinute: Candle[] = [];
  for (let group = 0; group < 6; group += 1) {
    pushFiveMinuteCandle(oneMinute, group, 100, 105, 95, 100, 20);
  }
  pushFiveMinuteCandle(oneMinute, 6, 100, 101, 94, 95, 120);
  pushFiveMinuteCandle(oneMinute, 7, 95, 99, 84, 86, 80);
  return oneMinute;
}

function buildMicroSqueezeBreakShortCandles(): Candle[] {
  const oneMinute: Candle[] = [];
  for (let i = 0; i < 100; i += 1) {
    const base = 100 + (i % 2 === 0 ? 0.03 : -0.03);
    oneMinute.push(candle(i * 60_000, base, base + 0.3, base - 0.3, 100, 10));
  }
  for (let i = 100; i < 108; i += 1) {
    oneMinute.push(candle(i * 60_000, 100, 100.1, 99.9, 100, 6));
  }
  oneMinute.push(candle(108 * 60_000, 100, 100.1, 99.9, 100, 6));
  oneMinute.push(candle(109 * 60_000, 100, 100.2, 98.8, 99.0, 30));
  oneMinute.push(candle(110 * 60_000, 99.0, 100.0, 99.0, 99.4, 12));
  oneMinute.push(candle(111 * 60_000, 99.4, 99.5, 98.0, 98.3, 20));
  return oneMinute;
}

function activeState(): BtcusdcPaperTradingState {
  return createInitialBtcusdcPaperTradingState({
    nowIso: "2026-06-15T00:00:00.000Z",
    activationOpenTime: 0,
    initialEquity: 10_000,
    riskPct: 0.01,
  });
}

function passingCoreTestResult(overrides: Partial<BtcusdcCoreTestResult> = {}): BtcusdcCoreTestResult {
  return {
    lookbackDays: 180,
    filledTrades: 420,
    submittedOrders: 1_200,
    fillRate: 0.35,
    expectancyR: 0.12,
    profitFactor: 1.42,
    fullKelly: 0.08,
    totalR: 72,
    maxDrawdownR: 21,
    totalRToMaxDrawdown: 3.43,
    positiveFoldRate: 0.78,
    worstFoldExpectancyR: -0.05,
    recent30ExpectancyR: 0.04,
    recent90ExpectancyR: 0.07,
    bestDayRemovedProfitFactor: 1.12,
    bestFivePctRemovedExpectancyR: 0.01,
    longTradeShare: 0.52,
    shortTradeShare: 0.48,
    portfolioMaxDrawdownDeltaR: -1,
    passed: true,
    ...overrides,
  };
}

describe("BTCUSDC.P paper forward trading bot", () => {
  it("defaults new paper states to a 1000 USDC daily seed", () => {
    const state = createInitialBtcusdcPaperTradingState({
      nowIso: "2026-06-15T00:00:00.000Z",
      candles: [candle(Date.UTC(2026, 5, 14, 15, 0, 0), 100, 101, 99, 100)],
      activationOpenTime: 0,
    });

    expect(state).toMatchObject({
      initialEquity: 1_000,
      equity: 1_000,
      peakEquity: 1_000,
      dailySeedEquity: 1_000,
      dailySeedDate: "2026-06-15",
      bettingMode: "kelly_daily_seed",
    });
  });

  it("builds future-blind portfolio orders from completed candle and volume conditions", () => {
    const orders = buildBtcusdtEdgeZonePortfolioOrders(buildInsideVolumeWinCandles(), {
      candidates: TEST_CANDIDATES,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      candidateLabel: "inside-volume",
      strategyId: "inside-bar-expansion-retest-long",
      zoneId: "volumeRank:high",
      direction: "long",
      entryMode: "limit-signal-close",
      entryPrice: 107,
      stopPrice: 99,
      targetPrice: 115,
      maxBars: 5,
    });
  });

  it("builds 1-5 minute micro scalp orders without forcing a five-minute signal candle", () => {
    const orders = buildBtcusdtMicroScalpPortfolioOrders(buildMicroSqueezeBreakShortCandles(), {
      candidates: TEST_MICRO_CANDIDATES,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-half-pullback"],
        entryWaitBars: 3,
        entryFillBufferTicks: 2,
      },
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      candidateLabel: "micro-squeeze-short",
      strategyId: "micro-squeeze-break-q35-short",
      zoneId: "width:2+quietRangeRank:lte0.35",
      direction: "short",
      entryMode: "limit-half-pullback",
      signalOpenTime: 108 * 60_000,
      entryOpenTime: 110 * 60_000,
      entryPrice: 99.7,
      stopPrice: 100.1,
      maxBars: 5,
    });
    expect(orders[0].targetPrice).toBeCloseTo(98.1, 8);
  });

  it("builds strategyless OHLCV orders from completed transform conditions", () => {
    const orders = buildBtcusdtStrategylessOhlcvPortfolioOrders(buildStrategylessBearFlatShortCandles(), {
      candidates: TEST_STRATEGYLESS_CANDIDATES,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-half-pullback"],
        entryWaitBars: 3,
      },
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      candidateLabel: "strategyless-bear-flat-short",
      strategyId: "strategyless-ohlcv",
      zoneId: "bodyDirection:bear+recentDrift:flat",
      direction: "short",
      entryMode: "limit-half-pullback",
      signalOpenTime: 6 * 5 * 60_000,
      entryOpenTime: 7 * 5 * 60_000,
      entryPrice: 98.5,
      stopPrice: 101,
      targetPrice: 88.5,
      maxBars: 60,
      maxHoldFiveMinuteBars: 12,
    });
  });

  it("advances state once, records paper order lifecycle events, and avoids duplicate records", () => {
    const first = advanceBtcusdcPaperTradingState(buildInsideVolumeWinCandles(), activeState(), {
      candidates: TEST_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    expect(first.events.map((event) => event.type)).toEqual(["order_submitted", "order_filled", "trade_closed"]);
    expect(first.state).toMatchObject({
      closedTrades: 1,
      totalPnlR: 1,
      equity: 10_100,
      lastCandleOpenTime: 2_940_000,
    });

    const second = advanceBtcusdcPaperTradingState(buildInsideVolumeWinCandles(), first.state, {
      candidates: TEST_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:02:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    expect(second.events).toEqual([]);
    expect(second.state.closedTrades).toBe(1);
  });

  it("advances state with micro scalp candidates alongside the five-minute edge candidates", () => {
    const result = advanceBtcusdcPaperTradingState(buildMicroSqueezeBreakShortCandles(), activeState(), {
      candidates: [],
      microCandidates: TEST_MICRO_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-half-pullback"],
        entryWaitBars: 3,
        entryFillBufferTicks: 2,
      },
    });

    expect(result.events.map((event) => event.type)).toEqual(["order_submitted", "order_filled", "trade_closed"]);
    expect(result.events.at(-1)).toMatchObject({
      strategyId: "micro-squeeze-break-q35-short",
      candidateLabel: "micro-squeeze-short",
      direction: "short",
      pnlR: 4,
      riskAmount: 100,
      equity: 10_400,
    });
    expect(result.state).toMatchObject({
      closedTrades: 1,
      totalPnlR: 4,
      equity: 10_400,
    });
  });

  it("advances state with strategyless shadow candidates", () => {
    const result = advanceBtcusdcPaperTradingState(buildStrategylessBearFlatShortCandles(), activeState(), {
      candidates: [],
      strategylessCandidates: TEST_STRATEGYLESS_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-half-pullback"],
        entryWaitBars: 3,
        entryFillBufferTicks: 0,
      },
    });

    expect(result.events.map((event) => event.type)).toEqual(["order_submitted", "order_filled", "trade_closed"]);
    expect(result.events.at(-1)).toMatchObject({
      strategyId: "strategyless-ohlcv",
      candidateLabel: "strategyless-bear-flat-short",
      direction: "short",
      pnlR: 4,
      riskSource: "fixed_override",
      equity: 10_400,
    });
    expect(result.summary.closedTrades).toBe(1);
  });

  it("keeps same-day risk sizing tied to the daily seed instead of compounding after each trade", () => {
    const result = advanceBtcusdcPaperTradingState(buildRepeatedInsideVolumeCandles(["win", "win"]), activeState(), {
      candidates: TEST_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    const closedEvents = result.events.filter((event) => event.type === "trade_closed");
    expect(result.state.closedTrades).toBe(2);
    expect(result.state.equity).toBe(10_200);
    expect(closedEvents.map((event) => event.riskAmount)).toEqual([100, 100]);
    expect(closedEvents.map((event) => event.dailySeedEquity)).toEqual([10_000, 10_000]);
  });

  it("tracks each strategy as its own 1000 USDC paper account", () => {
    const first = advanceBtcusdcPaperTradingState(
      buildInsideVolumeWinCandles(),
      createInitialBtcusdcPaperTradingState({
        nowIso: "2026-06-15T00:00:00.000Z",
        activationOpenTime: 0,
        initialEquity: 1000,
      }),
      {
        candidates: TEST_CANDIDATES,
        riskPct: 0.01,
        nowIso: "2026-06-15T00:01:00.000Z",
        config: {
          minTrades: 1,
          feeRate: 0,
          tickSize: 0.1,
          adverseTicks: 0,
          kellyFraction: 0.25,
          riskCapPct: 0.005,
          minRiskPct: 0,
          entryModes: ["limit-signal-close"],
        },
      },
    );
    const second = advanceBtcusdcPaperTradingState(buildMicroSqueezeBreakShortCandles(), first.state, {
      candidates: [],
      microCandidates: TEST_MICRO_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:02:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-half-pullback"],
        entryWaitBars: 3,
        entryFillBufferTicks: 2,
      },
    });

    expect(second.state.strategyAccounts[TEST_CANDIDATE_LABEL]).toMatchObject({
      initialEquity: 1000,
      equity: 1010,
      dailySeedEquity: 1000,
      closedTrades: 1,
    });
    expect(second.state.strategyAccounts[TEST_MICRO_CANDIDATE_LABEL]).toMatchObject({
      initialEquity: 1000,
      equity: 1040,
      dailySeedEquity: 1000,
      closedTrades: 1,
    });
    expect(second.state.equity).toBe(2050);
    expect(second.events.at(-1)).toMatchObject({
      candidateLabel: TEST_MICRO_CANDIDATE_LABEL,
      riskAmount: 10,
      dailySeedEquity: 1000,
      strategyEquity: 1040,
      equity: 2050,
    });
  });

  it("uses past-only Kelly sizing when no fixed risk override is supplied", () => {
    const candles = buildRepeatedInsideVolumeCandles(["win", "win", "loss", "win"]);
    const orders = buildBtcusdtEdgeZonePortfolioOrders(candles, {
      candidates: TEST_CANDIDATES,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.1,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });
    const state = createInitialBtcusdcPaperTradingState({
      nowIso: "2026-06-15T00:00:00.000Z",
      activationOpenTime: 0,
      initialEquity: 1_000,
    });
    state.knownOrderIds = orders.slice(0, 3).map((order) => order.orderId);
    state.filledOrderIds = orders.slice(0, 3).map((order) => order.orderId);
    state.closedOrderIds = orders.slice(0, 3).map((order) => order.orderId);

    const result = advanceBtcusdcPaperTradingState(candles, state, {
      candidates: TEST_CANDIDATES,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 3,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.1,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    const closed = result.events.find((event) => event.type === "trade_closed");
    expect(closed).toMatchObject({ riskSource: "historical_kelly", historicalTradesForKelly: 3 });
    expect(closed?.riskAmount).toBeCloseTo(83.33333333333333, 8);
    expect(closed?.riskPct).toBeCloseTo(0.0833333333, 8);
    expect(result.state.equity).toBeCloseTo(1_083.3333333333333, 8);
  });

  it("starts fresh paper monitoring after warmup history instead of alerting old trades", () => {
    const candles = buildInsideVolumeWinCandles();
    const state = createInitialBtcusdcPaperTradingState({
      nowIso: "2026-06-15T00:00:00.000Z",
      candles,
      initialEquity: 10_000,
      riskPct: 0.01,
    });

    const result = advanceBtcusdcPaperTradingState(candles, state, {
      candidates: TEST_CANDIDATES,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    expect(result.events).toEqual([]);
    expect(result.state.closedTrades).toBe(0);
  });

  it("persists state and appends reviewable JSONL event records", () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-paper-state-"));
    try {
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      const result = advanceBtcusdcPaperTradingState(buildInsideVolumeWinCandles(), activeState(), {
        candidates: TEST_CANDIDATES,
        riskPct: 0.01,
        nowIso: "2026-06-15T00:01:00.000Z",
        config: {
          minTrades: 1,
          feeRate: 0,
          tickSize: 0.1,
          adverseTicks: 0,
          kellyFraction: 0.25,
          riskCapPct: 0.005,
          minRiskPct: 0,
          entryModes: ["limit-signal-close"],
        },
      });

      saveBtcusdcPaperTradingState(statePath, result.state);
      appendBtcusdcPaperTradingEvents(logPath, result.events);

      expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ closedTrades: 1, equity: 10_100 });
      const lines = readFileSync(logPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(lines.map((line) => line.type)).toEqual(["order_submitted", "order_filled", "trade_closed"]);
      expect(lines.at(-1)).toMatchObject({ pnlR: 1, equity: 10_100 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a compact Telegram paper trading message", () => {
    const result = advanceBtcusdcPaperTradingState(buildInsideVolumeWinCandles(), activeState(), {
      candidates: TEST_CANDIDATES,
      riskPct: 0.01,
      nowIso: "2026-06-15T00:01:00.000Z",
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
      },
    });

    const message = buildBtcusdcPaperTelegramMessage(result.events, result.summary);

    expect(message.text).toContain("BTCUSDC.P 페이퍼 매매 알림");
    expect(message.text).toContain("거래종료");
    expect(message.text).toContain("+1.00R");
    expect(message.text).toContain("10,100.00");
  });

  it("requires six-month core gate results before a strategy can be Telegram-active", () => {
    expect(evaluateBtcusdcCoreTestGate(passingCoreTestResult())).toEqual({
      passed: true,
      reasons: [],
    });

    const rejected = evaluateBtcusdcCoreTestGate(
      passingCoreTestResult({
        lookbackDays: 179,
        filledTrades: 299,
        profitFactor: 1.19,
        recent30ExpectancyR: 0,
      }),
    );

    expect(rejected.passed).toBe(false);
    expect(rejected.reasons).toContain("lookbackDays < 180");
    expect(rejected.reasons).toContain("filledTrades < 300");
    expect(rejected.reasons).toContain("profitFactor < 1.20");
    expect(rejected.reasons).toContain("recent30ExpectancyR <= 0");
  });

  it("keeps only six-month-passing core strategies in the Telegram-active candidate set", () => {
    const entries: BtcusdcStrategyRegistryEntry[] = [
      {
        id: "core-pass",
        name: TEST_CANDIDATE_LABEL,
        status: "core",
        candidateType: "edge",
        candidate: TEST_CANDIDATES[0],
        coreTest: passingCoreTestResult(),
      },
      {
        id: "core-fail",
        name: "failed-core",
        status: "core",
        candidateType: "edge",
        candidate: { ...TEST_CANDIDATES[0], label: "failed-core" },
        coreTest: passingCoreTestResult({ passed: false, profitFactor: 1.05 }),
      },
      {
        id: "shadow-strategyless",
        name: TEST_STRATEGYLESS_CANDIDATE_LABEL,
        status: "shadow",
        candidateType: "strategyless",
        candidate: TEST_STRATEGYLESS_CANDIDATES[0],
      },
      {
        id: "disabled-micro",
        name: TEST_MICRO_CANDIDATE_LABEL,
        status: "disabled",
        candidateType: "micro",
        candidate: TEST_MICRO_CANDIDATES[0],
      },
    ];

    const sets = buildBtcusdcActivePaperCandidateSets(entries);

    expect(sets.coreCandidates.map((candidate) => candidate.label)).toEqual([
      TEST_CANDIDATE_LABEL,
    ]);
    expect(sets.microShadowCandidates).toEqual([]);
    expect(sets.strategylessShadowCandidates.map((candidate) => candidate.label)).toEqual([
      TEST_STRATEGYLESS_CANDIDATE_LABEL,
    ]);
    expect(sets.coreTelegramCandidateLabels).toEqual(new Set([TEST_CANDIDATE_LABEL]));
  });

  it("filters live Telegram trade alerts to core strategy events only", () => {
    const eventRows = [
      { type: "order_submitted", candidateLabel: TEST_CANDIDATE_LABEL },
      { type: "order_submitted", candidateLabel: TEST_STRATEGYLESS_CANDIDATE_LABEL },
      { type: "trade_closed", candidateLabel: TEST_CANDIDATE_LABEL },
    ] as BtcusdcPaperTradingEvent[];

    const filtered = filterBtcusdcCoreTelegramEvents(
      eventRows,
      new Set([TEST_CANDIDATE_LABEL]),
    );

    expect(filtered.map((event) => event.candidateLabel)).toEqual([
      TEST_CANDIDATE_LABEL,
      TEST_CANDIDATE_LABEL,
    ]);
  });

  it("builds a strategy performance report with each bot on a 1000 USDC seed", () => {
    const events = [
      {
        type: "order_submitted",
        candidateLabel: TEST_CANDIDATE_LABEL,
        direction: "long",
      },
      {
        type: "trade_closed",
        candidateLabel: TEST_CANDIDATE_LABEL,
        direction: "long",
        pnlR: 1.4,
        pnl: 14,
        riskAmount: 10,
        strategyEquity: 1014,
        equity: 1014,
      },
      {
        type: "order_submitted",
        candidateLabel: TEST_STRATEGYLESS_CANDIDATE_LABEL,
        direction: "short",
      },
      {
        type: "trade_closed",
        candidateLabel: TEST_STRATEGYLESS_CANDIDATE_LABEL,
        direction: "short",
        pnlR: -1,
        pnl: -10,
        riskAmount: 10,
        strategyEquity: 990,
        equity: 1004,
      },
    ] as BtcusdcPaperTradingEvent[];

    const message = buildBtcusdcDailyPerformanceTelegramMessage(events, {
      seedEquity: 1000,
      state: createInitialBtcusdcPaperTradingState({
        nowIso: "2026-06-16T00:00:00.000Z",
        initialEquity: 1000,
      }),
      strategyStatuses: new Map([
        [TEST_CANDIDATE_LABEL, "core"],
        [TEST_STRATEGYLESS_CANDIDATE_LABEL, "shadow"],
      ]),
    });

    expect(message).toContain("BTCUSDC.P 페이퍼 일일 보고");
    expect(message).not.toContain("워크플로우");
    expect(message).toContain("각 전략 1000 USDC 테스트");
    expect(message).toContain("전략시드 1,000.00 USDC | 자산 1,014.00");
    expect(message).toContain("전략시드 1,000.00 USDC | 자산 990.00");
    expect(message).toContain(TEST_CANDIDATE_LABEL);
    expect(message).toContain(TEST_STRATEGYLESS_CANDIDATE_LABEL);
    expect(message).toContain("포트폴리오");
    expect(message.match(/BTCUSDC\.P 페이퍼 일일 보고/g)).toHaveLength(1);
  });

  it("builds a separate workflow progress report", () => {
    const message = buildBtcusdcWorkflowTelegramMessage({
      generatedAtIso: "2026-06-16T00:10:00.000Z",
      realtimeWorker: "실시간 worker 실행중",
      dailyReport: "성과보고 KST 09:00",
      weeklyResearch: "주간연구 월 KST 01:20; 최근 성공",
      telegramQuota: "Telegram 하루 최대 2회",
      notes: ["성과 보고와 분리", "각 전략 1000 USDC 계좌 기준"],
    });

    expect(message).toContain("BTCUSDC.P 워크플로우 진행 보고");
    expect(message).toContain("실시간 worker 실행중");
    expect(message).toContain("주간연구 월 KST 01:20; 최근 성공");
    expect(message).toContain("각 전략 1000 USDC 계좌 기준");
    expect(message).not.toContain(TEST_CANDIDATE_LABEL);
  });

  it("limits all BTCUSDC Telegram reports to two sends per KST day", () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-telegram-quota-"));
    try {
      const quotaPath = join(dir, "quota.json");
      const first = shouldSendBtcusdcTelegramReport({
        quotaPath,
        nowIso: "2026-06-16T00:10:00.000Z",
        maxPerDay: 2,
      });
      expect(first).toEqual({ allowed: true, currentDate: "2026-06-16", sentCount: 0, maxPerDay: 2 });
      recordBtcusdcTelegramReportSend({ quotaPath, nowIso: "2026-06-16T00:10:00.000Z", messageId: 1 });
      recordBtcusdcTelegramReportSend({ quotaPath, nowIso: "2026-06-16T01:10:00.000Z", messageId: 2 });

      expect(
        shouldSendBtcusdcTelegramReport({
          quotaPath,
          nowIso: "2026-06-16T12:00:00.000Z",
          maxPerDay: 2,
        }),
      ).toEqual({ allowed: false, currentDate: "2026-06-16", sentCount: 2, maxPerDay: 2 });

      expect(
        shouldSendBtcusdcTelegramReport({
          quotaPath,
          nowIso: "2026-06-16T15:00:00.000Z",
          maxPerDay: 2,
        }),
      ).toEqual({ allowed: true, currentDate: "2026-06-17", sentCount: 0, maxPerDay: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends the scheduled daily report once per KST day after the due time", () => {
    expect(
      shouldSendBtcusdcDailyReport({
        nowIso: "2026-06-15T23:59:00.000Z",
        reportAtKst: "09:00",
        lastSentDate: undefined,
      }),
    ).toEqual({ due: false, currentDate: "2026-06-16" });

    expect(
      shouldSendBtcusdcDailyReport({
        nowIso: "2026-06-16T00:00:00.000Z",
        reportAtKst: "09:00",
        lastSentDate: undefined,
      }),
    ).toEqual({ due: true, currentDate: "2026-06-16" });

    expect(
      shouldSendBtcusdcDailyReport({
        nowIso: "2026-06-16T12:00:00.000Z",
        reportAtKst: "09:00",
        lastSentDate: "2026-06-16",
      }),
    ).toEqual({ due: false, currentDate: "2026-06-16" });
  });

  it("runs the scheduled core research once per KST week after the due time", () => {
    expect(
      shouldRunBtcusdcWeeklyResearch({
        nowIso: "2026-06-14T16:19:00.000Z",
        runDayOfWeek: 1,
        runAtKst: "01:20",
        lastStartedWeek: undefined,
      }),
    ).toEqual({ due: false, currentWeek: "2026-06-15" });

    expect(
      shouldRunBtcusdcWeeklyResearch({
        nowIso: "2026-06-14T16:20:00.000Z",
        runDayOfWeek: 1,
        runAtKst: "01:20",
        lastStartedWeek: undefined,
      }),
    ).toEqual({ due: true, currentWeek: "2026-06-15" });

    expect(
      shouldRunBtcusdcWeeklyResearch({
        nowIso: "2026-06-16T12:00:00.000Z",
        runDayOfWeek: 1,
        runAtKst: "01:20",
        lastStartedWeek: "2026-06-15",
      }),
    ).toEqual({ due: false, currentWeek: "2026-06-15" });
  });

  it("runs the daily report CLI and sends all bot performance in one Telegram message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-paper-daily-"));
    try {
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      const quotaPath = join(dir, "telegram-quota.json");
      saveBtcusdcPaperTradingState(
        statePath,
        createInitialBtcusdcPaperTradingState({
          nowIso: "2026-06-15T00:00:00.000Z",
          activationOpenTime: 0,
          initialEquity: 1000,
        }),
      );
      writeFileSync(
        logPath,
        [
          JSON.stringify({
            type: "trade_closed",
            candidateLabel: "baseline-early-climax-short",
            direction: "short",
            pnlR: 2,
            equity: 1020,
          }),
          JSON.stringify({
            type: "trade_closed",
            candidateLabel: TEST_STRATEGYLESS_CANDIDATES[0].label,
            direction: "short",
            pnlR: -1,
            equity: 1010,
          }),
        ].join("\n") + "\n",
      );

      const sentMessages: string[] = [];
      globalThis.fetch = async (url, init) => {
        expect(String(url)).toBe("https://api.telegram.org/botTEST_TOKEN/sendMessage");
        const body = JSON.parse(String(init?.body));
        sentMessages.push(body.text);
        return Response.json({ ok: true, result: { message_id: 88 } });
      };

      const result = await runPhase1Command(
        [
          "trading:paper-btcusdc-daily-report",
          "--state-path",
          statePath,
          "--log-path",
          logPath,
          "--chat-id",
          "-1001",
          "--generated-at",
          "2026-06-16T00:10:00.000Z",
          "--telegram-quota-path",
          quotaPath,
        ],
        { TELEGRAM_BOT_TOKEN: "TEST_TOKEN" },
      );

      expect(result.data).toMatchObject({
        mode: "paper_daily_report",
        events: 2,
        telegramSent: true,
        telegramMessageId: 88,
      });
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toContain("BTCUSDC.P 페이퍼 일일 보고");
      expect(sentMessages[0]).toContain("baseline-early-climax-short");
      expect(sentMessages[0]).toContain(TEST_STRATEGYLESS_CANDIDATES[0].label);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips daily report Telegram send when the KST daily report quota is exhausted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-paper-daily-quota-"));
    try {
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      const quotaPath = join(dir, "telegram-quota.json");
      saveBtcusdcPaperTradingState(
        statePath,
        createInitialBtcusdcPaperTradingState({
          nowIso: "2026-06-15T00:00:00.000Z",
          activationOpenTime: 0,
          initialEquity: 1000,
        }),
      );
      writeFileSync(logPath, "");
      recordBtcusdcTelegramReportSend({ quotaPath, nowIso: "2026-06-16T00:00:00.000Z", messageId: 1 });
      recordBtcusdcTelegramReportSend({ quotaPath, nowIso: "2026-06-16T01:00:00.000Z", messageId: 2 });

      globalThis.fetch = async () => {
        throw new Error("Telegram should not be called when daily quota is exhausted");
      };

      const result = await runPhase1Command(
        [
          "trading:paper-btcusdc-daily-report",
          "--state-path",
          statePath,
          "--log-path",
          logPath,
          "--chat-id",
          "-1001",
          "--generated-at",
          "2026-06-16T12:00:00.000Z",
          "--telegram-quota-path",
          quotaPath,
        ],
        { TELEGRAM_BOT_TOKEN: "TEST_TOKEN" },
      );

      expect(result.data).toMatchObject({
        mode: "paper_daily_report",
        telegramSent: false,
        telegramSkippedReason: "daily_quota_exhausted",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs one paper step through the CLI, saves logs, and sends Telegram when configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-paper-cli-"));
    try {
      const filePath = join(dir, "klines.json");
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      const quotaPath = join(dir, "telegram-quota.json");
      writeFileSync(filePath, JSON.stringify(buildInsideVolumeWinCandles().map(klineFromCandle)));

      const sentMessages: string[] = [];
      globalThis.fetch = async (url, init) => {
        expect(String(url)).toBe("https://api.telegram.org/botTEST_TOKEN/sendMessage");
        const body = JSON.parse(String(init?.body));
        sentMessages.push(body.text);
        return Response.json({ ok: true, result: { message_id: 77 } });
      };

      const result = await runPhase1Command(
        [
          "trading:paper-btcusdc-once",
          "--file",
          filePath,
          "--state-path",
          statePath,
          "--log-path",
          logPath,
          "--activation-open-time",
          "0",
          "--portfolio-candidates",
          "inside-volume|inside-bar-expansion-retest-long|volumeRank:high|limit-signal-close|1|1",
          "--chat-id",
          "-1001",
          "--telegram-quota-path",
          quotaPath,
        ],
        { TELEGRAM_BOT_TOKEN: "TEST_TOKEN" },
      );

      expect(result.data).toMatchObject({
        mode: "paper_forward_once",
        symbol: "BTCUSDC",
        displaySymbol: "BTCUSDC.P",
        events: 3,
        closedTrades: 1,
      });
      expect(sentMessages.at(-1)).toContain("BTCUSDC.P 페이퍼 매매 알림");
      expect(existsSync(statePath)).toBe(true);
      expect(readFileSync(logPath, "utf8").trim().split(/\r?\n/)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
