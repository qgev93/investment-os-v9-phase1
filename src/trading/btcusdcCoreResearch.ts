import { BTCUSDC_CORE3_CANDIDATES, BTCUSDC_PAPER_DEFAULT_CONFIG } from "./btcusdcPaperTrading.js";
import {
  buildBtcusdtEdgeZoneFragilityReport,
  buildBtcusdtEdgeZonePortfolioReport,
  buildBtcusdtEdgeZoneStressReport,
  buildBtcusdtEdgeZoneWalkForwardReport,
  type Candle,
  type EdgeZonePortfolioCandidate,
  type ResearchConfig,
} from "./btcusdtResearch.js";
import {
  evaluateBtcusdcCoreTestGate,
  type BtcusdcCoreGateEvaluation,
  type BtcusdcCoreTestResult,
} from "./btcusdcStrategyRegistry.js";

export interface BtcusdcCoreCandidateResearchRow {
  label: string;
  candidate: EdgeZonePortfolioCandidate;
  coreTest: BtcusdcCoreTestResult;
  gate: BtcusdcCoreGateEvaluation;
}

export interface BtcusdcCoreResearchReport {
  symbol: string;
  displaySymbol: string;
  exchange: "Binance";
  sourceInterval: "1m";
  lookbackDays: number;
  candles: number;
  portfolio: {
    candidates: number;
    filledTrades: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdownR: number;
    overlapShare: number;
  };
  candidates: BtcusdcCoreCandidateResearchRow[];
}

export interface BtcusdcCoreResearchOptions {
  symbol?: string;
  displaySymbol?: string;
  candidates?: EdgeZonePortfolioCandidate[];
  config?: Partial<ResearchConfig>;
  initialEquity?: number;
  riskPct?: number;
  foldDays?: number;
}

function lookbackDays(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  return (candles[candles.length - 1].openTime - candles[0].openTime + 60_000) / 86_400_000;
}

function latestWindow(candles: Candle[], days: number): Candle[] {
  const last = candles.at(-1);
  if (!last) return [];
  const minOpenTime = last.openTime - days * 86_400_000;
  return candles.filter((candle) => candle.openTime >= minOpenTime);
}

function totalR(pnlRs: number[]): number {
  return pnlRs.reduce((sum, value) => sum + value, 0);
}

export function buildBtcusdcSixMonthCoreResearchReport(
  candles: Candle[],
  options: BtcusdcCoreResearchOptions = {},
): BtcusdcCoreResearchReport {
  const candidates = options.candidates ?? BTCUSDC_CORE3_CANDIDATES;
  const config = { ...BTCUSDC_PAPER_DEFAULT_CONFIG, ...(options.config ?? {}) };
  const initialEquity = options.initialEquity ?? 1_000;
  const riskPct = options.riskPct ?? config.riskCapPct;
  const foldFiveMinuteBars = Math.max(1, Math.floor((options.foldDays ?? 14) * 24 * 12));
  const sampleLookbackDays = lookbackDays(candles);
  const portfolio = buildBtcusdtEdgeZonePortfolioReport(candles, {
    candidates,
    config,
    initialEquity,
    riskPct,
  });

  const rows = candidates.map((candidate): BtcusdcCoreCandidateResearchRow => {
    const stress = buildBtcusdtEdgeZoneStressReport(candles, {
      ...candidate,
      config,
      initialEquity,
      riskPct,
    });
    const fragility = buildBtcusdtEdgeZoneFragilityReport(candles, {
      ...candidate,
      config,
      initialEquity,
      riskPct,
    });
    const walkForward = buildBtcusdtEdgeZoneWalkForwardReport(candles, {
      ...candidate,
      config,
      foldFiveMinuteBars,
      minPositiveFoldRate: 0.7,
      minEligibleFolds: 1,
      minTradesPerFold: 1,
      minWorstFoldExpectancyR: -0.15,
      initialEquity,
      riskPct,
    });
    const recent30 = buildBtcusdtEdgeZoneStressReport(latestWindow(candles, 30), {
      ...candidate,
      config,
      initialEquity,
      riskPct,
    });
    const recent90 = buildBtcusdtEdgeZoneStressReport(latestWindow(candles, 90), {
      ...candidate,
      config,
      initialEquity,
      riskPct,
    });
    const pnlR = stress.tradeLog.map((trade) => trade.pnlR);
    const candidateTotalR = totalR(pnlR);
    const totalRToMaxDrawdown =
      stress.maxDrawdownR > 0 ? candidateTotalR / stress.maxDrawdownR : candidateTotalR > 0 ? Number.POSITIVE_INFINITY : 0;
    const coreTestBase: BtcusdcCoreTestResult = {
      lookbackDays: sampleLookbackDays,
      filledTrades: stress.trades,
      submittedOrders: stress.submittedOrders,
      fillRate: stress.fillRate,
      expectancyR: stress.expectancyR,
      profitFactor: stress.profitFactor,
      fullKelly: stress.fullKelly,
      totalR: candidateTotalR,
      maxDrawdownR: stress.maxDrawdownR,
      totalRToMaxDrawdown,
      positiveFoldRate: walkForward.positiveFoldRate,
      worstFoldExpectancyR: walkForward.worstFoldExpectancyR,
      recent30ExpectancyR: recent30.expectancyR,
      recent90ExpectancyR: recent90.expectancyR,
      bestDayRemovedProfitFactor: fragility.withoutBestDay.profitFactor,
      bestFivePctRemovedExpectancyR: fragility.withoutBestFivePercentWinners.expectancyR,
      evaluatedAt: new Date().toISOString(),
      source: "six-month-ohclv-replay",
    };
    const gate = evaluateBtcusdcCoreTestGate(coreTestBase);

    return {
      label: candidate.label ?? candidate.strategyId,
      candidate,
      coreTest: { ...coreTestBase, passed: gate.passed },
      gate,
    };
  });

  return {
    symbol: options.symbol ?? "BTCUSDC",
    displaySymbol: options.displaySymbol ?? "BTCUSDC.P",
    exchange: "Binance",
    sourceInterval: "1m",
    lookbackDays: sampleLookbackDays,
    candles: candles.length,
    portfolio: {
      candidates: candidates.length,
      filledTrades: portfolio.trades,
      expectancyR: portfolio.expectancyR,
      profitFactor: portfolio.profitFactor,
      maxDrawdownR: portfolio.maxDrawdownR,
      overlapShare: portfolio.overlapShare,
    },
    candidates: rows,
  };
}
