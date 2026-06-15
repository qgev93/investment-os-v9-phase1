import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPhase1Command } from "../src/cli/app.js";
import {
  buildBtcusdtEdgeZoneReport,
  buildBtcusdtEdgeZoneFragilityReport,
  buildBtcusdtEdgeZonePortfolioReport,
  buildBtcusdtEdgeZonePortfolioRobustnessReport,
  buildBtcusdtEdgeZonePortfolioRollingReport,
  buildBtcusdtEdgeZonePortfolioExecutionSweepReport,
  buildBtcusdtEdgeZoneStressReport,
  buildBtcusdtEdgeZoneWalkForwardReport,
  buildBtcusdtResearchReport,
  buildBtcusdtResearchSweep,
  buildBtcusdtStrategylessOhlcvReport,
  buildBtcusdtWalkForwardReport,
  computeKellyRisk,
  filterPayoffSkewZones,
  parseBinanceKlines,
  resampleToFiveMinuteCandles,
  simulateBarrierTrade,
  simulateReplayTrade,
  type Candle,
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

describe("BTCUSDT OHLCV research engine", () => {
  it("parses Binance klines and resamples one-minute candles into five-minute signal candles", () => {
    const oneMinute = parseBinanceKlines([
      [0, "100", "102", "99", "101", "10"],
      [60_000, "101", "103", "100", "102", "11"],
      [120_000, "102", "104", "101", "103", "12"],
      [180_000, "103", "105", "102", "104", "13"],
      [240_000, "104", "106", "103", "105", "14"],
      [300_000, "105", "107", "104", "106", "15"],
    ]);

    const fiveMinute = resampleToFiveMinuteCandles(oneMinute);

    expect(fiveMinute).toHaveLength(1);
    expect(fiveMinute[0]).toMatchObject({
      openTime: 0,
      open: 100,
      high: 106,
      low: 99,
      close: 105,
      volume: 60,
      sourceStartIndex: 0,
      sourceEndIndex: 4,
    });
  });

  it("resamples only complete wall-clock aligned five-minute candles", () => {
    const oneMinute: Candle[] = [];
    for (let i = 1; i <= 9; i += 1) {
      oneMinute.push(candle(i * 60_000, 100 + i, 101 + i, 99 + i, 100.5 + i, 10));
    }

    const fiveMinute = resampleToFiveMinuteCandles(oneMinute);

    expect(fiveMinute).toHaveLength(1);
    expect(fiveMinute[0]).toMatchObject({
      openTime: 300_000,
      open: 105,
      close: 109.5,
      sourceStartIndex: 4,
      sourceEndIndex: 8,
    });
  });

  it("uses conservative one-minute barrier ordering when stop and target are inside the same candle", () => {
    const result = simulateBarrierTrade({
      direction: "long",
      entryPrice: 100,
      stopPrice: 99,
      targetR: 2,
      maxBars: 3,
      oneMinuteCandles: [
        candle(0, 100, 102.2, 98.9, 101),
        candle(60_000, 101, 101.5, 100.5, 101),
      ],
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
    });

    expect(result.pnlR).toBe(-1);
    expect(result.exitReason).toBe("stop");
  });

  it("replays maker limit entries only after the fixed limit price is touched", () => {
    const result = simulateReplayTrade({
      direction: "long",
      entryMode: "limit-half-pullback",
      signalCandle: candle(0, 100, 106, 99, 105),
      stopPrice: 99,
      targetR: 2,
      maxBars: 3,
      entryWaitBars: 2,
      oneMinuteCandles: [
        candle(300_000, 105.2, 106, 102.1, 104),
        candle(360_000, 104, 109, 101.4, 108),
        candle(420_000, 108, 110, 107, 109),
      ],
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
    });

    expect(result).toMatchObject({
      pnlR: 2,
      rawPnlR: 2,
      costR: 0,
      exitReason: "target",
      barsHeld: 2,
      entryPrice: 101.5,
      entryFilled: true,
    });
  });

  it("skips maker limit orders that are not touched during the replay entry window", () => {
    const result = simulateReplayTrade({
      direction: "short",
      entryMode: "limit-half-pullback",
      signalCandle: candle(0, 105, 106, 99, 100),
      stopPrice: 106,
      targetR: 2,
      maxBars: 3,
      entryWaitBars: 2,
      oneMinuteCandles: [
        candle(300_000, 100, 102.8, 99, 100.5),
        candle(360_000, 100.5, 102.9, 98, 99),
        candle(420_000, 99, 100, 95, 96),
      ],
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
    });

    expect(result).toBeNull();
  });

  it("can require a passive limit order to trade through the entry price before counting a fill", () => {
    const result = simulateReplayTrade({
      direction: "long",
      entryMode: "limit-signal-close",
      signalCandle: candle(0, 100, 106, 99, 105),
      stopPrice: 104,
      targetR: 1,
      maxBars: 2,
      entryWaitBars: 1,
      entryFillBufferTicks: 1,
      oneMinuteCandles: [
        candle(300_000, 105.2, 105.4, 105, 105.3),
        candle(360_000, 105.3, 105.5, 105.1, 105.2),
      ],
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
    });

    expect(result).toBeNull();
  });

  it("does not award a target from the same one-minute candle that first touches a passive limit", () => {
    const result = simulateReplayTrade({
      direction: "long",
      entryMode: "limit-half-pullback",
      signalCandle: candle(0, 100, 106, 99, 105),
      stopPrice: 99,
      targetR: 1,
      maxBars: 2,
      entryWaitBars: 1,
      oneMinuteCandles: [
        candle(300_000, 105, 106, 101.4, 102),
        candle(360_000, 102, 103, 100, 102),
      ],
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
    });

    expect(result?.exitReason).toBe("timeout");
    expect(result?.pnlR).toBeCloseTo(0.2, 6);
  });

  it("computes fractional Kelly risk with an absolute risk cap", () => {
    const risk = computeKellyRisk({
      winRate: 0.42,
      payoffRatio: 2,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
    });

    expect(risk.fullKelly).toBeCloseTo(0.13, 6);
    expect(risk.recommendedRiskPct).toBe(0.005);
  });

  it("builds a BTCUSDT research report from one-minute candles without indicators", () => {
    const oneMinute: Candle[] = [];
    for (let i = 0; i < 180; i += 1) {
      const base = 100 + i * 0.05;
      const isExpansionClose = i % 15 >= 10;
      const range = isExpansionClose ? 2 : 0.4;
      const volume = isExpansionClose ? 100 : 10;
      oneMinute.push(candle(i * 60_000, base, base + range, base - 0.2, base + range * 0.8, volume));
    }

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0.0005,
    });

    expect(report.symbol).toBe("BTCUSDT");
    expect(report.sourceInterval).toBe("1m");
    expect(report.signalInterval).toBe("5m");
    expect(report.candles.oneMinute).toBe(180);
    expect(report.candles.fiveMinute).toBe(36);
    expect(report.config.minRiskPct).toBe(0.0005);
    expect(report.strategies.length).toBeGreaterThan(0);
    expect(report.strategies[0]).toHaveProperty("expectancyR");
    expect(report.assumptions).toContain("No technical indicators: only OHLCV-derived bar geometry and volume ranks.");
  });

  it("mines simple raw-bar zones instead of relying only on named candle patterns", () => {
    const oneMinute: Candle[] = [];
    for (let i = 0; i < 600; i += 1) {
      const inBullZone = Math.floor(i / 5) % 6 === 0;
      const base = 100 + i * 0.02;
      const range = inBullZone ? 2 : 0.4;
      const volume = inBullZone ? 100 : 10;
      const close = inBullZone ? base + range * 0.9 : base + 0.05;
      oneMinute.push(candle(i * 60_000, base, base + range, base - 0.1, close, volume));
    }

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 3,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("mined-zone:"))).toBe(true);
  });

  it("builds strategyless OHLCV condition variants without named strategy families", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 60; group += 1) {
      const base = 100 + group * 0.05;
      if (group % 8 === 6) {
        pushFiveMinuteCandle(oneMinute, group, base, base + 0.4, base - 6, base - 5.2, 240);
      } else if (group % 8 === 7) {
        pushFiveMinuteCandle(oneMinute, group, base - 5.2, base + 5.5, base - 5.4, base + 4.8, 90);
      } else {
        pushFiveMinuteCandle(oneMinute, group, base, base + 0.35, base - 0.35, base + 0.05, 20);
      }
    }

    const report = buildBtcusdtStrategylessOhlcvReport(oneMinute, {
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
      maxConditions: 2,
      targetRs: [1],
      holdMinutes: [5, 360],
      minTrades: 1,
      minFillRate: 0,
    });

    expect(report.sourceInterval).toBe("1m");
    expect(report.contextInterval).toBe("5m");
    expect(report.holdMinutes).toEqual([5, 360]);
    expect(report.assumptions).toContain("No fixed strategy families: candidates are generated from OHLCV transform labels.");
    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.candidates.every((candidate) => candidate.strategyFamily === "strategyless-ohlcv")).toBe(true);
    expect(report.candidates.some((candidate) => candidate.variantId.includes(":hold-360m"))).toBe(true);
    expect(report.candidates.some((candidate) => candidate.conditionId.includes("+"))).toBe(true);
  });

  it("adds intrabar path, volume slope, wick imbalance, and extreme-order atoms to strategyless discovery", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 80; group += 1) {
      if (group % 4 === 2) {
        const start = group * 5 * 60_000;
        oneMinute.push(candle(start, 100, 105, 99, 104, 10));
        oneMinute.push(candle(start + 60_000, 104, 106, 103, 105.5, 20));
        oneMinute.push(candle(start + 120_000, 105.5, 106, 101, 102, 30));
        oneMinute.push(candle(start + 180_000, 102, 103, 97, 98, 40));
        oneMinute.push(candle(start + 240_000, 98, 99, 93, 94, 50));
      } else {
        pushFiveMinuteCandle(oneMinute, group, 100, 102, 98, 100.2, 20);
      }
    }

    const report = buildBtcusdtStrategylessOhlcvReport(oneMinute, {
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
        entryModes: ["limit-signal-close"],
        entryWaitBars: 1,
      },
      maxConditions: 2,
      maxConditionSetsPerSignal: 160,
      maxRawBuckets: 240,
      maxCandidates: 400,
      targetRs: [1],
      holdMinutes: [5],
      minTrades: 1,
      minFillRate: 0,
    });

    const conditionIds = report.candidates.map((candidate) => candidate.conditionId).join("|");
    expect(conditionIds).toContain("intrabarVolumeSlope:rising");
    expect(conditionIds).toContain("intrabarBodyMomentum:buildingBear");
    expect(conditionIds).toContain("intrabarReversal:upThenDown");
    expect(conditionIds).toContain("intrabarExtremeOrder:highBeforeLow");
    expect(conditionIds).toContain("wickImbalance:upperDominant");
  });

  it("summarizes strategy results by candle and volume edge zones", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
    pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
    pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);

    const report = buildBtcusdtEdgeZoneReport(oneMinute, {
      strategyIdPrefix: "inside-bar-expansion-retest-long",
      minZoneTrades: 1,
      targetRs: [1],
      maxHoldFiveMinuteBars: [1],
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

    expect(
      report.zones.some(
        (zone) =>
          zone.zoneId === "volumeRank:high" &&
          zone.strategyId === "inside-bar-expansion-retest-long" &&
          zone.trades === 1 &&
          zone.winRate === 1,
      ),
    ).toBe(true);
  });

  it("labels edge zones with OHLCV derivative buckets", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
    pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
    pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 140);

    const report = buildBtcusdtEdgeZoneReport(oneMinute, {
      strategyIdPrefix: "inside-bar-expansion-retest-long",
      minZoneTrades: 1,
      targetRs: [1],
      maxHoldFiveMinuteBars: [1],
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

    expect(report.zones.some((zone) => zone.zoneId === "closeDerivative:up")).toBe(true);
    expect(report.zones.some((zone) => zone.zoneId === "volumeDerivative:rising")).toBe(true);
    expect(report.zones.some((zone) => zone.zoneId === "rangeDerivative:expanding")).toBe(true);
    expect(report.zones.some((zone) => zone.zoneId === "closeAcceleration:acceleratingUp")).toBe(true);
    expect(report.zones.some((zone) => zone.zoneId === "bodyDerivative:expanding")).toBe(true);
    expect(report.zones.some((zone) => zone.zoneId === "effortResult:efficientUp")).toBe(true);
  });

  it("filters edge zones for low-win high-payoff candidates", () => {
    const baseZone = {
      strategyId: "intrabar-early-climax-late-hold-short",
      variantId: "intrabar-early-climax-late-hold-short:entry-limit-half-pullback:target-3:hold-3",
      dimension: "rangeRank",
      direction: "short" as const,
      entryMode: "limit-half-pullback" as const,
      targetR: 3,
      maxHoldFiveMinuteBars: 3,
      signals: 160,
      filledTrades: 100,
      missedTrades: 60,
      fillRate: 0.625,
      trades: 100,
      maxDrawdownR: 10,
    };

    const filtered = filterPayoffSkewZones(
      [
        {
          ...baseZone,
          zoneId: "rangeRank:high",
          bucket: "high",
          winRate: 0.38,
          payoffRatio: 2.4,
          expectancyR: 0.29,
          profitFactor: 1.47,
        },
        {
          ...baseZone,
          zoneId: "rangeRank:mid",
          bucket: "mid",
          winRate: 0.55,
          payoffRatio: 1.2,
          expectancyR: 0.2,
          profitFactor: 1.3,
        },
        {
          ...baseZone,
          zoneId: "rangeRank:low",
          bucket: "low",
          winRate: 0.32,
          payoffRatio: 1.4,
          expectancyR: 0.05,
          profitFactor: 1.1,
        },
      ],
      {
        maxWinRate: 0.4,
        minPayoffRatio: 2,
        minExpectancyR: 0.05,
        minProfitFactor: 1.15,
        minTrades: 50,
      },
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      zoneId: "rangeRank:high",
      winRate: 0.38,
      payoffRatio: 2.4,
    });
  });

  it("stress-tests a selected edge zone with trade timing, concentration, and fixed-fraction equity", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
    pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
    pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);

    const stress = buildBtcusdtEdgeZoneStressReport(oneMinute, {
      strategyId: "inside-bar-expansion-retest-long",
      zoneId: "volumeRank:high",
      entryMode: "limit-signal-close",
      targetR: 1,
      maxHoldFiveMinuteBars: 1,
      initialEquity: 10_000,
      riskPct: 0.01,
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

    expect(stress.trades).toBe(1);
    expect(stress.submittedOrders).toBe(1);
    expect(stress.tradeLog[0]).toMatchObject({
      pnlR: 1,
      exitReason: "target",
      cumulativePnlR: 1,
      equity: 10_100,
    });
    expect(stress.finalEquity).toBe(10_100);
    expect(stress.topProfitTradeShare).toBe(1);
    expect(stress.topProfitDayShare).toBe(1);
    expect(stress.longestLossStreak).toBe(0);
  });

  it("walks a selected edge-zone candidate forward by fold instead of only by strategy id", () => {
    const oneMinute: Candle[] = [];
    for (const offset of [0, 10]) {
      for (let group = offset; group < offset + 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
    }

    const walkForward = buildBtcusdtEdgeZoneWalkForwardReport(oneMinute, {
      strategyId: "inside-bar-expansion-retest-long",
      zoneId: "volumeRank:high",
      entryMode: "limit-signal-close",
      targetR: 1,
      maxHoldFiveMinuteBars: 1,
      foldFiveMinuteBars: 10,
      minTradesPerFold: 1,
      minPositiveFoldRate: 1,
      minEligibleFolds: 2,
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

    expect(walkForward.folds).toHaveLength(2);
    expect(walkForward).toMatchObject({
      totalTrades: 2,
      eligibleFolds: 2,
      positiveFolds: 2,
      positiveFoldRate: 1,
      accepted: true,
    });
  });

  it("summarizes edge-zone fragility after removing top winners and splitting the trade path", () => {
    const oneMinute: Candle[] = [];
    for (const offset of [0, 288]) {
      for (let group = offset; group < offset + 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
    }

    const fragility = buildBtcusdtEdgeZoneFragilityReport(oneMinute, {
      strategyId: "inside-bar-expansion-retest-long",
      zoneId: "volumeRank:high",
      entryMode: "limit-signal-close",
      targetR: 1,
      maxHoldFiveMinuteBars: 1,
      initialEquity: 10_000,
      riskPct: 0.01,
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

    expect(fragility.baseline).toMatchObject({
      trades: 2,
      winRate: 1,
      expectancyR: 1,
      profitFactor: Number.POSITIVE_INFINITY,
    });
    expect(fragility.withoutBestTrade).toMatchObject({
      trades: 1,
      expectancyR: 1,
    });
    expect(fragility.withoutBestDay).toMatchObject({
      trades: 1,
      expectancyR: 1,
    });
    expect(fragility.firstHalf.expectancyR).toBe(1);
    expect(fragility.secondHalf.expectancyR).toBe(1);
    expect(fragility.positiveHalves).toBe(2);
    expect(fragility.robust).toBe(true);
  });

  it("combines selected edge-zone candidates into a portfolio replay with same-minute overlap accounting", () => {
    const oneMinute: Candle[] = [];
    for (const offset of [0, 288]) {
      for (let group = offset; group < offset + 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
    }

    const portfolio = buildBtcusdtEdgeZonePortfolioReport(oneMinute, {
      initialEquity: 10_000,
      riskPct: 0.01,
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
      candidates: [
        {
          label: "inside-volume",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
        {
          label: "inside-upper-close",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "closePosition:upper",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
      ],
    });

    expect(portfolio.candidates).toHaveLength(2);
    expect(portfolio.trades).toBe(4);
    expect(portfolio.entryGroups).toBe(2);
    expect(portfolio.sameMinuteEntryGroups).toBe(2);
    expect(portfolio.maxSameMinuteTrades).toBe(2);
    expect(portfolio.expectancyR).toBe(1);
    expect(portfolio.finalEquity).toBeCloseTo(10_404, 6);
    expect(portfolio.overlapShare).toBe(1);
  });

  it("stress-tests a selected portfolio across risk sizes, months, and top-profit-day removals", () => {
    const oneMinute: Candle[] = [];
    for (const offset of [0, 288]) {
      for (let group = offset; group < offset + 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
    }

    const robustness = buildBtcusdtEdgeZonePortfolioRobustnessReport(oneMinute, {
      initialEquity: 10_000,
      riskPct: 0.01,
      riskPctValues: [0.005, 0.01],
      topProfitDayCounts: [1],
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
      candidates: [
        {
          label: "inside-volume",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
        {
          label: "inside-upper-close",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "closePosition:upper",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
      ],
    });

    expect(robustness.baseline).toMatchObject({
      trades: 4,
      entryGroups: 2,
      totalPnlR: 4,
    });
    expect(robustness.riskScenarios).toEqual([
      expect.objectContaining({ riskPct: 0.005, finalEquity: 10_201 }),
      expect.objectContaining({ riskPct: 0.01, finalEquity: 10_404 }),
    ]);
    expect(robustness.monthlyRows[0]).toMatchObject({
      entryGroups: 2,
      trades: 4,
      totalPnlR: 4,
    });
    expect(robustness.withoutTopProfitDays[0]).toMatchObject({
      removedDays: 1,
      remainingEntryGroups: 1,
      remainingTrades: 2,
      totalPnlR: 2,
    });
  });

  it("rolls a selected portfolio through fixed day windows to catch local breakdowns", () => {
    const oneMinute: Candle[] = [];
    for (const offset of [0, 288]) {
      for (let group = offset; group < offset + 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
    }

    const rolling = buildBtcusdtEdgeZonePortfolioRollingReport(oneMinute, {
      windowDays: 1,
      stepDays: 1,
      minEntryGroups: 1,
      initialEquity: 10_000,
      riskPct: 0.01,
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
      candidates: [
        {
          label: "inside-volume",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
      ],
    });

    expect(rolling.windows).toHaveLength(2);
    expect(rolling).toMatchObject({
      eligibleWindows: 2,
      positiveWindows: 2,
      positiveWindowRate: 1,
      worstExpectancyR: 1,
      medianExpectancyR: 1,
      accepted: true,
    });
  });

  it("sweeps portfolio execution assumptions by entry wait and passive fill buffer", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
    pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
    pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);

    const sweep = buildBtcusdtEdgeZonePortfolioExecutionSweepReport(oneMinute, {
      entryWaitBarsValues: [1, 3],
      entryFillBufferTicksValues: [0, 50],
      initialEquity: 10_000,
      riskPct: 0.01,
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
      candidates: [
        {
          label: "inside-volume",
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high",
          entryMode: "limit-signal-close",
          targetR: 1,
          maxHoldFiveMinuteBars: 1,
        },
      ],
    });

    expect(sweep.rows).toHaveLength(4);
    expect(sweep.rows.find((row) => row.entryFillBufferTicks === 0 && row.entryWaitBars === 1)).toMatchObject({
      trades: 1,
      expectancyR: 1,
    });
    expect(sweep.rows.find((row) => row.entryFillBufferTicks === 50 && row.entryWaitBars === 1)).toMatchObject({
      trades: 0,
      fillRate: 0,
    });
  });

  it("detects stair-step continuation from the five one-minute candles inside a five-minute signal candle", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100 + group, 101 + group, 99.8 + group, 100.2 + group, 20);
    }

    const patternStart = 6 * 5 * 60_000;
    oneMinute.push(candle(patternStart, 106, 107.2, 105.8, 107, 40));
    oneMinute.push(candle(patternStart + 60_000, 107, 108.2, 106.8, 108, 40));
    oneMinute.push(candle(patternStart + 120_000, 108, 109.2, 107.8, 109, 40));
    oneMinute.push(candle(patternStart + 180_000, 109, 110.2, 108.8, 110, 40));
    oneMinute.push(candle(patternStart + 240_000, 110, 111.2, 109.8, 111, 40));
    pushFiveMinuteCandle(oneMinute, 7, 111.4, 114, 111, 113, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("intrabar-stair-step-continuation-long:"))).toBe(true);
  });

  it("detects post-body force tilt when a large body candle fails to continue", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 111, 99, 110, 220);
    pushFiveMinuteCandle(oneMinute, 7, 110, 111, 105, 105.4, 180);
    pushFiveMinuteCandle(oneMinute, 8, 105.4, 106, 100, 101, 120);
    pushFiveMinuteCandle(oneMinute, 9, 101, 103, 95, 96, 80);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
      entryModes: ["limit-signal-close"],
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("post-body-exhaustion-reversal-short:"))).toBe(true);
  });

  it("detects two-candle absorption after a large body candle loses directional force", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 111, 99, 110, 220);
    pushFiveMinuteCandle(oneMinute, 7, 110, 110.8, 104, 106, 170);
    pushFiveMinuteCandle(oneMinute, 8, 106, 109, 101, 102, 160);
    pushFiveMinuteCandle(oneMinute, 9, 102, 103, 95, 96, 90);
    pushFiveMinuteCandle(oneMinute, 10, 96, 98, 92, 93, 80);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
      entryModes: ["limit-signal-close"],
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("post-body-two-candle-absorption-short:"))).toBe(true);
  });

  it("detects inside-bar expansion retest after a contained candle breaks", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
    pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 60);
    pushFiveMinuteCandle(oneMinute, 9, 107, 109, 104, 108, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("inside-bar-expansion-retest-long:"))).toBe(true);
  });

  it("detects pressure shelf break after rising lows compress into a flat high", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 105, 100, 104, 30);
    pushFiveMinuteCandle(oneMinute, 7, 104, 105.2, 101, 104.2, 30);
    pushFiveMinuteCandle(oneMinute, 8, 104.2, 105.1, 102, 104.8, 30);
    pushFiveMinuteCandle(oneMinute, 9, 105, 109, 104.5, 108, 60);
    pushFiveMinuteCandle(oneMinute, 10, 108, 110, 106, 109, 40);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("pressure-shelf-break-long:"))).toBe(true);
  });

  it("detects wick-stack absorption when repeated lower wicks hold the same area", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 102, 96, 101, 60);
    pushFiveMinuteCandle(oneMinute, 7, 101, 103, 96.2, 102, 60);
    pushFiveMinuteCandle(oneMinute, 8, 102, 104, 96.4, 103, 60);
    pushFiveMinuteCandle(oneMinute, 9, 103.2, 106, 101, 105, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("wick-stack-absorption-long:"))).toBe(true);
  });

  it("detects intrabar early climax hold from the one-minute path inside a five-minute candle", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    const patternStart = 6 * 5 * 60_000;
    oneMinute.push(candle(patternStart, 100, 101, 95, 96, 100));
    oneMinute.push(candle(patternStart + 60_000, 96, 98, 95.5, 97, 40));
    oneMinute.push(candle(patternStart + 120_000, 97, 99, 96.5, 98, 35));
    oneMinute.push(candle(patternStart + 180_000, 98, 101, 97.8, 100, 30));
    oneMinute.push(candle(patternStart + 240_000, 100, 103, 99.5, 102, 35));
    pushFiveMinuteCandle(oneMinute, 7, 102.2, 105, 100, 104, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("intrabar-early-climax-late-hold-long:"))).toBe(true);
  });

  it("detects a low-volume breakout trap when a weak break closes back inside", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100.2, 105, 100, 104, 6);
    pushFiveMinuteCandle(oneMinute, 7, 104, 104.5, 98, 99.8, 45);
    pushFiveMinuteCandle(oneMinute, 8, 99.8, 101, 96, 97, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("low-volume-breakout-trap-short:"))).toBe(true);
  });

  it("detects a micro double bottom neckline break using only recent candles", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 102, 95, 101, 40);
    pushFiveMinuteCandle(oneMinute, 7, 101, 104, 98, 103, 35);
    pushFiveMinuteCandle(oneMinute, 8, 103, 103.5, 95.2, 101, 40);
    pushFiveMinuteCandle(oneMinute, 9, 101, 106, 100.5, 105, 50);
    pushFiveMinuteCandle(oneMinute, 10, 105, 108, 103, 107, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("micro-double-neckline-break-long:"))).toBe(true);
  });

  it("detects a lower-volume retest of a prior high that fails to extend", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 110, 99, 108, 120);
    pushFiveMinuteCandle(oneMinute, 7, 108, 109, 104, 105, 40);
    pushFiveMinuteCandle(oneMinute, 8, 105, 107, 102, 104, 35);
    pushFiveMinuteCandle(oneMinute, 9, 104, 109.5, 103, 105, 55);
    pushFiveMinuteCandle(oneMinute, 10, 105, 106, 100, 101, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("volume-divergent-extreme-retest-short:"))).toBe(true);
  });

  it("detects outside-bar continuation after both sides are swept and the close holds beyond the prior range", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 102, 98, 100, 25);
    pushFiveMinuteCandle(oneMinute, 7, 100, 105, 97, 104, 70);
    pushFiveMinuteCandle(oneMinute, 8, 104, 106, 102, 105, 30);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("outside-bar-continuation-long:"))).toBe(true);
  });

  it("detects derivative exhaustion when close gains decelerate while volume fades", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 103, 99.8, 102.8, 120);
    pushFiveMinuteCandle(oneMinute, 7, 102.8, 105.2, 102.5, 104.8, 90);
    pushFiveMinuteCandle(oneMinute, 8, 104.8, 106.5, 104.5, 106, 65);
    pushFiveMinuteCandle(oneMinute, 9, 106, 107.2, 105.8, 106.6, 45);
    pushFiveMinuteCandle(oneMinute, 10, 106.6, 108.2, 103.5, 104, 70);
    pushFiveMinuteCandle(oneMinute, 11, 104, 105, 100, 101, 40);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("derivative-exhaustion-reversal-short:"))).toBe(true);
  });

  it("detects last-minute thrust failure from the one-minute derivative path", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    const patternStart = 6 * 5 * 60_000;
    oneMinute.push(candle(patternStart, 100, 100.6, 99.8, 100.3, 20));
    oneMinute.push(candle(patternStart + 60_000, 100.3, 100.8, 100.1, 100.5, 18));
    oneMinute.push(candle(patternStart + 120_000, 100.5, 100.9, 100.2, 100.6, 16));
    oneMinute.push(candle(patternStart + 180_000, 100.6, 101, 100.4, 100.7, 17));
    oneMinute.push(candle(patternStart + 240_000, 100.7, 104.8, 100.5, 100.9, 80));
    pushFiveMinuteCandle(oneMinute, 7, 100.9, 101.5, 96, 97, 50);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("intrabar-last-minute-thrust-failure-short:"))).toBe(true);
  });

  it("detects high-volume narrow-spread absorption after directional drift", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 104, 99.8, 103.5, 60);
    pushFiveMinuteCandle(oneMinute, 7, 103.5, 107, 103, 106.5, 65);
    pushFiveMinuteCandle(oneMinute, 8, 106.5, 109, 106, 108.4, 70);
    pushFiveMinuteCandle(oneMinute, 9, 108.4, 109.2, 107.9, 108.2, 180);
    pushFiveMinuteCandle(oneMinute, 10, 108.2, 108.8, 104, 105, 60);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("high-volume-narrow-spread-absorption-short:"))).toBe(true);
  });

  it("detects quiet-coil failed expansion after low-range low-volume compression", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 100.8, 99.7, 100.3, 8);
    pushFiveMinuteCandle(oneMinute, 7, 100.3, 101, 100, 100.6, 7);
    pushFiveMinuteCandle(oneMinute, 8, 100.6, 101.1, 100.2, 100.7, 7);
    pushFiveMinuteCandle(oneMinute, 9, 100.7, 101.2, 100.3, 100.8, 6);
    pushFiveMinuteCandle(oneMinute, 10, 100.8, 103.2, 100.5, 100.9, 28);
    pushFiveMinuteCandle(oneMinute, 11, 100.9, 101.2, 97, 98, 35);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("quiet-coil-failed-expansion-short:"))).toBe(true);
  });

  it("detects three-candle low-volume pullback continuation after a force bar", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 6; group += 1) {
      pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
    }
    pushFiveMinuteCandle(oneMinute, 6, 100, 109, 99.8, 108, 150);
    pushFiveMinuteCandle(oneMinute, 7, 108, 108.4, 105.5, 106.5, 70);
    pushFiveMinuteCandle(oneMinute, 8, 106.5, 107, 105, 105.8, 55);
    pushFiveMinuteCandle(oneMinute, 9, 105.8, 106.3, 104.8, 105.5, 42);
    pushFiveMinuteCandle(oneMinute, 10, 105.5, 110.5, 105.3, 109.8, 90);
    pushFiveMinuteCandle(oneMinute, 11, 109.8, 113, 109, 112, 65);

    const report = buildBtcusdtResearchReport(oneMinute, {
      minTrades: 1,
      feeRate: 0,
      tickSize: 0.1,
      adverseTicks: 0,
      kellyFraction: 0.25,
      riskCapPct: 0.005,
      minRiskPct: 0,
    });

    expect(report.strategies.some((strategy) => strategy.id.startsWith("three-candle-low-volume-pullback-continuation-long:"))).toBe(true);
  });

  it("exposes a BTCUSDT research CLI command that can run from a local Binance kline file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdt-research-"));
    try {
      const oneMinute: Candle[] = [];
      for (let i = 0; i < 180; i += 1) {
        const base = 100 + i * 0.05;
        const range = i % 15 >= 10 ? 2 : 0.4;
        const volume = i % 15 >= 10 ? 100 : 10;
        oneMinute.push(candle(i * 60_000, base, base + range, base - 0.2, base + range * 0.8, volume));
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdt",
        "--file",
        filePath,
        "--min-trades",
        "1",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        symbol: "BTCUSDT",
        exchange: "Binance",
        sourceInterval: "1m",
        signalInterval: "5m",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes BTCUSDC maker-limit replay through the CLI without changing existing BTCUSDT defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-research-"));
    try {
      const oneMinute: Candle[] = [];
      for (let i = 0; i < 180; i += 1) {
        const base = 100 + i * 0.05;
        const range = i % 15 >= 10 ? 2 : 0.4;
        const volume = i % 15 >= 10 ? 100 : 10;
        oneMinute.push(candle(i * 60_000, base, base + range, base - 0.2, base + range * 0.8, volume));
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--min-trades",
        "1",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        symbol: "BTCUSDC",
        exchange: "Binance",
        market: "USD-M perpetual futures",
        sourceInterval: "1m",
        signalInterval: "5m",
        config: {
          feeRate: 0,
          adverseTicks: 0,
          entryWaitBars: 3,
          entryModes: ["limit-signal-close", "limit-quarter-pullback", "limit-half-pullback"],
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes BTCUSDC strategyless OHLCV scan through the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-strategyless-"));
    try {
      const oneMinute: Candle[] = [];
      for (let group = 0; group < 60; group += 1) {
        const base = 100 + group * 0.05;
        if (group % 8 === 6) {
          pushFiveMinuteCandle(oneMinute, group, base, base + 6, base - 0.4, base + 5.2, 240);
        } else if (group % 8 === 7) {
          pushFiveMinuteCandle(oneMinute, group, base + 5.2, base + 5.4, base + 1.5, base + 4.9, 90);
        } else {
          pushFiveMinuteCandle(oneMinute, group, base, base + 0.35, base - 0.35, base + 0.05, 20);
        }
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--strategyless-ohlcv",
        "--min-trades",
        "1",
        "--target-rs",
        "1",
        "--hold-minutes",
        "5,360",
        "--max-raw-buckets",
        "24",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        symbol: "BTCUSDC",
        displaySymbol: "BTCUSDC.P",
        market: "USD-M perpetual futures",
        sourceInterval: "1m",
        contextInterval: "5m",
        holdMinutes: [5, 360],
      });
      expect((result.data as { candidates: unknown[] }).candidates.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes a selected edge-zone stress report through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-stress-"));
    try {
      const oneMinute: Candle[] = [];
      for (let group = 0; group < 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--stress-zone",
        "--strategy-id",
        "inside-bar-expansion-retest-long",
        "--zone-id",
        "volumeRank:high",
        "--entry-mode",
        "limit-signal-close",
        "--target-r",
        "1",
        "--max-hold-5m-bars",
        "1",
        "--risk-pct",
        "0.01",
        "--initial-equity",
        "10000",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        strategyId: "inside-bar-expansion-retest-long",
        zoneId: "volumeRank:high",
        trades: 1,
        finalEquity: 10_100,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes a selected edge-zone fragility report through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-fragility-"));
    try {
      const oneMinute: Candle[] = [];
      for (const offset of [0, 288]) {
        for (let group = offset; group < offset + 6; group += 1) {
          pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
        }
        pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
        pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
        pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
        pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--fragility-zone",
        "--strategy-id",
        "inside-bar-expansion-retest-long",
        "--zone-id",
        "volumeRank:high",
        "--entry-mode",
        "limit-signal-close",
        "--target-r",
        "1",
        "--max-hold-5m-bars",
        "1",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        strategyId: "inside-bar-expansion-retest-long",
        zoneId: "volumeRank:high",
        robust: true,
        baseline: {
          trades: 2,
          expectancyR: 1,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes an edge-zone portfolio report through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-portfolio-"));
    try {
      const oneMinute: Candle[] = [];
      for (const offset of [0, 288]) {
        for (let group = offset; group < offset + 6; group += 1) {
          pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
        }
        pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
        pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
        pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
        pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--portfolio-candidates",
        [
          "inside-volume|inside-bar-expansion-retest-long|volumeRank:high|limit-signal-close|1|1",
          "inside-upper|inside-bar-expansion-retest-long|closePosition:upper|limit-signal-close|1|1",
        ].join(";"),
        "--risk-pct",
        "0.01",
        "--initial-equity",
        "10000",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        trades: 4,
        entryGroups: 2,
        sameMinuteEntryGroups: 2,
        maxSameMinuteTrades: 2,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes an edge-zone portfolio robustness report through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-portfolio-robustness-"));
    try {
      const oneMinute: Candle[] = [];
      for (const offset of [0, 288]) {
        for (let group = offset; group < offset + 6; group += 1) {
          pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
        }
        pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
        pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
        pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
        pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--portfolio-robustness",
        "--portfolio-candidates",
        [
          "inside-volume|inside-bar-expansion-retest-long|volumeRank:high|limit-signal-close|1|1",
          "inside-upper|inside-bar-expansion-retest-long|closePosition:upper|limit-signal-close|1|1",
        ].join(";"),
        "--risk-pct-values",
        "0.005,0.01",
        "--top-profit-day-counts",
        "1",
        "--initial-equity",
        "10000",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        baseline: {
          trades: 4,
          entryGroups: 2,
          totalPnlR: 4,
        },
        riskScenarios: [
          expect.objectContaining({ riskPct: 0.005, finalEquity: 10_201 }),
          expect.objectContaining({ riskPct: 0.01, finalEquity: 10_404 }),
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes an edge-zone portfolio rolling report through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-portfolio-rolling-"));
    try {
      const oneMinute: Candle[] = [];
      for (const offset of [0, 288]) {
        for (let group = offset; group < offset + 6; group += 1) {
          pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
        }
        pushFiveMinuteCandle(oneMinute, offset + 6, 100, 106, 96, 101, 40);
        pushFiveMinuteCandle(oneMinute, offset + 7, 101, 102.5, 99, 102, 18);
        pushFiveMinuteCandle(oneMinute, offset + 8, 102, 108, 101.5, 107, 80);
        pushFiveMinuteCandle(oneMinute, offset + 9, 107, 116, 106, 115, 40);
      }
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--portfolio-rolling",
        "--portfolio-candidates",
        "inside-volume|inside-bar-expansion-retest-long|volumeRank:high|limit-signal-close|1|1",
        "--rolling-window-days",
        "1",
        "--rolling-step-days",
        "1",
        "--min-entry-groups",
        "1",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        eligibleWindows: 2,
        positiveWindows: 2,
        accepted: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes an edge-zone portfolio execution sweep through the research CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-portfolio-execution-"));
    try {
      const oneMinute: Candle[] = [];
      for (let group = 0; group < 6; group += 1) {
        pushFiveMinuteCandle(oneMinute, group, 100, 101, 99.5, 100.2, 20);
      }
      pushFiveMinuteCandle(oneMinute, 6, 100, 106, 96, 101, 40);
      pushFiveMinuteCandle(oneMinute, 7, 101, 102.5, 99, 102, 18);
      pushFiveMinuteCandle(oneMinute, 8, 102, 108, 101.5, 107, 80);
      pushFiveMinuteCandle(oneMinute, 9, 107, 116, 106, 115, 40);
      const filePath = join(dir, "klines.json");
      writeFileSync(filePath, JSON.stringify(oneMinute.map(klineFromCandle)));

      const result = await runPhase1Command([
        "trading:research-btcusdc",
        "--file",
        filePath,
        "--maker-limit",
        "--portfolio-execution-sweep",
        "--portfolio-candidates",
        "inside-volume|inside-bar-expansion-retest-long|volumeRank:high|limit-signal-close|1|1",
        "--entry-wait-bars-values",
        "1,3",
        "--entry-fill-buffer-ticks-values",
        "0,50",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        rows: expect.arrayContaining([
          expect.objectContaining({ entryWaitBars: 1, entryFillBufferTicks: 0, trades: 1 }),
          expect.objectContaining({ entryWaitBars: 1, entryFillBufferTicks: 50, trades: 0 }),
        ]),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds walk-forward fold summaries so single-period edges cannot pass alone", () => {
    const oneMinute: Candle[] = [];
    for (let i = 0; i < 1_200; i += 1) {
      const cycle = Math.floor(i / 5) % 8;
      const base = 100 + i * 0.01;
      const range = cycle === 0 || cycle === 1 ? 2 : 0.5;
      const volume = cycle === 0 ? 120 : 20;
      const close = cycle === 0 ? base + range * 0.9 : base + range * 0.2;
      oneMinute.push(candle(i * 60_000, base, base + range, base - 0.2, close, volume));
    }

    const walkForward = buildBtcusdtWalkForwardReport(oneMinute, {
      foldFiveMinuteBars: 60,
      minTrades: 1,
      minPositiveFoldRate: 0.5,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0.0005,
      },
    });

    expect(walkForward.folds.length).toBeGreaterThan(1);
    expect(walkForward.strategies[0]).toHaveProperty("positiveFoldRate");
    expect(walkForward.strategies.every((strategy) => strategy.eligibleFolds <= walkForward.folds.length)).toBe(true);
  });

  it("rejects walk-forward candidates that only appear in one eligible fold", () => {
    const oneMinute: Candle[] = [];
    for (let group = 0; group < 16; group += 1) {
      if (group < 6) {
        pushFiveMinuteCandle(oneMinute, group, 100, 100.4, 99.9, 100.1, 20);
      } else if (group === 6) {
        pushFiveMinuteCandle(oneMinute, group, 100, 106, 99.8, 105.5, 150);
      } else if (group === 7) {
        pushFiveMinuteCandle(oneMinute, group, 106, 113, 105.8, 112, 80);
      } else {
        pushFiveMinuteCandle(oneMinute, group, 100, 100.4, 99.9, 100.1, 20);
      }
    }

    const walkForward = buildBtcusdtWalkForwardReport(oneMinute, {
      foldFiveMinuteBars: 8,
      minTrades: 1,
      minPositiveFoldRate: 0.5,
      minEligibleFolds: 2,
      config: {
        minTrades: 1,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
      },
    });

    const oneFoldCandidate = walkForward.strategies.find((strategy) => strategy.eligibleFolds === 1);
    expect(oneFoldCandidate).toBeDefined();
    expect(oneFoldCandidate?.accepted).toBe(false);
  });

  it("runs a risk-width sweep to show whether an edge survives realistic stops", () => {
    const oneMinute: Candle[] = [];
    for (let i = 0; i < 600; i += 1) {
      const base = 100 + i * 0.02;
      const range = Math.floor(i / 5) % 4 === 0 ? 2 : 0.4;
      const volume = Math.floor(i / 5) % 4 === 0 ? 100 : 10;
      oneMinute.push(candle(i * 60_000, base, base + range, base - 0.1, base + range * 0.8, volume));
    }

    const sweep = buildBtcusdtResearchSweep(oneMinute, {
      minRiskPctValues: [0, 0.001, 0.002],
      feeRateValues: [0, 0.0004],
      baseConfig: {
        minTrades: 3,
        feeRate: 0,
        tickSize: 0.1,
        adverseTicks: 0,
        kellyFraction: 0.25,
        riskCapPct: 0.005,
        minRiskPct: 0,
      },
    });

    expect(sweep.runs).toHaveLength(6);
    expect(sweep.runs[0]).toHaveProperty("acceptedCount");
    expect(sweep.runs[0]).toHaveProperty("topStrategyId");
  });
});
