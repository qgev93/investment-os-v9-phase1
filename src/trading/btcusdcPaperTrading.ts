import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildBtcusdtEdgeZoneStressReport,
  buildBtcusdtEdgeZonePortfolioOrders,
  buildBtcusdtMicroScalpPortfolioOrders,
  buildBtcusdtStrategylessOhlcvPortfolioOrders,
  type Candle,
  type EdgeZonePortfolioCandidate,
  type EdgeZonePortfolioOptions,
  type EdgeZonePortfolioOrder,
  type MicroScalpPortfolioCandidate,
  type ResearchConfig,
  type StrategylessOhlcvPortfolioCandidate,
  type TradeDirection,
  type TradeExitReason,
} from "./btcusdtResearch.js";

const KST_OFFSET_MINUTES = 9 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const BTCUSDC_CORE3_CANDIDATES: EdgeZonePortfolioCandidate[] = [
  {
    label: "baseline-early-climax-short",
    strategyId: "intrabar-early-climax-late-hold-short",
    zoneId: "rangeRank:high+volumeRank:high",
    entryMode: "limit-half-pullback",
    targetR: 3,
    maxHoldFiveMinuteBars: 9,
  },
  {
    label: "derivative-compression-short",
    strategyId: "intrabar-early-climax-late-hold-short",
    zoneId: "bodyRatio:small+rangeDerivative:compressing",
    entryMode: "limit-half-pullback",
    targetR: 4,
    maxHoldFiveMinuteBars: 9,
  },
  {
    label: "hvnsa-absorption-long",
    strategyId: "high-volume-narrow-spread-absorption-long",
    zoneId: "closeDerivative:down+effortResult:neutral",
    entryMode: "limit-signal-close",
    targetR: 4,
    maxHoldFiveMinuteBars: 9,
  },
];

export const BTCUSDC_MICRO_SHADOW_CANDIDATES: MicroScalpPortfolioCandidate[] = [
  {
    label: "micro-squeeze-break-short",
    strategyId: "micro-squeeze-break-q35-short",
    zoneId: "width:2+quietRangeRank:lte0.35",
    entryMode: "limit-half-pullback",
    targetR: 4,
    maxHoldBars: 5,
  },
];

