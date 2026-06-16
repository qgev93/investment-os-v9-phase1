import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBinanceFuturesKlineStreamUrl,
  mergeRealtimeClosedCandle,
  parseBinanceFuturesClosedKline,
  processBtcusdcRealtimeClosedCandle,
} from "../src/trading/btcusdcRealtimeWorker.js";
import { createInitialBtcusdcPaperTradingState, saveBtcusdcPaperTradingState } from "../src/trading/btcusdcPaperTrading.js";
import type { Candle } from "../src/trading/btcusdtResearch.js";

function candle(openTime: number, open: number, high: number, low: number, close: number, volume = 10): Candle {
  return { openTime, open, high, low, close, volume, closeTime: openTime + 59_999 };
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

function buildMicroSqueezeBreakShortCandles(): Candle[] {
  const oneMinute: Candle[] = [];
  for (let i = 0; i < 100; i += 1) {
    const base = 100 + (i % 2 === 0 ? 0.03 : -0.03);
    oneMinute.push(candle(i * 60_000, base, base + 0.3, base - 0.3, 100, 10));
  }
  for (let i = 100; i < 109; i += 1) {
    oneMinute.push(candle(i * 60_000, 100, 100.1, 99.9, 100, 6));
  }
  oneMinute[109] = candle(109 * 60_000, 100, 100.2, 98.8, 99.0, 30);
  oneMinute.push(candle(110 * 60_000, 99.0, 100.0, 99.0, 99.4, 12));
  oneMinute.push(candle(111 * 60_000, 99.4, 99.5, 98.0, 98.3, 20));
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

describe("BTCUSDC.P realtime paper worker", () => {
  it("builds the Binance USD-M Futures market kline websocket URL", () => {
    expect(buildBinanceFuturesKlineStreamUrl("BTCUSDC", "1m")).toBe(
      "wss://fstream.binance.com/market/ws/btcusdc@kline_1m",
    );
  });

  it("parses only closed 1m Binance futures kline payloads into candles", () => {
    const openPayload = {
      e: "kline",
      s: "BTCUSDC",
      k: { t: 60_000, T: 119_999, s: "BTCUSDC", i: "1m", o: "100", h: "101", l: "99", c: "100.5", v: "42", x: false },
    };
    const closedPayload = {
      e: "kline",
      s: "BTCUSDC",
      k: { t: 60_000, T: 119_999, s: "BTCUSDC", i: "1m", o: "100", h: "101", l: "99", c: "100.5", v: "42", x: true },
    };

    expect(parseBinanceFuturesClosedKline(openPayload)).toBeNull();
    expect(parseBinanceFuturesClosedKline(closedPayload)).toEqual({
      openTime: 60_000,
      closeTime: 119_999,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 42,
    });
  });

  it("dedupes closed realtime candles and keeps a bounded sorted history", () => {
    const merged = mergeRealtimeClosedCandle(
      [candle(0, 100, 101, 99, 100), candle(60_000, 100, 102, 98, 101)],
      candle(60_000, 101, 103, 100, 102),
      2,
    );
    const appended = mergeRealtimeClosedCandle(merged, candle(120_000, 102, 104, 101, 103), 2);

    expect(merged).toEqual([candle(0, 100, 101, 99, 100), candle(60_000, 101, 103, 100, 102)]);
    expect(appended.map((item) => item.openTime)).toEqual([60_000, 120_000]);
  });

  it("processes a closed realtime candle through paper state and appends review logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-realtime-"));
    try {
      const candles = buildInsideVolumeWinCandles();
      const candlesPath = join(dir, "candles.json");
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      writeFileSync(candlesPath, JSON.stringify(candles.slice(0, -1), null, 2));
      saveBtcusdcPaperTradingState(
        statePath,
        createInitialBtcusdcPaperTradingState({
          activationOpenTime: 0,
          initialEquity: 10_000,
          riskPct: 0.01,
          nowIso: "2026-06-15T00:00:00.000Z",
        }),
      );

      const result = processBtcusdcRealtimeClosedCandle(candles.at(-1)!, {
        candlesPath,
        statePath,
        logPath,
        candidates: TEST_CANDIDATES,
        initialEquity: 10_000,
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

      expect(result).toMatchObject({
        acceptedCandle: true,
        candles: 50,
        events: 3,
        closedTrades: 1,
        equity: 10_100,
      });
      expect(JSON.parse(readFileSync(candlesPath, "utf8"))).toHaveLength(50);
      const logged = readFileSync(logPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(logged.map((event) => event.type)).toEqual(["order_submitted", "order_filled", "trade_closed"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks the default one-sided micro shadow candidate in the realtime paper path", () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-realtime-micro-"));
    try {
      const candles = buildMicroSqueezeBreakShortCandles();
      const candlesPath = join(dir, "candles.json");
      const statePath = join(dir, "state.json");
      const logPath = join(dir, "events.jsonl");
      writeFileSync(candlesPath, JSON.stringify(candles.slice(0, -1), null, 2));
      saveBtcusdcPaperTradingState(
        statePath,
        createInitialBtcusdcPaperTradingState({
          activationOpenTime: 0,
          initialEquity: 10_000,
          riskPct: 0.01,
          nowIso: "2026-06-15T00:00:00.000Z",
        }),
      );

      const result = processBtcusdcRealtimeClosedCandle(candles.at(-1)!, {
        candlesPath,
        statePath,
        logPath,
        initialEquity: 10_000,
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

      expect(result).toMatchObject({
        acceptedCandle: true,
        events: 0,
        closedTrades: 0,
        equity: 10_000,
      });
      expect(result.telegramEventRows).toEqual([]);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