export const BTCUSDC_STRATEGYLESS_SHADOW_CANDIDATES: StrategylessOhlcvPortfolioCandidate[] = [
  {
    label: "strategyless-bear-flat-short-4r",
    conditionId: "bodyDirection:bear+recentDrift:flat",
    direction: "short",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
  {
    label: "strategyless-no-reversal-flat-short-4r",
    conditionId: "intrabarReversal:none+recentDrift:flat",
    direction: "short",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
  {
    label: "strategyless-compression-long-4r",
    conditionId: "localRangeState:compressing",
    direction: "long",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
  {
    label: "strategyless-ls-no-reversal-compression-long-4r",
    conditionId: "intrabarReversal:none+rangeDerivative:compressing",
    direction: "long",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
  {
    label: "strategyless-ls-body-flat-drift-flat-short-4r",
    conditionId: "intrabarBodyMomentum:flat+recentDrift:flat",
    direction: "short",
    entryMode: "limit-half-pullback",
    targetR: 4,
    holdMinutes: 60,
  },
];

export const BTCUSDC_PAPER_DEFAULT_CONFIG: ResearchConfig = {
  minTrades: 20,
  feeRate: 0,
  tickSize: 0.1,
  adverseTicks: 0,
  kellyFraction: 0.25,
  riskCapPct: 0.005,
  minRiskPct: 0.00035,
  entryModes: ["limit-signal-close", "limit-half-pullback"],
  entryWaitBars: 3,
  entryFillBufferTicks: 2,
  minFillRate: 0.15,
};

export type BtcusdcPaperRiskSource = "fixed_override" | "historical_kelly" | "fallback_cap";

export interface BtcusdcPaperOrderRiskSnapshot {
  riskPct: number;
  riskAmount: number;
  riskSource: BtcusdcPaperRiskSource;
  dailySeedEquity: number;
  dailySeedDate: string;
  historicalTradesForKelly: number;
  historicalWinRateForKelly: number;
  historicalPayoffRatioForKelly: number;
}

export type BtcusdcPaperTradingEventType = "order_submitted" | "order_filled" | "order_missed" | "trade_closed";

export interface BtcusdcPaperTradingState {
  version: 1;
  mode: "paper_forward";
  exchange: "Binance";
  symbol: string;
  displaySymbol: string;
  createdAt: string;
  updatedAt: string;
  activationOpenTime: number;
  lastCandleOpenTime: number | null;
  initialEquity: number;
  equity: number;
  peakEquity: number;
  maxDrawdownPct: number;
  bettingMode: "kelly_daily_seed";
  dailySeedEquity: number;
  dailySeedDate: string;
  dailySeedTimezoneOffsetMinutes: number;
  riskPct: number;
  totalPnlR: number;
  closedTrades: number;
  wins: number;
  losses: number;
  knownOrderIds: string[];
  filledOrderIds: string[];
  missedOrderIds: string[];
  closedOrderIds: string[];
  openOrderRisks: Record<string, BtcusdcPaperOrderRiskSnapshot>;
}

export interface CreateBtcusdcPaperTradingStateOptions {
  nowIso?: string;
  candles?: Candle[];
  activationOpenTime?: number;
  initialEquity?: number;
  riskPct?: number;
  symbol?: string;
  displaySymbol?: string;
}

export interface BtcusdcPaperTradingEvent {
  eventId: string;
  type: BtcusdcPaperTradingEventType;
  recordedAt: string;
  exchange: "Binance";
  symbol: string;
  displaySymbol: string;
  orderId: string;
  candidateLabel: string;
  strategyId: string;
  zoneId: string;
  direction: TradeDirection;
  signalOpenTime: number;
  entryMode: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  fillOpenTime?: number;
  exitOpenTime?: number;
  exitReason?: TradeExitReason;
  barsHeld?: number;
  pnlR?: number;
  rawPnlR?: number;
  costR?: number;
  riskPct?: number;
  riskAmount?: number;
  riskSource?: BtcusdcPaperRiskSource;
  dailySeedEquity?: number;
  dailySeedDate?: string;
  historicalTradesForKelly?: number;
  historicalWinRateForKelly?: number;
  historicalPayoffRatioForKelly?: number;
  equity?: number;
  totalPnlR?: number;
}

export interface BtcusdcPaperTradingSummary {
  symbol: string;
  displaySymbol: string;
  events: number;
  submittedOrders: number;
  filledOrders: number;
  missedOrders: number;
  closedTrades: number;
  newClosedTrades: number;
  openOrders: number;
  totalPnlR: number;
  equity: number;
  maxDrawdownPct: number;
  riskPct: number;
  bettingMode: "kelly_daily_seed";
  dailySeedEquity: number;
  dailySeedDate: string;
  activationOpenTime: number;
  lastCandleOpenTime: number | null;
}

export interface AdvanceBtcusdcPaperTradingOptions extends EdgeZonePortfolioOptions {
  microCandidates?: MicroScalpPortfolioCandidate[];
  strategylessCandidates?: StrategylessOhlcvPortfolioCandidate[];
  nowIso?: string;
  symbol?: string;
  displaySymbol?: string;
  dailySeedTimezoneOffsetMinutes?: number;
  fallbackRiskPct?: number;
}

type PaperOrderEvaluation =
  | { status: "pending" }
  | { status: "missed" }
  | { status: "filled_open"; fillOpenTime: number }
  | {
      status: "closed";
      fillOpenTime: number;
      exitOpenTime: number;
      exitReason: TradeExitReason;
      barsHeld: number;
      pnlR: number;
      rawPnlR: number;
      costR: number;
    };

function sortedIds(ids: Set<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dayKeyFromOpenTime(openTime: number, offsetMinutes: number): string {
  return new Date(openTime + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function fallbackOpenTime(nowIso: string): number {
  const parsed = Date.parse(nowIso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function initialDailySeedDate(input: {
  lastCandleOpenTime: number | null;
  activationOpenTime?: number;
  nowIso: string;
  offsetMinutes: number;
}): string {
  const openTime = input.lastCandleOpenTime ?? input.activationOpenTime ?? fallbackOpenTime(input.nowIso);
  return dayKeyFromOpenTime(openTime, input.offsetMinutes);
}

function hydratePaperTradingState(
  state: BtcusdcPaperTradingState,
  options: { nowIso: string; initialEquity?: number; dailySeedTimezoneOffsetMinutes?: number },
): BtcusdcPaperTradingState {
  const timezoneOffset = state.dailySeedTimezoneOffsetMinutes ?? options.dailySeedTimezoneOffsetMinutes ?? KST_OFFSET_MINUTES;
  const pristine =
    options.initialEquity !== undefined &&
    state.closedTrades === 0 &&
    state.totalPnlR === 0 &&
    state.equity === state.initialEquity &&
    state.peakEquity === state.initialEquity &&
    state.initialEquity !== options.initialEquity;
  const targetInitialEquity = options.initialEquity ?? state.initialEquity;
  const initialEquity = pristine ? targetInitialEquity : state.initialEquity;
  const equity = pristine ? targetInitialEquity : state.equity;
  const peakEquity = pristine ? targetInitialEquity : state.peakEquity;
  const dailySeedDate =
    !pristine && state.dailySeedDate
      ? state.dailySeedDate
      : initialDailySeedDate({
          lastCandleOpenTime: state.lastCandleOpenTime,
          activationOpenTime: state.activationOpenTime,
          nowIso: options.nowIso,
          offsetMinutes: timezoneOffset,
        });

  return {
    ...state,
    initialEquity,
    equity,
    peakEquity,
    maxDrawdownPct: pristine ? 0 : state.maxDrawdownPct,
    bettingMode: "kelly_daily_seed",
    dailySeedEquity: !pristine && state.dailySeedEquity !== undefined ? state.dailySeedEquity : equity,
    dailySeedDate,
    dailySeedTimezoneOffsetMinutes: timezoneOffset,
    openOrderRisks: state.openOrderRisks ?? {},
  };
}

function rollDailySeedToOpenTime(state: BtcusdcPaperTradingState, openTime: number): void {
  const date = dayKeyFromOpenTime(openTime, state.dailySeedTimezoneOffsetMinutes);
  if (date === state.dailySeedDate) return;
  state.dailySeedDate = date;
  state.dailySeedEquity = state.equity;
}

function baseEvent(
  type: BtcusdcPaperTradingEventType,
  order: EdgeZonePortfolioOrder,
  state: BtcusdcPaperTradingState,
  recordedAt: string,
): BtcusdcPaperTradingEvent {
  return {
    eventId: `${type}:${order.orderId}`,
    type,
    recordedAt,
    exchange: "Binance",
    symbol: state.symbol,
    displaySymbol: state.displaySymbol,
    orderId: order.orderId,
    candidateLabel: order.candidateLabel,
    strategyId: order.strategyId,
    zoneId: order.zoneId,
    direction: order.direction,
    signalOpenTime: order.signalOpenTime,
    entryMode: order.entryMode,
    entryPrice: order.entryPrice,
    stopPrice: order.stopPrice,
    targetPrice: order.targetPrice,
    targetR: order.targetR,
    maxHoldFiveMinuteBars: order.maxHoldFiveMinuteBars,
  };
}

function evaluatePaperOrder(
  order: EdgeZonePortfolioOrder,
  oneMinuteCandles: Candle[],
  config: ResearchConfig,
): PaperOrderEvaluation {
  const bars = oneMinuteCandles.slice(order.entryStartIndex);
  if (bars.length === 0) return { status: "pending" };

  const entryWaitBars = order.entryMode === "next-open" ? 1 : Math.max(1, order.entryWaitBars);
  const entryFillBuffer = Math.max(0, order.entryFillBufferTicks) * config.tickSize;
  let fillIndex = -1;

  for (let index = 0; index < Math.min(entryWaitBars, bars.length); index += 1) {
    const current = bars[index];
    const filled =
      order.entryMode === "next-open"
        ? true
        : order.direction === "long"
          ? current.low <= order.entryPrice - entryFillBuffer
          : current.high >= order.entryPrice + entryFillBuffer;
    if (filled) {
      fillIndex = index;
      break;
    }
  }

  if (fillIndex === -1) {
    return bars.length >= entryWaitBars ? { status: "missed" } : { status: "pending" };
  }

  const risk = Math.abs(order.entryPrice - order.stopPrice);
  if (risk <= 0) return { status: "missed" };

  const adverseCost = config.adverseTicks * config.tickSize * 2;
  const feeCost = order.entryPrice * config.feeRate * 2;
  const costR = (adverseCost + feeCost) / risk;
  const replayBars = bars.slice(fillIndex, fillIndex + order.maxBars);
  const fillOpenTime = bars[fillIndex].openTime;
  if (replayBars[0] && order.entryMode !== "next-open") {
    replayBars[0] =
      order.direction === "long"
        ? { ...replayBars[0], high: Math.min(replayBars[0].high, order.entryPrice) }
        : { ...replayBars[0], low: Math.max(replayBars[0].low, order.entryPrice) };
  }

  for (let index = 0; index < replayBars.length; index += 1) {
    const current = replayBars[index];
    if (order.direction === "long") {
      if (current.low <= order.stopPrice) {
        return {
          status: "closed",
          fillOpenTime,
          exitOpenTime: current.openTime,
          exitReason: "stop",
          barsHeld: index + 1,
          pnlR: -1 - costR,
          rawPnlR: -1,
          costR,
        };
      }
      if (current.high >= order.targetPrice) {
        return {
          status: "closed",
          fillOpenTime,
          exitOpenTime: current.openTime,
          exitReason: "target",
          barsHeld: index + 1,
          pnlR: order.targetR - costR,
          rawPnlR: order.targetR,
          costR,
        };
      }
    } else {
      if (current.high >= order.stopPrice) {
        return {
          status: "closed",
          fillOpenTime,
          exitOpenTime: current.openTime,
          exitReason: "stop",
          barsHeld: index + 1,
          pnlR: -1 - costR,
          rawPnlR: -1,
          costR,
        };
      }
      if (current.low <= order.targetPrice) {
        return {
          status: "closed",
          fillOpenTime,
          exitOpenTime: current.openTime,
          exitReason: "target",
          barsHeld: index + 1,
          pnlR: order.targetR - costR,
          rawPnlR: order.targetR,
          costR,
        };
      }
    }
  }

  if (replayBars.length < order.maxBars) {
    return { status: "filled_open", fillOpenTime };
  }

  const last = replayBars[order.maxBars - 1];
  const rawPnlR =
    order.direction === "long"
      ? (last.close - order.entryPrice) / risk
      : (order.entryPrice - last.close) / risk;
  return {
    status: "closed",
    fillOpenTime,
    exitOpenTime: last.openTime,
    exitReason: "timeout",
    barsHeld: order.maxBars,
    pnlR: rawPnlR - costR,
    rawPnlR,
    costR,
  };
}

function buildOrderRiskSnapshot(
  order: EdgeZonePortfolioOrder,
  oneMinuteCandles: Candle[],
  state: BtcusdcPaperTradingState,
  options: AdvanceBtcusdcPaperTradingOptions,
  config: ResearchConfig,
): BtcusdcPaperOrderRiskSnapshot {
  if (options.riskPct !== undefined) {
    const riskPct = Math.max(0, options.riskPct);
    return {
      riskPct,
      riskAmount: state.dailySeedEquity * riskPct,
      riskSource: "fixed_override",
      dailySeedEquity: state.dailySeedEquity,
      dailySeedDate: state.dailySeedDate,
      historicalTradesForKelly: 0,
      historicalWinRateForKelly: 0,
      historicalPayoffRatioForKelly: 0,
    };
  }

  const history = oneMinuteCandles.slice(0, order.entryStartIndex);
  const stress = buildBtcusdtEdgeZoneStressReport(history, {
    strategyId: order.strategyId,
    zoneId: order.zoneId,
    entryMode: order.entryMode,
    targetR: order.targetR,
    maxHoldFiveMinuteBars: order.maxHoldFiveMinuteBars,
    initialEquity: 1,
    config,
  });
  const hasKellySample = stress.trades >= config.minTrades && stress.recommendedRiskPct > 0;
  const fallbackRiskPct = Math.min(
    Math.max(0, options.fallbackRiskPct ?? config.riskCapPct),
    Math.max(0, config.riskCapPct),
  );
  const riskPct = hasKellySample ? stress.recommendedRiskPct : fallbackRiskPct;

  return {
    riskPct,
    riskAmount: state.dailySeedEquity * riskPct,
    riskSource: hasKellySample ? "historical_kelly" : "fallback_cap",
    dailySeedEquity: state.dailySeedEquity,
    dailySeedDate: state.dailySeedDate,
    historicalTradesForKelly: stress.trades,
    historicalWinRateForKelly: stress.winRate,
    historicalPayoffRatioForKelly: stress.payoffRatio,
  };
}

export function createInitialBtcusdcPaperTradingState(
  options: CreateBtcusdcPaperTradingStateOptions = {},
): BtcusdcPaperTradingState {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const lastCandleOpenTime = options.candles?.at(-1)?.openTime ?? null;
  const initialEquity = options.initialEquity ?? 1_000;
  const dailySeedTimezoneOffsetMinutes = KST_OFFSET_MINUTES;
  return {
    version: 1,
    mode: "paper_forward",
    exchange: "Binance",
    symbol: options.symbol ?? "BTCUSDC",
    displaySymbol: options.displaySymbol ?? "BTCUSDC.P",
    createdAt: nowIso,
    updatedAt: nowIso,
    activationOpenTime: options.activationOpenTime ?? lastCandleOpenTime ?? 0,
    lastCandleOpenTime,
    initialEquity,
    equity: initialEquity,
    peakEquity: initialEquity,
    maxDrawdownPct: 0,
    bettingMode: "kelly_daily_seed",
    dailySeedEquity: initialEquity,
    dailySeedDate: initialDailySeedDate({
      lastCandleOpenTime,
      activationOpenTime: options.activationOpenTime,
      nowIso,
      offsetMinutes: dailySeedTimezoneOffsetMinutes,
    }),
    dailySeedTimezoneOffsetMinutes,
    riskPct: options.riskPct ?? BTCUSDC_PAPER_DEFAULT_CONFIG.riskCapPct,
    totalPnlR: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    knownOrderIds: [],
    filledOrderIds: [],
    missedOrderIds: [],
    closedOrderIds: [],
    openOrderRisks: {},
  };
}

export function advanceBtcusdcPaperTradingState(
  oneMinuteCandles: Candle[],
  state: BtcusdcPaperTradingState,
  options: AdvanceBtcusdcPaperTradingOptions,
): { state: BtcusdcPaperTradingState; events: BtcusdcPaperTradingEvent[]; summary: BtcusdcPaperTradingSummary } {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const config = { ...BTCUSDC_PAPER_DEFAULT_CONFIG, ...(options.config ?? {}) };
  const hydrated = hydratePaperTradingState(state, {
    nowIso,
    initialEquity: options.initialEquity,
    dailySeedTimezoneOffsetMinutes: options.dailySeedTimezoneOffsetMinutes,
  });
  const next: BtcusdcPaperTradingState = {
    ...hydrated,
    symbol: options.symbol ?? hydrated.symbol,
    displaySymbol: options.displaySymbol ?? hydrated.displaySymbol,
    updatedAt: nowIso,
    lastCandleOpenTime: oneMinuteCandles.at(-1)?.openTime ?? hydrated.lastCandleOpenTime,
    knownOrderIds: [...hydrated.knownOrderIds],
    filledOrderIds: [...hydrated.filledOrderIds],
    missedOrderIds: [...hydrated.missedOrderIds],
    closedOrderIds: [...hydrated.closedOrderIds],
    openOrderRisks: { ...hydrated.openOrderRisks },
  };
  const known = new Set(next.knownOrderIds);
  const filled = new Set(next.filledOrderIds);
  const missed = new Set(next.missedOrderIds);
  const closed = new Set(next.closedOrderIds);
  const events: BtcusdcPaperTradingEvent[] = [];
  let newClosedTrades = 0;

  const edgeOrders = buildBtcusdtEdgeZonePortfolioOrders(oneMinuteCandles, {
    ...options,
    config,
  });
  const microOrders =
    options.microCandidates && options.microCandidates.length > 0
      ? buildBtcusdtMicroScalpPortfolioOrders(oneMinuteCandles, {
          candidates: options.microCandidates,
          config,
        })
      : [];
  const strategylessOrders =
    options.strategylessCandidates && options.strategylessCandidates.length > 0
      ? buildBtcusdtStrategylessOhlcvPortfolioOrders(oneMinuteCandles, {
          candidates: options.strategylessCandidates,
          config,
        })
      : [];
  const orders = [...edgeOrders, ...microOrders, ...strategylessOrders]
    .filter((order) => order.signalOpenTime >= next.activationOpenTime)
    .sort((left, right) => {
      if (left.signalOpenTime !== right.signalOpenTime) return left.signalOpenTime - right.signalOpenTime;
      return left.orderId.localeCompare(right.orderId);
    });

  for (const order of orders) {
    const evaluation = evaluatePaperOrder(order, oneMinuteCandles, config);
    if (!known.has(order.orderId)) {
      known.add(order.orderId);
      events.push(baseEvent("order_submitted", order, next, nowIso));
    }

    let orderRisk = next.openOrderRisks[order.orderId];
    if ((evaluation.status === "filled_open" || evaluation.status === "closed") && !filled.has(order.orderId)) {
      rollDailySeedToOpenTime(next, evaluation.fillOpenTime);
      orderRisk = buildOrderRiskSnapshot(order, oneMinuteCandles, next, options, config);
      next.openOrderRisks[order.orderId] = orderRisk;
      filled.add(order.orderId);
      events.push({
        ...baseEvent("order_filled", order, next, nowIso),
        fillOpenTime: evaluation.fillOpenTime,
        ...orderRisk,
      });
    }

    if (evaluation.status === "missed" && !missed.has(order.orderId)) {
      missed.add(order.orderId);
      delete next.openOrderRisks[order.orderId];
      events.push(baseEvent("order_missed", order, next, nowIso));
    }

    if (evaluation.status === "closed" && !closed.has(order.orderId)) {
      orderRisk = orderRisk ?? next.openOrderRisks[order.orderId];
      if (!orderRisk) {
        rollDailySeedToOpenTime(next, evaluation.fillOpenTime);
        orderRisk = buildOrderRiskSnapshot(order, oneMinuteCandles, next, options, config);
      }
      closed.add(order.orderId);
      next.totalPnlR += evaluation.pnlR;
      next.closedTrades += 1;
      if (evaluation.pnlR > 0) next.wins += 1;
      if (evaluation.pnlR < 0) next.losses += 1;
      next.riskPct = orderRisk.riskPct;
      next.equity = Math.max(0, next.equity + evaluation.pnlR * orderRisk.riskAmount);
      next.peakEquity = Math.max(next.peakEquity, next.equity);
      next.maxDrawdownPct = Math.max(
        next.maxDrawdownPct,
        next.peakEquity === 0 ? 0 : (next.peakEquity - next.equity) / next.peakEquity,
      );
      delete next.openOrderRisks[order.orderId];
      newClosedTrades += 1;
      events.push({
        ...baseEvent("trade_closed", order, next, nowIso),
        fillOpenTime: evaluation.fillOpenTime,
        exitOpenTime: evaluation.exitOpenTime,
        exitReason: evaluation.exitReason,
        barsHeld: evaluation.barsHeld,
        pnlR: evaluation.pnlR,
        rawPnlR: evaluation.rawPnlR,
        costR: evaluation.costR,
        ...orderRisk,
        equity: next.equity,
        totalPnlR: next.totalPnlR,
      });
    }
  }

  const latestOpenTime = oneMinuteCandles.at(-1)?.openTime;
  if (latestOpenTime !== undefined) {
    rollDailySeedToOpenTime(next, latestOpenTime);
  }

  next.knownOrderIds = sortedIds(known);
  next.filledOrderIds = sortedIds(filled);
  next.missedOrderIds = sortedIds(missed);
  next.closedOrderIds = sortedIds(closed);

  const summary: BtcusdcPaperTradingSummary = {
    symbol: next.symbol,
    displaySymbol: next.displaySymbol,
    events: events.length,
    submittedOrders: next.knownOrderIds.length,
    filledOrders: next.filledOrderIds.length,
    missedOrders: next.missedOrderIds.length,
    closedTrades: next.closedTrades,
    newClosedTrades,
    openOrders: Math.max(0, next.knownOrderIds.length - next.missedOrderIds.length - next.closedOrderIds.length),
    totalPnlR: next.totalPnlR,
    equity: next.equity,
    maxDrawdownPct: next.maxDrawdownPct,
    riskPct: next.riskPct,
    bettingMode: next.bettingMode,
    dailySeedEquity: next.dailySeedEquity,
    dailySeedDate: next.dailySeedDate,
    activationOpenTime: next.activationOpenTime,
    lastCandleOpenTime: next.lastCandleOpenTime,
  };

  return { state: next, events, summary };
}

export function loadBtcusdcPaperTradingState(path: string): BtcusdcPaperTradingState | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as BtcusdcPaperTradingState;
}

export function saveBtcusdcPaperTradingState(path: string, state: BtcusdcPaperTradingState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function appendBtcusdcPaperTradingEvents(path: string, events: BtcusdcPaperTradingEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

export function buildBtcusdcPaperTelegramMessage(
  events: BtcusdcPaperTradingEvent[],
  summary: BtcusdcPaperTradingSummary,
): { text: string } {
  const lines = [
    `${summary.displaySymbol} 페이퍼 매매 알림`,
    `이벤트 ${summary.events} | 종료거래 ${summary.closedTrades} | 오픈주문 ${summary.openOrders}`,
    `자산 ${formatMoney(summary.equity)} | 손익 ${signed(summary.totalPnlR)}R | 최대DD ${(summary.maxDrawdownPct * 100).toFixed(2)}%`,
    `일일시드 ${formatMoney(summary.dailySeedEquity)} ${summary.dailySeedDate} | 리스크 ${(summary.riskPct * 100).toFixed(3)}%`,
  ];

  for (const event of events.slice(-6)) {
    if (event.type === "trade_closed") {
      lines.push(
        `거래종료 ${event.candidateLabel} ${event.direction} ${signed(event.pnlR ?? 0)}R ${event.exitReason} 리스크 ${formatMoney(event.riskAmount ?? 0)} 자산 ${formatMoney(event.equity ?? summary.equity)}`,
      );
    } else if (event.type === "order_filled") {
      lines.push(
        `주문체결 ${event.candidateLabel} ${event.direction} @ ${event.entryPrice} 리스크 ${formatMoney(event.riskAmount ?? 0)}`,
      );
    } else {
      const type = event.type === "order_submitted" ? "주문제출" : event.type === "order_missed" ? "주문미체결" : event.type;
      lines.push(`${type} ${event.candidateLabel} ${event.direction} @ ${event.entryPrice}`);
    }
  }

  return { text: lines.join("\n") };
}
