import { readFileSync } from "node:fs";

export type TradeDirection = "long" | "short";
export type TradeExitReason = "target" | "stop" | "timeout";
export type ReplayEntryMode =
  | "next-open"
  | "limit-signal-close"
  | "limit-quarter-pullback"
  | "limit-half-pullback";

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
}

export interface FiveMinuteCandle extends Candle {
  sourceStartIndex: number;
  sourceEndIndex: number;
}

export interface BarrierTradeInput {
  direction: TradeDirection;
  entryPrice: number;
  stopPrice: number;
  targetR: number;
  maxBars: number;
  oneMinuteCandles: Candle[];
  feeRate: number;
  tickSize: number;
  adverseTicks: number;
}

export interface BarrierTradeResult {
  pnlR: number;
  rawPnlR: number;
  costR: number;
  exitReason: TradeExitReason;
  barsHeld: number;
  entryPrice?: number;
  entryFilled?: boolean;
  entryMode?: ReplayEntryMode;
}

export interface ReplayTradeInput {
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  signalCandle: Candle;
  stopPrice: number;
  targetR: number;
  maxBars: number;
  entryWaitBars: number;
  entryFillBufferTicks?: number;
  oneMinuteCandles: Candle[];
  feeRate: number;
  tickSize: number;
  adverseTicks: number;
}

export interface KellyRiskInput {
  winRate: number;
  payoffRatio: number;
  kellyFraction: number;
  riskCapPct: number;
}

export interface KellyRiskResult {
  fullKelly: number;
  recommendedRiskPct: number;
}

export interface ResearchConfig {
  minTrades: number;
  feeRate: number;
  tickSize: number;
  adverseTicks: number;
  kellyFraction: number;
  riskCapPct: number;
  minRiskPct: number;
  entryModes?: ReplayEntryMode[];
  entryWaitBars?: number;
  entryFillBufferTicks?: number;
  minFillRate?: number;
}

export interface StrategyReport {
  id: string;
  name: string;
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  signals: number;
  filledTrades: number;
  missedTrades: number;
  fillRate: number;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  trades: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  fullKelly: number;
  recommendedRiskPct: number;
  accepted: boolean;
  notes: string[];
}

export interface BtcusdtResearchReport {
  symbol: string;
  displaySymbol?: string;
  exchange: "Binance";
  market: string;
  sourceInterval: "1m";
  signalInterval: "5m";
  candles: {
    oneMinute: number;
    fiveMinute: number;
  };
  config: ResearchConfig;
  assumptions: string[];
  strategies: StrategyReport[];
}

export interface WalkForwardOptions {
  foldFiveMinuteBars: number;
  minTrades: number;
  minPositiveFoldRate: number;
  minEligibleFolds?: number;
  minTradesPerFold?: number;
  minWorstFoldExpectancyR?: number;
  config: ResearchConfig;
}

export interface WalkForwardFold {
  index: number;
  startOpenTime: number;
  endOpenTime: number;
  strategies: number;
  acceptedCount: number;
}

export interface WalkForwardStrategyReport {
  id: string;
  name: string;
  direction: TradeDirection;
  eligibleFolds: number;
  positiveFolds: number;
  positiveFoldRate: number;
  totalTrades: number;
  minFoldTrades: number;
  worstFoldExpectancyR: number;
  medianExpectancyR: number;
  averageExpectancyR: number;
  accepted: boolean;
}

export interface WalkForwardReport {
  folds: WalkForwardFold[];
  strategies: WalkForwardStrategyReport[];
}

export interface SweepOptions {
  minRiskPctValues: number[];
  feeRateValues: number[];
  baseConfig: ResearchConfig;
}

export interface SweepRun {
  minRiskPct: number;
  feeRate: number;
  acceptedCount: number;
  positiveCount: number;
  topStrategyId: string | null;
  topExpectancyR: number;
  topTrades: number;
}

export interface ResearchSweepReport {
  runs: SweepRun[];
}

export interface EdgeZoneOptions {
  config?: Partial<ResearchConfig>;
  strategyIdPrefix?: string;
  minZoneTrades?: number;
  targetRs?: number[];
  maxHoldFiveMinuteBars?: number[];
}

export interface EdgeZoneReportRow {
  strategyId: string;
  variantId: string;
  zoneId: string;
  dimension: string;
  bucket: string;
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  signals: number;
  filledTrades: number;
  missedTrades: number;
  fillRate: number;
  trades: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export interface EdgeZoneReport {
  sourceInterval: "1m";
  signalInterval: "5m";
  candles: {
    oneMinute: number;
    fiveMinute: number;
  };
  config: ResearchConfig;
  assumptions: string[];
  zones: EdgeZoneReportRow[];
}

export interface StrategylessOhlcvOptions {
  config?: Partial<ResearchConfig>;
  targetRs?: number[];
  holdMinutes?: number[];
  maxConditions?: number;
  maxConditionSetsPerSignal?: number;
  maxRawBuckets?: number;
  maxCandidates?: number;
  minTrades?: number;
  minFillRate?: number;
  minExpectancyR?: number;
  minProfitFactor?: number;
}

export interface StrategylessOhlcvCandidateReport {
  strategyFamily: "strategyless-ohlcv";
  variantId: string;
  conditionId: string;
  conditions: string[];
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  targetR: number;
  holdMinutes: number;
  submittedOrders: number;
  filledTrades: number;
  missedTrades: number;
  fillRate: number;
  trades: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  fullKelly: number;
  recommendedRiskPct: number;
  score: number;
}

export interface StrategylessOhlcvReport {
  sourceInterval: "1m";
  contextInterval: "5m";
  candles: {
    oneMinute: number;
    fiveMinute: number;
  };
  config: ResearchConfig;
  targetRs: number[];
  holdMinutes: number[];
  assumptions: string[];
  candidates: StrategylessOhlcvCandidateReport[];
}

export interface PayoffSkewFilterOptions {
  maxWinRate: number;
  minPayoffRatio: number;
  minExpectancyR: number;
  minProfitFactor: number;
  minTrades: number;
  minFillRate?: number;
}

export interface EdgeZoneStressOptions {
  strategyId: string;
  zoneId: string;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  config?: Partial<ResearchConfig>;
  initialEquity?: number;
  riskPct?: number;
}

export interface EdgeZoneStressTrade {
  signalOpenTime: number;
  entryOpenTime: number;
  pnlR: number;
  rawPnlR: number;
  exitReason: TradeExitReason;
  barsHeld: number;
  entryPrice?: number;
  cumulativePnlR: number;
  equity: number;
  drawdownPct: number;
}

export interface EdgeZoneStressReport {
  strategyId: string;
  variantId: string;
  zoneId: string;
  direction: TradeDirection | null;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  submittedOrders: number;
  missedTrades: number;
  fillRate: number;
  trades: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  fullKelly: number;
  recommendedRiskPct: number;
  riskPct: number;
  initialEquity: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  longestWinStreak: number;
  longestLossStreak: number;
  topProfitTradeShare: number;
  topProfitDayShare: number;
  tradeLog: EdgeZoneStressTrade[];
}

export interface EdgeZoneFragilitySlice {
  label: string;
  trades: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  totalPnlR: number;
}

export interface EdgeZoneFragilityReport {
  strategyId: string;
  variantId: string;
  zoneId: string;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  baseline: EdgeZoneFragilitySlice;
  withoutBestTrade: EdgeZoneFragilitySlice;
  withoutBestFivePercentWinners: EdgeZoneFragilitySlice;
  withoutBestDay: EdgeZoneFragilitySlice;
  firstHalf: EdgeZoneFragilitySlice;
  secondHalf: EdgeZoneFragilitySlice;
  positiveHalves: number;
  worstPerturbationExpectancyR: number;
  robust: boolean;
  notes: string[];
}

export interface EdgeZonePortfolioCandidate {
  label?: string;
  strategyId: string;
  zoneId: string;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
}

export interface MicroScalpPortfolioCandidate {
  label?: string;
  strategyId: string;
  zoneId: string;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldBars: number;
}

export interface StrategylessOhlcvPortfolioCandidate {
  label?: string;
  conditionId: string;
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  targetR: number;
  holdMinutes: number;
}

export interface MicroScalpPortfolioOptions {
  candidates: MicroScalpPortfolioCandidate[];
  config?: Partial<ResearchConfig>;
}

export interface StrategylessOhlcvPortfolioOptions {
  candidates: StrategylessOhlcvPortfolioCandidate[];
  config?: Partial<ResearchConfig>;
}

export interface EdgeZonePortfolioOptions {
  candidates: EdgeZonePortfolioCandidate[];
  config?: Partial<ResearchConfig>;
  initialEquity?: number;
  riskPct?: number;
}

export interface EdgeZonePortfolioOrder {
  orderId: string;
  candidateIndex: number;
  candidateLabel: string;
  strategyId: string;
  variantId: string;
  zoneId: string;
  direction: TradeDirection;
  signalOpenTime: number;
  signalCloseTime: number;
  signalSourceEndIndex: number;
  entryStartIndex: number;
  entryOpenTime: number;
  entryMode: ReplayEntryMode;
  entryWaitBars: number;
  entryFillBufferTicks: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  maxBars: number;
}

export interface EdgeZonePortfolioCandidateReport {
  label: string;
  strategyId: string;
  variantId: string;
  zoneId: string;
  entryMode: ReplayEntryMode;
  targetR: number;
  maxHoldFiveMinuteBars: number;
  submittedOrders: number;
  trades: number;
  fillRate: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export interface EdgeZonePortfolioTrade {
  candidateIndex: number;
  candidateLabel: string;
  strategyId: string;
  variantId: string;
  zoneId: string;
  direction: TradeDirection | null;
  entryOpenTime: number;
  pnlR: number;
  rawPnlR: number;
  exitReason: TradeExitReason;
  barsHeld: number;
  entryPrice?: number;
}

export interface EdgeZonePortfolioEntryGroup {
  entryOpenTime: number;
  trades: number;
  candidateLabels: string[];
  netPnlR: number;
  grossRiskPct: number;
  cumulativePnlR: number;
  equity: number;
  drawdownPct: number;
}

export interface EdgeZonePortfolioReport {
  candidates: EdgeZonePortfolioCandidateReport[];
  trades: number;
  entryGroups: number;
  sameMinuteEntryGroups: number;
  maxSameMinuteTrades: number;
  overlapShare: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  riskPct: number;
  initialEquity: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  longestLossStreak: number;
  tradeLog: EdgeZonePortfolioTrade[];
  groupedTradeLog: EdgeZonePortfolioEntryGroup[];
  notes: string[];
}

export interface EdgeZonePortfolioRobustnessOptions extends EdgeZonePortfolioOptions {
  riskPctValues?: number[];
  topProfitDayCounts?: number[];
}

export interface EdgeZonePortfolioBaselineSummary {
  trades: number;
  entryGroups: number;
  totalPnlR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  overlapShare: number;
}

export interface EdgeZonePortfolioRiskScenario {
  riskPct: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  maxDrawdownR: number;
  longestLossStreak: number;
  ruined: boolean;
}

export interface EdgeZonePortfolioMonthlyRow {
  month: string;
  entryGroups: number;
  trades: number;
  totalPnlR: number;
  expectancyPerGroupR: number;
  positiveGroupRate: number;
  maxDrawdownR: number;
}

export interface EdgeZonePortfolioTopDayRemoval {
  removedDays: number;
  remainingEntryGroups: number;
  remainingTrades: number;
  totalPnlR: number;
  expectancyPerGroupR: number;
  expectancyPerTradeR: number;
  maxDrawdownR: number;
}

export interface EdgeZonePortfolioRobustnessReport {
  baseline: EdgeZonePortfolioBaselineSummary;
  riskScenarios: EdgeZonePortfolioRiskScenario[];
  monthlyRows: EdgeZonePortfolioMonthlyRow[];
  withoutTopProfitDays: EdgeZonePortfolioTopDayRemoval[];
  portfolio: EdgeZonePortfolioReport;
  notes: string[];
}

export interface EdgeZonePortfolioRollingOptions extends EdgeZonePortfolioOptions {
  windowDays: number;
  stepDays?: number;
  minEntryGroups?: number;
  minPositiveWindowRate?: number;
  minWorstExpectancyR?: number;
}

export interface EdgeZonePortfolioRollingWindow {
  index: number;
  startOpenTime: number;
  endOpenTime: number;
  trades: number;
  entryGroups: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  returnPct: number;
  maxDrawdownPct: number;
  eligible: boolean;
  positive: boolean;
}

export interface EdgeZonePortfolioRollingReport {
  windowDays: number;
  stepDays: number;
  windows: EdgeZonePortfolioRollingWindow[];
  eligibleWindows: number;
  positiveWindows: number;
  positiveWindowRate: number;
  totalTrades: number;
  worstExpectancyR: number;
  medianExpectancyR: number;
  worstProfitFactor: number;
  worstMaxDrawdownR: number;
  accepted: boolean;
}

export interface EdgeZonePortfolioExecutionSweepOptions extends EdgeZonePortfolioOptions {
  entryWaitBarsValues: number[];
  entryFillBufferTicksValues: number[];
}

export interface EdgeZonePortfolioExecutionSweepRow {
  entryWaitBars: number;
  entryFillBufferTicks: number;
  submittedOrders: number;
  trades: number;
  entryGroups: number;
  fillRate: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  returnPct: number;
  maxDrawdownPct: number;
}

export interface EdgeZonePortfolioExecutionSweepReport {
  rows: EdgeZonePortfolioExecutionSweepRow[];
}

export interface EdgeZoneWalkForwardOptions extends EdgeZoneStressOptions {
  foldFiveMinuteBars: number;
  minPositiveFoldRate: number;
  minEligibleFolds?: number;
  minTradesPerFold?: number;
  minWorstFoldExpectancyR?: number;
}

export interface EdgeZoneWalkForwardFold {
  index: number;
  startOpenTime: number;
  endOpenTime: number;
  submittedOrders: number;
  trades: number;
  fillRate: number;
  winRate: number;
  payoffRatio: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  returnPct: number;
  maxDrawdownPct: number;
  eligible: boolean;
  positive: boolean;
}

export interface EdgeZoneWalkForwardReport {
  strategyId: string;
  variantId: string;
  zoneId: string;
  folds: EdgeZoneWalkForwardFold[];
  eligibleFolds: number;
  positiveFolds: number;
  positiveFoldRate: number;
  totalTrades: number;
  minFoldTrades: number;
  worstFoldExpectancyR: number;
  medianExpectancyR: number;
  averageExpectancyR: number;
  accepted: boolean;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface BinanceFetchOptions {
  symbol?: string;
  days?: number;
  maxCandles?: number;
  endTime?: number;
  fetchImpl?: FetchLike;
}

interface Signal {
  id: string;
  name: string;
  direction: TradeDirection;
  fiveMinuteIndex: number;
  stopPrice: number;
  notes: string[];
}

interface ZoneFeatureSet {
  rangeRank: number;
  volumeRank: number;
  closePosition: number;
  bodyRatio: number;
  signedBodyRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
}

interface ZoneCondition {
  id: string;
  label: string;
  matches(features: ZoneFeatureSet): boolean;
}

interface IntrabarStats {
  bars: Candle[];
  greenCount: number;
  redCount: number;
  risingCloseSteps: number;
  fallingCloseSteps: number;
  highMinuteIndex: number;
  lowMinuteIndex: number;
  maxVolumeIndex: number;
}

interface EdgeZoneLabel {
  zoneId: string;
  dimension: string;
  bucket: string;
}

interface MicroScalpSignal {
  id: string;
  zoneId: string;
  direction: TradeDirection;
  signalCandle: Candle;
  sourceEndIndex: number;
  stopPrice: number;
}

const DEFAULT_CONFIG: ResearchConfig = {
  minTrades: 20,
  feeRate: 0.0004,
  tickSize: 0.1,
  adverseTicks: 1,
  kellyFraction: 0.25,
  riskCapPct: 0.005,
  minRiskPct: 0.0005,
  entryModes: ["next-open"],
  entryWaitBars: 0,
  entryFillBufferTicks: 0,
  minFillRate: 0,
};

function numberFromKline(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Binance kline number: ${String(value)}`);
  }
  return parsed;
}

export function parseBinanceKlines(rows: unknown[][]): Candle[] {
  return rows.map((row) => ({
    openTime: numberFromKline(row[0]),
    open: numberFromKline(row[1]),
    high: numberFromKline(row[2]),
    low: numberFromKline(row[3]),
    close: numberFromKline(row[4]),
    volume: numberFromKline(row[5]),
    closeTime: row[6] === undefined ? undefined : numberFromKline(row[6]),
  }));
}

export function loadCandlesFromBinanceKlineFile(path: string): Candle[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Binance kline file must contain a JSON array");
  }
  if (parsed.length === 0) return [];
  if (Array.isArray(parsed[0])) return parseBinanceKlines(parsed as unknown[][]);
  return (parsed as Array<Partial<Candle>>).map((item) => {
    if (
      typeof item.openTime !== "number" ||
      typeof item.open !== "number" ||
      typeof item.high !== "number" ||
      typeof item.low !== "number" ||
      typeof item.close !== "number" ||
      typeof item.volume !== "number"
    ) {
      throw new Error("Candle JSON rows must include numeric openTime, open, high, low, close, and volume");
    }
    return {
      openTime: item.openTime,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      closeTime: item.closeTime,
    };
  });
}

export async function fetchBinanceBtcusdtOneMinuteCandles(
  options: BinanceFetchOptions = {},
): Promise<Candle[]> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const symbol = options.symbol ?? "BTCUSDT";
  const endTime = options.endTime ?? Date.now();
  const days = options.days ?? 7;
  const maxCandles = options.maxCandles ?? days * 24 * 60;
  let startTime = endTime - days * 24 * 60 * 60 * 1000;
  const rows: unknown[][] = [];

  while (startTime < endTime && rows.length < maxCandles) {
    const limit = Math.min(1500, maxCandles - rows.length);
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1m");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("startTime", String(startTime));
    url.searchParams.set("endTime", String(endTime));

    const response = await fetchImpl(url.toString());
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Binance klines request failed with ${response.status}: ${JSON.stringify(payload)}`);
    }
    if (!Array.isArray(payload) || payload.length === 0) break;

    const batch = payload as unknown[][];
    rows.push(...batch);
    const lastOpenTime = Number(batch[batch.length - 1][0]);
    if (!Number.isFinite(lastOpenTime) || lastOpenTime < startTime) break;
    startTime = lastOpenTime + 60_000;
  }

  return parseBinanceKlines(rows).sort((left, right) => left.openTime - right.openTime);
}

export function resampleToFiveMinuteCandles(oneMinuteCandles: Candle[]): FiveMinuteCandle[] {
  const result: FiveMinuteCandle[] = [];
  const fiveMinutes = 5 * 60_000;
  for (let index = 0; index + 4 < oneMinuteCandles.length;) {
    if (oneMinuteCandles[index].openTime % fiveMinutes !== 0) {
      index += 1;
      continue;
    }
    const group = oneMinuteCandles.slice(index, index + 5);
    const isCompleteGroup = group.every(
      (item, groupIndex) => item.openTime === group[0].openTime + groupIndex * 60_000,
    );
    if (!isCompleteGroup) {
      index += 1;
      continue;
    }
    result.push({
      openTime: group[0].openTime,
      open: group[0].open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, item) => sum + item.volume, 0),
      closeTime: group[group.length - 1].closeTime,
      sourceStartIndex: index,
      sourceEndIndex: index + group.length - 1,
    });
    index += 5;
  }
  return result;
}

function range(candle: Candle): number {
  return Math.max(candle.high - candle.low, 0);
}

function body(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

function signedBody(candle: Candle): number {
  return candle.close - candle.open;
}

function closePosition(candle: Candle): number {
  const candleRange = range(candle);
  if (candleRange === 0) return 0.5;
  return (candle.close - candle.low) / candleRange;
}

function upperWickRatio(candle: Candle): number {
  const candleRange = range(candle);
  if (candleRange === 0) return 0;
  return (candle.high - Math.max(candle.open, candle.close)) / candleRange;
}

function lowerWickRatio(candle: Candle): number {
  const candleRange = range(candle);
  if (candleRange === 0) return 0;
  return (Math.min(candle.open, candle.close) - candle.low) / candleRange;
}

function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0.5;
  return values.filter((candidate) => candidate <= value).length / values.length;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = index - xMean;
    numerator += x * (values[index] - yMean);
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function rankBucket(value: number): string {
  if (value >= 0.67) return "high";
  if (value <= 0.33) return "low";
  return "mid";
}

function bodyRatioBucket(value: number): string {
  if (value >= 0.6) return "large";
  if (value <= 0.25) return "small";
  return "medium";
}

function closePositionBucket(value: number): string {
  if (value >= 0.67) return "upper";
  if (value <= 0.33) return "lower";
  return "middle";
}

function driftBucket(value: number): string {
  if (value >= 0.2) return "up";
  if (value <= -0.2) return "down";
  return "flat";
}

function closeDerivativeBucket(value: number): string {
  if (value >= 0.2) return "up";
  if (value <= -0.2) return "down";
  return "flat";
}

function volumeDerivativeBucket(value: number): string {
  if (value >= 0.25) return "rising";
  if (value <= -0.25) return "falling";
  return "flat";
}

function rangeDerivativeBucket(value: number): string {
  if (value >= 0.25) return "expanding";
  if (value <= -0.25) return "compressing";
  return "flat";
}

function bodyDerivativeBucket(value: number): string {
  if (value >= 0.25) return "expanding";
  if (value <= -0.25) return "compressing";
  return "flat";
}

function closeAccelerationBucket(currentDelta: number, priorDelta: number, scale: number): string {
  const threshold = scale * 0.15;
  if (currentDelta > threshold && priorDelta > threshold) {
    return currentDelta > priorDelta * 1.25 ? "acceleratingUp" : currentDelta < priorDelta * 0.75 ? "deceleratingUp" : "steadyUp";
  }
  if (currentDelta < -threshold && priorDelta < -threshold) {
    return Math.abs(currentDelta) > Math.abs(priorDelta) * 1.25
      ? "acceleratingDown"
      : Math.abs(currentDelta) < Math.abs(priorDelta) * 0.75
        ? "deceleratingDown"
        : "steadyDown";
  }
  return "flat";
}

function effortResultBucket(input: {
  rangeRank: number;
  volumeRank: number;
  bodyRatio: number;
  closePosition: number;
}): string {
  if (input.volumeRank >= 0.67 && input.rangeRank >= 0.67 && input.closePosition >= 0.67) return "efficientUp";
  if (input.volumeRank >= 0.67 && input.rangeRank >= 0.67 && input.closePosition <= 0.33) return "efficientDown";
  if (input.volumeRank >= 0.67 && input.rangeRank <= 0.5 && input.bodyRatio <= 0.35) return "highEffortNoResult";
  if (input.volumeRank <= 0.33 && input.rangeRank >= 0.67) return "lowEffortExpansion";
  return "neutral";
}

function previousWindow<T>(items: T[], index: number, length: number): T[] {
  return items.slice(Math.max(0, index - length), index);
}

function indexOfMax(values: number[]): number {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function indexOfMin(values: number[]): number {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function intrabarStats(oneMinute: Candle[], fiveMinuteCandle: FiveMinuteCandle): IntrabarStats | null {
  const bars = oneMinute.slice(fiveMinuteCandle.sourceStartIndex, fiveMinuteCandle.sourceEndIndex + 1);
  if (bars.length !== 5) return null;

  let risingCloseSteps = 0;
  let fallingCloseSteps = 0;
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].close > bars[index - 1].close) risingCloseSteps += 1;
    if (bars[index].close < bars[index - 1].close) fallingCloseSteps += 1;
  }

  return {
    bars,
    greenCount: bars.filter((bar) => bar.close > bar.open).length,
    redCount: bars.filter((bar) => bar.close < bar.open).length,
    risingCloseSteps,
    fallingCloseSteps,
    highMinuteIndex: indexOfMax(bars.map((bar) => bar.high)),
    lowMinuteIndex: indexOfMin(bars.map((bar) => bar.low)),
    maxVolumeIndex: indexOfMax(bars.map((bar) => bar.volume)),
  };
}

const ZONE_CONDITIONS: ZoneCondition[] = [
  {
    id: "range_hi",
    label: "5m range in upper historical rank",
    matches: (features) => features.rangeRank >= 0.8,
  },
  {
    id: "range_lo",
    label: "5m range in lower historical rank",
    matches: (features) => features.rangeRank <= 0.25,
  },
  {
    id: "volume_hi",
    label: "5m volume in upper historical rank",
    matches: (features) => features.volumeRank >= 0.8,
  },
  {
    id: "volume_lo",
    label: "5m volume in lower historical rank",
    matches: (features) => features.volumeRank <= 0.25,
  },
  {
    id: "close_hi",
    label: "5m close near high",
    matches: (features) => features.closePosition >= 0.75,
  },
  {
    id: "close_lo",
    label: "5m close near low",
    matches: (features) => features.closePosition <= 0.25,
  },
  {
    id: "body_hi",
    label: "5m body dominates range",
    matches: (features) => features.bodyRatio >= 0.6,
  },
  {
    id: "body_lo",
    label: "5m body is small versus range",
    matches: (features) => features.bodyRatio <= 0.25,
  },
  {
    id: "upper_wick_hi",
    label: "5m upper wick dominates",
    matches: (features) => features.upperWickRatio >= 0.45,
  },
  {
    id: "lower_wick_hi",
    label: "5m lower wick dominates",
    matches: (features) => features.lowerWickRatio >= 0.45,
  },
];

function conditionSets(active: ZoneCondition[]): ZoneCondition[][] {
  const sets = active.map((condition) => [condition]);
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      sets.push([active[left], active[right]]);
    }
  }
  return sets;
}

function detectMinedZoneSignals(fiveMinute: FiveMinuteCandle[]): Signal[] {
  const signals: Signal[] = [];
  for (let index = 20; index < fiveMinute.length - 1; index += 1) {
    const current = fiveMinute[index];
    const previous = previousWindow(fiveMinute, index, 96);
    const currentRange = range(current);
    if (currentRange === 0 || previous.length < 20) continue;

    const features: ZoneFeatureSet = {
      rangeRank: percentileRank(previous.map(range), currentRange),
      volumeRank: percentileRank(previous.map((item) => item.volume), current.volume),
      closePosition: closePosition(current),
      bodyRatio: body(current) / currentRange,
      signedBodyRatio: signedBody(current) / currentRange,
      upperWickRatio: upperWickRatio(current),
      lowerWickRatio: lowerWickRatio(current),
    };
    const active = ZONE_CONDITIONS.filter((condition) => condition.matches(features));
    for (const set of conditionSets(active)) {
      const conditionId = set.map((condition) => condition.id).join("+");
      const conditionLabels = set.map((condition) => condition.label).join("; ");
      const directionalBias =
        features.closePosition >= 0.6 || features.signedBodyRatio > 0.35
          ? "long"
          : features.closePosition <= 0.4 || features.signedBodyRatio < -0.35
            ? "short"
            : null;
      const directions: TradeDirection[] = directionalBias ? [directionalBias] : ["long", "short"];
      for (const direction of directions) {
        signals.push({
          id: `mined-zone:${conditionId}:${direction}`,
          name: `Mined raw OHLCV zone: ${conditionLabels}`,
          direction,
          fiveMinuteIndex: index,
          stopPrice: direction === "long" ? current.low : current.high,
          notes: [
            conditionLabels,
            "Automatically mined from raw 5m OHLCV ranks; no technical indicators.",
          ],
        });
      }
    }
  }
  return signals;
}

function edgeZoneLabels(fiveMinute: FiveMinuteCandle[], index: number): EdgeZoneLabel[] {
  const current = fiveMinute[index];
  const previous = previousWindow(fiveMinute, index, 96);
  const recent = previousWindow(fiveMinute, index, 6);
  const derivativeWindow = previous.slice(-3);
  const currentRange = range(current);
  const rangeRankBucket = rankBucket(percentileRank(previous.map(range), currentRange));
  const volumeRankBucket = rankBucket(percentileRank(previous.map((item) => item.volume), current.volume));
  const bodyBucket = bodyRatioBucket(currentRange === 0 ? 0 : body(current) / currentRange);
  const closeBucket = closePositionBucket(closePosition(current));
  const recentRangeSum = recent.reduce((sum, item) => sum + range(item), 0);
  const recentDrift =
    recent.length === 0 || recentRangeSum === 0 ? 0 : (current.close - recent[0].open) / recentRangeSum;
  const drift = driftBucket(recentDrift);
  const direction =
    current.close > current.open ? "bull" : current.close < current.open ? "bear" : "neutral";
  const derivativeRangeBase = average(derivativeWindow.map(range)) || currentRange || 1;
  const derivativeVolumeBase = average(derivativeWindow.map((item) => item.volume)) || current.volume || 1;
  const derivativeBodyBase = average(derivativeWindow.map(body)) || body(current) || 1;
  const rangeRank = percentileRank(previous.map(range), currentRange);
  const volumeRank = percentileRank(previous.map((item) => item.volume), current.volume);
  const currentBodyRatio = currentRange === 0 ? 0 : body(current) / currentRange;
  const closeDerivative =
    derivativeWindow.length === 0 ? 0 : (current.close - derivativeWindow[0].close) / derivativeRangeBase;
  const volumeDerivative = current.volume / derivativeVolumeBase - 1;
  const rangeDerivative = currentRange / derivativeRangeBase - 1;
  const bodyDerivative = body(current) / derivativeBodyBase - 1;
  const currentCloseDelta = previous.length === 0 ? 0 : current.close - previous[previous.length - 1].close;
  const priorCloseDelta =
    previous.length < 2 ? 0 : previous[previous.length - 1].close - previous[previous.length - 2].close;
  const effortResult = effortResultBucket({
    rangeRank,
    volumeRank,
    bodyRatio: currentBodyRatio,
    closePosition: closePosition(current),
  });

  const labels: EdgeZoneLabel[] = [
    { zoneId: `rangeRank:${rangeRankBucket}`, dimension: "rangeRank", bucket: rangeRankBucket },
    { zoneId: `volumeRank:${volumeRankBucket}`, dimension: "volumeRank", bucket: volumeRankBucket },
    { zoneId: `bodyRatio:${bodyBucket}`, dimension: "bodyRatio", bucket: bodyBucket },
    { zoneId: `closePosition:${closeBucket}`, dimension: "closePosition", bucket: closeBucket },
    { zoneId: `recentDrift:${drift}`, dimension: "recentDrift", bucket: drift },
    { zoneId: `bodyDirection:${direction}`, dimension: "bodyDirection", bucket: direction },
    {
      zoneId: `closeDerivative:${closeDerivativeBucket(closeDerivative)}`,
      dimension: "closeDerivative",
      bucket: closeDerivativeBucket(closeDerivative),
    },
    {
      zoneId: `volumeDerivative:${volumeDerivativeBucket(volumeDerivative)}`,
      dimension: "volumeDerivative",
      bucket: volumeDerivativeBucket(volumeDerivative),
    },
    {
      zoneId: `rangeDerivative:${rangeDerivativeBucket(rangeDerivative)}`,
      dimension: "rangeDerivative",
      bucket: rangeDerivativeBucket(rangeDerivative),
    },
    {
      zoneId: `closeAcceleration:${closeAccelerationBucket(currentCloseDelta, priorCloseDelta, derivativeRangeBase)}`,
      dimension: "closeAcceleration",
      bucket: closeAccelerationBucket(currentCloseDelta, priorCloseDelta, derivativeRangeBase),
    },
    {
      zoneId: `bodyDerivative:${bodyDerivativeBucket(bodyDerivative)}`,
      dimension: "bodyDerivative",
      bucket: bodyDerivativeBucket(bodyDerivative),
    },
    {
      zoneId: `effortResult:${effortResult}`,
      dimension: "effortResult",
      bucket: effortResult,
    },
  ];

  const pairInputs = [...labels];
  for (let left = 0; left < pairInputs.length; left += 1) {
    for (let right = left + 1; right < pairInputs.length; right += 1) {
      labels.push({
        zoneId: `${pairInputs[left].zoneId}+${pairInputs[right].zoneId}`,
        dimension: `${pairInputs[left].dimension}+${pairInputs[right].dimension}`,
        bucket: `${pairInputs[left].bucket}+${pairInputs[right].bucket}`,
      });
    }
  }

  return labels;
}

function detectSignals(fiveMinute: FiveMinuteCandle[], oneMinute: Candle[]): Signal[] {
  const signals: Signal[] = [];
  for (let index = 6; index < fiveMinute.length - 1; index += 1) {
    const current = fiveMinute[index];
    const previous = previousWindow(fiveMinute, index, 6);
    const previousRanges = previous.map(range);
    const previousVolumes = previous.map((item) => item.volume);
    const currentRange = range(current);
    const rangeRank = percentileRank(previousRanges, currentRange);
    const volumeRank = percentileRank(previousVolumes, current.volume);
    const currentClosePosition = closePosition(current);
    const previousHigh = Math.max(...previous.map((item) => item.high));
    const previousLow = Math.min(...previous.map((item) => item.low));
    const recentCompressed =
      previous.slice(-3).every((item) => percentileRank(previousRanges, range(item)) <= 0.5);
    const oneBack = fiveMinute[index - 1];
    const twoBack = fiveMinute[index - 2];
    const threeBack = fiveMinute[index - 3];
    const fourBack = fiveMinute[index - 4];
    const oneBackRange = range(oneBack);
    const twoBackRange = range(twoBack);
    const closeDeltaOne = threeBack.close - fourBack.close;
    const closeDeltaTwo = twoBack.close - threeBack.close;
    const closeDeltaThree = oneBack.close - twoBack.close;
    const closeDerivativeBase = average([range(fourBack), range(threeBack), twoBackRange, oneBackRange]) || 1;
    const upwardDerivativeFade =
      closeDeltaOne > closeDerivativeBase * 0.15 &&
      closeDeltaTwo > 0 &&
      closeDeltaThree > 0 &&
      closeDeltaThree < closeDeltaTwo &&
      closeDeltaTwo < closeDeltaOne;
    const downwardDerivativeFade =
      closeDeltaOne < -closeDerivativeBase * 0.15 &&
      closeDeltaTwo < 0 &&
      closeDeltaThree < 0 &&
      Math.abs(closeDeltaThree) < Math.abs(closeDeltaTwo) &&
      Math.abs(closeDeltaTwo) < Math.abs(closeDeltaOne);
    const volumeDerivativeFade =
      oneBack.volume < twoBack.volume &&
      twoBack.volume < threeBack.volume &&
      threeBack.volume <= fourBack.volume;
    const currentBodyRatio = currentRange === 0 ? 0 : body(current) / currentRange;
    const recentDriftRaw =
      previous.reduce((sum, item) => sum + range(item), 0) === 0
        ? 0
        : (oneBack.close - previous[0].open) / previous.reduce((sum, item) => sum + range(item), 0);
    const highVolumeNarrowSpread =
      volumeRank >= 0.75 &&
      rangeRank <= 0.5 &&
      currentBodyRatio <= 0.35 &&
      currentClosePosition > 0.15 &&
      currentClosePosition < 0.85;
    const quietCoil = [fourBack, threeBack, twoBack, oneBack];
    const quietCoilHigh = Math.max(...quietCoil.map((item) => item.high));
    const quietCoilLow = Math.min(...quietCoil.map((item) => item.low));
    const quietCoilAverageRange = average(quietCoil.map(range));
    const quietCoilAverageVolume = average(quietCoil.map((item) => item.volume));
    const previousAverageRange = average(previousRanges);
    const previousAverageVolume = average(previousVolumes);
    const isQuietCoil =
      quietCoilAverageRange <= previousAverageRange * 0.95 &&
      quietCoilAverageVolume <= previousAverageVolume * 0.75 &&
      quietCoil.every((item) => range(item) <= previousAverageRange * 1.1);
    const forceBar = fourBack;
    const pullbackBars = [threeBack, twoBack, oneBack];
    const forceRange = range(forceBar);
    const forceBodyRatio = forceRange === 0 ? 0 : body(forceBar) / forceRange;
    const forceRangeRank = percentileRank(previousRanges, forceRange);
    const forceVolumeRank = percentileRank(previousVolumes, forceBar.volume);
    const forceIsBullish = forceBar.close > forceBar.open && forceBodyRatio >= 0.6 && forceRangeRank >= 0.7 && forceVolumeRank >= 0.65;
    const forceIsBearish = forceBar.close < forceBar.open && forceBodyRatio >= 0.6 && forceRangeRank >= 0.7 && forceVolumeRank >= 0.65;
    const pullbackVolumeDeclines = pullbackBars[0].volume > pullbackBars[1].volume && pullbackBars[1].volume > pullbackBars[2].volume;
    const pullbackHigh = Math.max(...pullbackBars.map((item) => item.high));
    const pullbackLow = Math.min(...pullbackBars.map((item) => item.low));
    const pullbackRetraceLong = forceRange === 0 ? 1 : (forceBar.high - pullbackLow) / forceRange;
    const pullbackRetraceShort = forceRange === 0 ? 1 : (pullbackHigh - forceBar.low) / forceRange;

    if (highVolumeNarrowSpread && recentDriftRaw >= 0.35) {
      signals.push({
        id: "high-volume-narrow-spread-absorption-short",
        name: "high-volume narrow-spread absorption",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: current.high,
        notes: [
          "Directional upward drift met a high-volume, narrow-spread 5m candle with little body progress.",
          "Tests effort-without-result absorption using only OHLCV.",
        ],
      });
    }

    if (highVolumeNarrowSpread && recentDriftRaw <= -0.35) {
      signals.push({
        id: "high-volume-narrow-spread-absorption-long",
        name: "high-volume narrow-spread absorption",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: current.low,
        notes: [
          "Directional downward drift met a high-volume, narrow-spread 5m candle with little body progress.",
          "Tests effort-without-result absorption using only OHLCV.",
        ],
      });
    }

    if (isQuietCoil && current.high > quietCoilHigh && current.close < quietCoilHigh && currentClosePosition <= 0.55) {
      signals.push({
        id: "quiet-coil-failed-expansion-short",
        name: "quiet-coil failed expansion",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: current.high,
        notes: [
          "Four low-range, low-volume 5m candles formed a quiet coil before price broke up and closed back inside.",
          "Fades failed expansion from a candle-only coil.",
        ],
      });
    }

    if (isQuietCoil && current.low < quietCoilLow && current.close > quietCoilLow && currentClosePosition >= 0.45) {
      signals.push({
        id: "quiet-coil-failed-expansion-long",
        name: "quiet-coil failed expansion",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: current.low,
        notes: [
          "Four low-range, low-volume 5m candles formed a quiet coil before price broke down and closed back inside.",
          "Fades failed expansion from a candle-only coil.",
        ],
      });
    }

    if (
      forceIsBullish &&
      pullbackVolumeDeclines &&
      pullbackBars.every((item) => item.close < item.open && item.high <= forceBar.high) &&
      pullbackRetraceLong <= 0.55 &&
      current.close > pullbackHigh
    ) {
      signals.push({
        id: "three-candle-low-volume-pullback-continuation-long",
        name: "three-candle low-volume pullback continuation",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: pullbackLow,
        notes: [
          "A bullish force bar was followed by three counter-direction candles with declining volume.",
          "Price resolved above the pullback highs without using indicators.",
        ],
      });
    }

    if (
      forceIsBearish &&
      pullbackVolumeDeclines &&
      pullbackBars.every((item) => item.close > item.open && item.low >= forceBar.low) &&
      pullbackRetraceShort <= 0.55 &&
      current.close < pullbackLow
    ) {
      signals.push({
        id: "three-candle-low-volume-pullback-continuation-short",
        name: "three-candle low-volume pullback continuation",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: pullbackHigh,
        notes: [
          "A bearish force bar was followed by three counter-direction candles with declining volume.",
          "Price resolved below the pullback lows without using indicators.",
        ],
      });
    }

    if (
      upwardDerivativeFade &&
      volumeDerivativeFade &&
      current.high > oneBack.high &&
      current.close < oneBack.low &&
      currentClosePosition <= 0.35
    ) {
      signals.push({
        id: "derivative-exhaustion-reversal-short",
        name: "close-derivative exhaustion reversal",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(current.high, oneBack.high),
        notes: [
          "Three positive 5m close derivatives decelerated while volume faded.",
          "The current completed 5m candle made a marginal high but closed back below the prior candle low.",
        ],
      });
    }

    if (
      downwardDerivativeFade &&
      volumeDerivativeFade &&
      current.low < oneBack.low &&
      current.close > oneBack.high &&
      currentClosePosition >= 0.65
    ) {
      signals.push({
        id: "derivative-exhaustion-reversal-long",
        name: "close-derivative exhaustion reversal",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(current.low, oneBack.low),
        notes: [
          "Three negative 5m close derivatives decelerated while volume faded.",
          "The current completed 5m candle made a marginal low but closed back above the prior candle high.",
        ],
      });
    }

    if (
      oneBack.high <= twoBack.high &&
      oneBack.low >= twoBack.low &&
      oneBackRange <= twoBackRange * 0.6 &&
      current.close > oneBack.high &&
      currentClosePosition >= 0.7 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "inside-bar-expansion-retest-long",
        name: "inside-bar expansion retest",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: oneBack.low,
        notes: [
          "Contained 5m candle stored range before the next completed 5m candle closed through its high.",
          "Designed for maker retests of the broken inside-bar boundary.",
        ],
      });
    }

    if (
      oneBack.high <= twoBack.high &&
      oneBack.low >= twoBack.low &&
      oneBackRange <= twoBackRange * 0.6 &&
      current.close < oneBack.low &&
      currentClosePosition <= 0.3 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "inside-bar-expansion-retest-short",
        name: "inside-bar expansion retest",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: oneBack.high,
        notes: [
          "Contained 5m candle stored range before the next completed 5m candle closed through its low.",
          "Designed for maker retests of the broken inside-bar boundary.",
        ],
      });
    }

    const shelf = [threeBack, twoBack, oneBack];
    const shelfHigh = Math.max(...shelf.map((item) => item.high));
    const shelfLow = Math.min(...shelf.map((item) => item.low));
    const shelfAverageRange = average(shelf.map(range));
    const shelfHighCluster = Math.max(...shelf.map((item) => item.high)) - Math.min(...shelf.map((item) => item.high));
    const shelfLowCluster = Math.max(...shelf.map((item) => item.low)) - Math.min(...shelf.map((item) => item.low));
    const risingShelfLows = threeBack.low < twoBack.low && twoBack.low < oneBack.low;
    const fallingShelfHighs = threeBack.high > twoBack.high && twoBack.high > oneBack.high;

    if (
      risingShelfLows &&
      shelfHighCluster <= shelfAverageRange * 0.4 &&
      current.close > shelfHigh &&
      currentClosePosition >= 0.7 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "pressure-shelf-break-long",
        name: "pressure shelf break",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: shelfLow,
        notes: [
          "Three rising 5m lows compressed into a flat upper boundary before price closed above it.",
          "Tests whether pressure against a visible candle-only shelf produces favorable retests.",
        ],
      });
    }

    if (
      fallingShelfHighs &&
      shelfLowCluster <= shelfAverageRange * 0.4 &&
      current.close < shelfLow &&
      currentClosePosition <= 0.3 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "pressure-shelf-break-short",
        name: "pressure shelf break",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: shelfHigh,
        notes: [
          "Three falling 5m highs compressed into a flat lower boundary before price closed below it.",
          "Tests whether pressure against a visible candle-only shelf produces favorable retests.",
        ],
      });
    }

    const wickStack = [twoBack, oneBack, current];
    const wickStackAverageRange = average(wickStack.map(range));
    const wickStackLows = wickStack.map((item) => item.low);
    const wickStackHighs = wickStack.map((item) => item.high);
    const wickStackLowCluster = Math.max(...wickStackLows) - Math.min(...wickStackLows);
    const wickStackHighCluster = Math.max(...wickStackHighs) - Math.min(...wickStackHighs);
    const wickStackVolumeRatio = average(previousVolumes) === 0 ? 0 : average(wickStack.map((item) => item.volume)) / average(previousVolumes);
    const lowerWickStack =
      wickStack.every((item) => lowerWickRatio(item) >= 0.28) &&
      wickStack.filter((item) => closePosition(item) >= 0.5).length >= 2;
    const upperWickStack =
      wickStack.every((item) => upperWickRatio(item) >= 0.28) &&
      wickStack.filter((item) => closePosition(item) <= 0.5).length >= 2;

    if (
      lowerWickStack &&
      wickStackLowCluster <= wickStackAverageRange * 0.45 &&
      wickStackVolumeRatio >= 0.8
    ) {
      signals.push({
        id: "wick-stack-absorption-long",
        name: "wick-stack absorption",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(...wickStackLows),
        notes: [
          "Three completed 5m candles repeatedly left lower wicks around the same price area.",
          "Tests whether repeated candle-only rejection creates a positive long skew.",
        ],
      });
    }

    if (
      upperWickStack &&
      wickStackHighCluster <= wickStackAverageRange * 0.45 &&
      wickStackVolumeRatio >= 0.8
    ) {
      signals.push({
        id: "wick-stack-absorption-short",
        name: "wick-stack absorption",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(...wickStackHighs),
        notes: [
          "Three completed 5m candles repeatedly left upper wicks around the same price area.",
          "Tests whether repeated candle-only rejection creates a positive short skew.",
        ],
      });
    }

    const trapHistory = previous.slice(0, -1);
    const trapPriorHigh = Math.max(...trapHistory.map((item) => item.high));
    const trapPriorLow = Math.min(...trapHistory.map((item) => item.low));
    const oneBackVolumeRank = percentileRank(previousVolumes, oneBack.volume);

    if (
      oneBack.high > trapPriorHigh &&
      oneBack.close > trapPriorHigh &&
      oneBackVolumeRank <= 0.45 &&
      current.close < trapPriorHigh &&
      current.high <= oneBack.high &&
      currentClosePosition <= 0.45
    ) {
      signals.push({
        id: "low-volume-breakout-trap-short",
        name: "low-volume breakout trap",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: oneBack.high,
        notes: [
          "A low-volume 5m candle broke above recent highs, then the next completed 5m candle closed back inside.",
          "Fades weak candle-only breakouts that cannot hold the prior boundary.",
        ],
      });
    }

    if (
      oneBack.low < trapPriorLow &&
      oneBack.close < trapPriorLow &&
      oneBackVolumeRank <= 0.45 &&
      current.close > trapPriorLow &&
      current.low >= oneBack.low &&
      currentClosePosition >= 0.55
    ) {
      signals.push({
        id: "low-volume-breakout-trap-long",
        name: "low-volume breakout trap",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: oneBack.low,
        notes: [
          "A low-volume 5m candle broke below recent lows, then the next completed 5m candle closed back inside.",
          "Fades weak candle-only breakdowns that cannot hold the prior boundary.",
        ],
      });
    }

    const doubleAverageRange = average([range(threeBack), range(twoBack), range(oneBack)]);
    const doubleLowDistance = Math.abs(threeBack.low - oneBack.low);
    const doubleHighDistance = Math.abs(threeBack.high - oneBack.high);

    if (
      doubleAverageRange > 0 &&
      doubleLowDistance <= doubleAverageRange * 0.3 &&
      oneBack.low >= threeBack.low - doubleAverageRange * 0.15 &&
      current.close > twoBack.high &&
      currentClosePosition >= 0.65 &&
      volumeRank >= 0.5
    ) {
      signals.push({
        id: "micro-double-neckline-break-long",
        name: "micro double bottom neckline break",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(threeBack.low, oneBack.low),
        notes: [
          "Two recent 5m lows held a similar area before price closed through the intervening neckline high.",
          "Tests a simple candle-only reversal structure without oscillator confirmation.",
        ],
      });
    }

    if (
      doubleAverageRange > 0 &&
      doubleHighDistance <= doubleAverageRange * 0.3 &&
      oneBack.high <= threeBack.high + doubleAverageRange * 0.15 &&
      current.close < twoBack.low &&
      currentClosePosition <= 0.35 &&
      volumeRank >= 0.5
    ) {
      signals.push({
        id: "micro-double-neckline-break-short",
        name: "micro double top neckline break",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(threeBack.high, oneBack.high),
        notes: [
          "Two recent 5m highs held a similar area before price closed through the intervening neckline low.",
          "Tests a simple candle-only reversal structure without oscillator confirmation.",
        ],
      });
    }

    const retestAnchor = threeBack;
    const retestAnchorHistory = previous.slice(0, -3);
    const retestAverageRange = average(previousRanges);
    const retestTolerance = retestAverageRange * 0.25;
    const retestAnchorVolumeRank = percentileRank(previousVolumes, retestAnchor.volume);

    if (
      retestAnchorHistory.length > 0 &&
      retestAnchor.high > Math.max(...retestAnchorHistory.map((item) => item.high)) &&
      retestAnchorVolumeRank >= 0.65 &&
      Math.abs(current.high - retestAnchor.high) <= retestTolerance &&
      current.volume <= retestAnchor.volume * 0.7 &&
      currentClosePosition <= 0.45
    ) {
      signals.push({
        id: "volume-divergent-extreme-retest-short",
        name: "lower-volume retest of prior extreme",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(current.high, retestAnchor.high),
        notes: [
          "A later 5m candle retested a prior high-volume high with lower volume and failed to close strong.",
          "Tests whether the second probe has weaker candle-volume participation.",
        ],
      });
    }

    if (
      retestAnchorHistory.length > 0 &&
      retestAnchor.low < Math.min(...retestAnchorHistory.map((item) => item.low)) &&
      retestAnchorVolumeRank >= 0.65 &&
      Math.abs(current.low - retestAnchor.low) <= retestTolerance &&
      current.volume <= retestAnchor.volume * 0.7 &&
      currentClosePosition >= 0.55
    ) {
      signals.push({
        id: "volume-divergent-extreme-retest-long",
        name: "lower-volume retest of prior extreme",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(current.low, retestAnchor.low),
        notes: [
          "A later 5m candle retested a prior high-volume low with lower volume and failed to close weak.",
          "Tests whether the second probe has weaker candle-volume participation.",
        ],
      });
    }

    if (
      current.high > oneBack.high &&
      current.low < oneBack.low &&
      current.close > oneBack.high &&
      current.close > current.open &&
      currentClosePosition >= 0.7 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "outside-bar-continuation-long",
        name: "outside-bar continuation after hold",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: current.low,
        notes: [
          "The completed 5m candle swept both sides of the prior candle and closed above its high.",
          "Tests whether an outside bar that holds beyond the prior range can continue after a maker retest.",
        ],
      });
    }

    if (
      current.high > oneBack.high &&
      current.low < oneBack.low &&
      current.close < oneBack.low &&
      current.close < current.open &&
      currentClosePosition <= 0.3 &&
      volumeRank >= 0.55
    ) {
      signals.push({
        id: "outside-bar-continuation-short",
        name: "outside-bar continuation after hold",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: current.high,
        notes: [
          "The completed 5m candle swept both sides of the prior candle and closed below its low.",
          "Tests whether an outside bar that holds beyond the prior range can continue after a maker retest.",
        ],
      });
    }

    if (recentCompressed && rangeRank >= 0.8 && volumeRank >= 0.65 && currentClosePosition >= 0.75) {
      signals.push({
        id: "compression-expansion-breakout-long",
        name: "5m compression expansion breakout",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(current.low, previousLow),
        notes: ["Recent 5m compression followed by high-range, high-volume close near high."],
      });
    }

    if (recentCompressed && rangeRank >= 0.8 && volumeRank >= 0.65 && currentClosePosition <= 0.25) {
      signals.push({
        id: "compression-expansion-breakout-short",
        name: "5m compression expansion breakdown",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(current.high, previousHigh),
        notes: ["Recent 5m compression followed by high-range, high-volume close near low."],
      });
    }

    if (current.high > previousHigh && current.close < previousHigh && volumeRank >= 0.65 && currentClosePosition <= 0.55) {
      signals.push({
        id: "failed-breakout-absorption-short",
        name: "5m failed upside break absorption",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: current.high,
        notes: ["5m high sweep closed back inside prior range with elevated volume."],
      });
    }

    if (current.low < previousLow && current.close > previousLow && volumeRank >= 0.65 && currentClosePosition >= 0.45) {
      signals.push({
        id: "failed-breakdown-absorption-long",
        name: "5m failed downside break absorption",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: current.low,
        notes: ["5m low sweep closed back inside prior range with elevated volume."],
      });
    }

    const shock = fiveMinute[index - 2];
    const pullback = fiveMinute[index - 1];
    const shockRangeRank = percentileRank(previousRanges, range(shock));
    const shockVolumeRank = percentileRank(previousVolumes, shock.volume);
    const shockBodyRatio = range(shock) === 0 ? 0 : body(shock) / range(shock);
    const lowVolumePullback = pullback.volume < shock.volume * 0.65 && range(pullback) < range(shock) * 0.75;

    if (
      shock.close > shock.open &&
      shockRangeRank >= 0.7 &&
      shockVolumeRank >= 0.65 &&
      shockBodyRatio >= 0.5 &&
      lowVolumePullback &&
      current.close > pullback.high
    ) {
      signals.push({
        id: "shock-low-volume-pullback-long",
        name: "bull shock low-volume pullback continuation",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: pullback.low,
        notes: ["Bull shock bar followed by low-volume pullback and rebreak."],
      });
    }

    if (
      shock.close < shock.open &&
      shockRangeRank >= 0.7 &&
      shockVolumeRank >= 0.65 &&
      shockBodyRatio >= 0.5 &&
      lowVolumePullback &&
      current.close < pullback.low
    ) {
      signals.push({
        id: "shock-low-volume-pullback-short",
        name: "bear shock low-volume pullback continuation",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: pullback.high,
        notes: ["Bear shock bar followed by low-volume pullback and rebreak."],
      });
    }

    const prior = fiveMinute[index - 1];
    const priorRangeRank = percentileRank(previousRanges, range(prior));
    const priorVolumeRank = percentileRank(previousVolumes, prior.volume);
    const anchor = fiveMinute[index - 2];
    const follow = fiveMinute[index - 1];
    const anchorRange = range(anchor);
    const followRange = range(follow);
    const anchorBodyRatio = anchorRange === 0 ? 0 : body(anchor) / anchorRange;
    const anchorRangeRank = percentileRank(previousRanges, anchorRange);
    const anchorVolumeRank = percentileRank(previousVolumes, anchor.volume);
    const followBodyRatio = followRange === 0 ? 0 : body(follow) / followRange;
    const anchorIsForceBar = anchorBodyRatio >= 0.65 && anchorRangeRank >= 0.75 && anchorVolumeRank >= 0.65;
    const followVolumeRatio = anchor.volume === 0 ? 0 : follow.volume / anchor.volume;

    if (
      anchorIsForceBar &&
      anchor.close > anchor.open &&
      follow.high <= anchor.high &&
      closePosition(follow) <= 0.45 &&
      followVolumeRatio >= 0.55 &&
      current.close < follow.low
    ) {
      signals.push({
        id: "post-body-exhaustion-reversal-short",
        name: "post-body force tilt reversal",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(anchor.high, follow.high),
        notes: [
          "Large bullish 5m body failed to extend; next candle closed weak with meaningful volume.",
          "Current 5m closed below the follow-up candle low, marking force tilt against the anchor bar.",
        ],
      });
    }

    if (
      anchorIsForceBar &&
      anchor.close < anchor.open &&
      follow.low >= anchor.low &&
      closePosition(follow) >= 0.55 &&
      followVolumeRatio >= 0.55 &&
      current.close > follow.high
    ) {
      signals.push({
        id: "post-body-exhaustion-reversal-long",
        name: "post-body force tilt reversal",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(anchor.low, follow.low),
        notes: [
          "Large bearish 5m body failed to extend; next candle closed strong with meaningful volume.",
          "Current 5m closed above the follow-up candle high, marking force tilt against the anchor bar.",
        ],
      });
    }

    if (
      anchorIsForceBar &&
      anchor.close > anchor.open &&
      follow.low >= anchor.open &&
      followBodyRatio <= 0.45 &&
      followVolumeRatio <= 0.85 &&
      current.close > Math.max(anchor.high, follow.high)
    ) {
      signals.push({
        id: "post-body-digestion-continuation-long",
        name: "post-body digestion continuation",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(anchor.low, follow.low),
        notes: [
          "Large bullish 5m body was followed by lower-volume digestion above the anchor open.",
          "Current 5m resolved above the digestion range.",
        ],
      });
    }

    if (
      anchorIsForceBar &&
      anchor.close < anchor.open &&
      follow.high <= anchor.open &&
      followBodyRatio <= 0.45 &&
      followVolumeRatio <= 0.85 &&
      current.close < Math.min(anchor.low, follow.low)
    ) {
      signals.push({
        id: "post-body-digestion-continuation-short",
        name: "post-body digestion continuation",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(anchor.high, follow.high),
        notes: [
          "Large bearish 5m body was followed by lower-volume digestion below the anchor open.",
          "Current 5m resolved below the digestion range.",
        ],
      });
    }

    const twoStepAnchor = fiveMinute[index - 3];
    const followOne = fiveMinute[index - 2];
    const followTwo = fiveMinute[index - 1];
    const twoStepAnchorRange = range(twoStepAnchor);
    const twoStepAnchorBodyRatio =
      twoStepAnchorRange === 0 ? 0 : body(twoStepAnchor) / twoStepAnchorRange;
    const twoStepAnchorRangeRank = percentileRank(previousRanges, twoStepAnchorRange);
    const twoStepAnchorVolumeRank = percentileRank(previousVolumes, twoStepAnchor.volume);
    const twoStepForceBar =
      twoStepAnchorBodyRatio >= 0.65 &&
      twoStepAnchorRangeRank >= 0.75 &&
      twoStepAnchorVolumeRank >= 0.65;
    const followTwoBodyRatio = range(followTwo) === 0 ? 0 : body(followTwo) / range(followTwo);
    const followPairVolumeRatio =
      twoStepAnchor.volume === 0 ? 0 : (followOne.volume + followTwo.volume) / twoStepAnchor.volume;
    const anchorMidpoint = twoStepAnchor.low + twoStepAnchorRange / 2;

    if (
      twoStepForceBar &&
      twoStepAnchor.close > twoStepAnchor.open &&
      followOne.high <= twoStepAnchor.high &&
      followTwo.high <= twoStepAnchor.high &&
      followTwo.close < anchorMidpoint &&
      followPairVolumeRatio >= 1 &&
      current.close < Math.min(followOne.low, followTwo.low)
    ) {
      signals.push({
        id: "post-body-two-candle-absorption-short",
        name: "two-candle absorption after force bar",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(twoStepAnchor.high, followOne.high, followTwo.high),
        notes: [
          "Large bullish 5m body was followed by two candles that failed to extend.",
          "Follow-up volume stayed meaningful and price broke below the two-candle absorption range.",
        ],
      });
    }

    if (
      twoStepForceBar &&
      twoStepAnchor.close < twoStepAnchor.open &&
      followOne.low >= twoStepAnchor.low &&
      followTwo.low >= twoStepAnchor.low &&
      followTwo.close > anchorMidpoint &&
      followPairVolumeRatio >= 1 &&
      current.close > Math.max(followOne.high, followTwo.high)
    ) {
      signals.push({
        id: "post-body-two-candle-absorption-long",
        name: "two-candle absorption after force bar",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(twoStepAnchor.low, followOne.low, followTwo.low),
        notes: [
          "Large bearish 5m body was followed by two candles that failed to extend.",
          "Follow-up volume stayed meaningful and price broke above the two-candle absorption range.",
        ],
      });
    }

    if (
      twoStepForceBar &&
      twoStepAnchor.close > twoStepAnchor.open &&
      followOne.low >= anchorMidpoint &&
      followTwo.low >= anchorMidpoint &&
      followTwoBodyRatio <= 0.45 &&
      followPairVolumeRatio <= 1.4 &&
      current.close > Math.max(followOne.high, followTwo.high)
    ) {
      signals.push({
        id: "post-body-quiet-retest-continuation-long",
        name: "quiet retest continuation after force bar",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(followOne.low, followTwo.low),
        notes: [
          "Large bullish 5m body was followed by two quiet retest candles above midpoint.",
          "Price resolved above the retest range, indicating continuation pressure.",
        ],
      });
    }

    if (
      twoStepForceBar &&
      twoStepAnchor.close < twoStepAnchor.open &&
      followOne.high <= anchorMidpoint &&
      followTwo.high <= anchorMidpoint &&
      followTwoBodyRatio <= 0.45 &&
      followPairVolumeRatio <= 1.4 &&
      current.close < Math.min(followOne.low, followTwo.low)
    ) {
      signals.push({
        id: "post-body-quiet-retest-continuation-short",
        name: "quiet retest continuation after force bar",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(followOne.high, followTwo.high),
        notes: [
          "Large bearish 5m body was followed by two quiet retest candles below midpoint.",
          "Price resolved below the retest range, indicating continuation pressure.",
        ],
      });
    }

    if (
      prior.close < prior.open &&
      priorRangeRank >= 0.75 &&
      priorVolumeRank >= 0.75 &&
      current.low >= prior.low &&
      closePosition(current) >= 0.6
    ) {
      signals.push({
        id: "high-volume-extreme-failure-long",
        name: "high-volume downside extreme failure",
        direction: "long",
        fiveMinuteIndex: index,
        stopPrice: Math.min(current.low, prior.low),
        notes: ["Large high-volume sell bar failed to continue lower."],
      });
    }

    if (
      prior.close > prior.open &&
      priorRangeRank >= 0.75 &&
      priorVolumeRank >= 0.75 &&
      current.high <= prior.high &&
      closePosition(current) <= 0.4
    ) {
      signals.push({
        id: "high-volume-extreme-failure-short",
        name: "high-volume upside extreme failure",
        direction: "short",
        fiveMinuteIndex: index,
        stopPrice: Math.max(current.high, prior.high),
        notes: ["Large high-volume buy bar failed to continue higher."],
      });
    }

    const intrabar = intrabarStats(oneMinute, current);
    if (intrabar) {
      const bars = intrabar.bars;
      const firstThree = bars.slice(0, 3);
      const lastThree = bars.slice(2);
      const earlyHigh = Math.max(...firstThree.map((bar) => bar.high));
      const earlyLow = Math.min(...firstThree.map((bar) => bar.low));
      const earlyOpenHigh = Math.max(...firstThree.map((bar) => bar.open));
      const earlyOpenLow = Math.min(...firstThree.map((bar) => bar.open));
      const earlyRange = earlyHigh - earlyLow;
      const midpoint = current.low + currentRange / 2;
      const lateVolume = bars[3].volume + bars[4].volume;
      const earlyVolume = bars[0].volume + bars[1].volume + bars[2].volume;
      const closesHoldAbovePriorLow = bars.slice(1).every((bar, barIndex) => bar.close >= bars[barIndex].low);
      const closesHoldBelowPriorHigh = bars.slice(1).every((bar, barIndex) => bar.close <= bars[barIndex].high);
      const firstFourBars = bars.slice(0, 4);
      const finalMinute = bars[4];
      const firstFourHigh = Math.max(...firstFourBars.map((bar) => bar.high));
      const firstFourLow = Math.min(...firstFourBars.map((bar) => bar.low));
      const firstFourEnvelope = firstFourHigh - firstFourLow;
      const finalMinuteHasMaxVolume = finalMinute.volume > Math.max(...firstFourBars.map((bar) => bar.volume));

      if (
        currentRange > 0 &&
        firstFourEnvelope <= currentRange * 0.35 &&
        finalMinuteHasMaxVolume &&
        finalMinute.high > firstFourHigh &&
        finalMinute.close <= firstFourHigh &&
        upperWickRatio(finalMinute) >= 0.55 &&
        currentClosePosition <= 0.45
      ) {
        signals.push({
          id: "intrabar-last-minute-thrust-failure-short",
          name: "1m last-minute thrust failure inside 5m candle",
          direction: "short",
          fiveMinuteIndex: index,
          stopPrice: current.high,
          notes: [
            "The first four 1m candles stayed narrow, then the final 1m candle made a high-volume upside thrust that closed back inside.",
            "Uses the 1m derivative path inside the completed 5m candle only.",
          ],
        });
      }

      if (
        currentRange > 0 &&
        firstFourEnvelope <= currentRange * 0.35 &&
        finalMinuteHasMaxVolume &&
        finalMinute.low < firstFourLow &&
        finalMinute.close >= firstFourLow &&
        lowerWickRatio(finalMinute) >= 0.55 &&
        currentClosePosition >= 0.55
      ) {
        signals.push({
          id: "intrabar-last-minute-thrust-failure-long",
          name: "1m last-minute thrust failure inside 5m candle",
          direction: "long",
          fiveMinuteIndex: index,
          stopPrice: current.low,
          notes: [
            "The first four 1m candles stayed narrow, then the final 1m candle made a high-volume downside thrust that closed back inside.",
            "Uses the 1m derivative path inside the completed 5m candle only.",
          ],
        });
      }

      if (
        currentRange > 0 &&
        intrabar.lowMinuteIndex <= 1 &&
        intrabar.maxVolumeIndex <= 2 &&
        bars[3].close > midpoint &&
        bars[4].close > midpoint &&
        bars[4].close > bars[2].high &&
        currentClosePosition >= 0.6
      ) {
        signals.push({
          id: "intrabar-early-climax-late-hold-long",
          name: "1m early climax late hold inside 5m candle",
          direction: "long",
          fiveMinuteIndex: index,
          stopPrice: current.low,
          notes: [
            "The 5m low and max-volume minute appeared early, then the last two 1m closes held above midpoint.",
            "Uses only the completed 1m path inside the completed 5m signal candle.",
          ],
        });
      }

      if (
        currentRange > 0 &&
        intrabar.highMinuteIndex <= 1 &&
        intrabar.maxVolumeIndex <= 2 &&
        bars[3].close < midpoint &&
        bars[4].close < midpoint &&
        bars[4].close < bars[2].low &&
        currentClosePosition <= 0.4
      ) {
        signals.push({
          id: "intrabar-early-climax-late-hold-short",
          name: "1m early climax late hold inside 5m candle",
          direction: "short",
          fiveMinuteIndex: index,
          stopPrice: current.high,
          notes: [
            "The 5m high and max-volume minute appeared early, then the last two 1m closes held below midpoint.",
            "Uses only the completed 1m path inside the completed 5m signal candle.",
          ],
        });
      }

      if (
        intrabar.greenCount >= 4 &&
        intrabar.risingCloseSteps >= 3 &&
        currentClosePosition >= 0.7 &&
        closesHoldAbovePriorLow
      ) {
        signals.push({
          id: "intrabar-stair-step-continuation-long",
          name: "1m intrabar stair-step continuation",
          direction: "long",
          fiveMinuteIndex: index,
          stopPrice: Math.min(...lastThree.map((bar) => bar.low)),
          notes: [
            "At least four of five 1m candles closed green with rising closes inside the 5m signal candle.",
            "No indicator inputs; only the 1m OHLC path inside the completed 5m candle.",
          ],
        });
      }

      if (
        intrabar.redCount >= 4 &&
        intrabar.fallingCloseSteps >= 3 &&
        currentClosePosition <= 0.3 &&
        closesHoldBelowPriorHigh
      ) {
        signals.push({
          id: "intrabar-stair-step-continuation-short",
          name: "1m intrabar stair-step continuation",
          direction: "short",
          fiveMinuteIndex: index,
          stopPrice: Math.max(...lastThree.map((bar) => bar.high)),
          notes: [
            "At least four of five 1m candles closed red with falling closes inside the 5m signal candle.",
            "No indicator inputs; only the 1m OHLC path inside the completed 5m candle.",
          ],
        });
      }

      if (
        intrabar.lowMinuteIndex <= 2 &&
        (bars[3].close > midpoint || bars[4].close > midpoint) &&
        bars[4].close > earlyOpenHigh
      ) {
        signals.push({
          id: "intrabar-sweep-reclaim-long",
          name: "1m sweep and reclaim inside 5m candle",
          direction: "long",
          fiveMinuteIndex: index,
          stopPrice: current.low,
          notes: [
            "Early 1m low sweep reclaimed the 5m midpoint and closed above early opens.",
            "Designed to test failed pressure with a structural stop at the swept low.",
          ],
        });
      }

      if (
        intrabar.highMinuteIndex <= 2 &&
        (bars[3].close < midpoint || bars[4].close < midpoint) &&
        bars[4].close < earlyOpenLow
      ) {
        signals.push({
          id: "intrabar-sweep-reclaim-short",
          name: "1m sweep and reclaim inside 5m candle",
          direction: "short",
          fiveMinuteIndex: index,
          stopPrice: current.high,
          notes: [
            "Early 1m high sweep reclaimed below the 5m midpoint and closed under early opens.",
            "Designed to test failed pressure with a structural stop at the swept high.",
          ],
        });
      }

      if (
        currentRange > 0 &&
        earlyRange <= currentRange * 0.45 &&
        bars[3].high > earlyHigh &&
        bars[4].close > bars[3].high &&
        closePosition(bars[4]) >= 0.7 &&
        lateVolume > earlyVolume
      ) {
        signals.push({
          id: "intrabar-late-expansion-breakout-long",
          name: "1m late expansion breakout inside 5m candle",
          direction: "long",
          fiveMinuteIndex: index,
          stopPrice: earlyLow,
          notes: [
            "First three 1m candles compressed, then late expansion closed through the breakout.",
            "Stop is the early compression low, not an indicator-derived level.",
          ],
        });
      }

      if (
        currentRange > 0 &&
        earlyRange <= currentRange * 0.45 &&
        bars[3].low < earlyLow &&
        bars[4].close < bars[3].low &&
        closePosition(bars[4]) <= 0.3 &&
        lateVolume > earlyVolume
      ) {
        signals.push({
          id: "intrabar-late-expansion-breakout-short",
          name: "1m late expansion breakout inside 5m candle",
          direction: "short",
          fiveMinuteIndex: index,
          stopPrice: earlyHigh,
          notes: [
            "First three 1m candles compressed, then late expansion closed through the breakdown.",
            "Stop is the early compression high, not an indicator-derived level.",
          ],
        });
      }
    }
  }
  return [...signals, ...detectMinedZoneSignals(fiveMinute)];
}

export function simulateBarrierTrade(input: BarrierTradeInput): BarrierTradeResult {
  const risk = Math.abs(input.entryPrice - input.stopPrice);
  if (risk <= 0) {
    return { pnlR: 0, rawPnlR: 0, costR: 0, exitReason: "timeout", barsHeld: 0 };
  }

  const targetPrice =
    input.direction === "long"
      ? input.entryPrice + risk * input.targetR
      : input.entryPrice - risk * input.targetR;
  const bars = input.oneMinuteCandles.slice(0, input.maxBars);
  const adverseCost = input.adverseTicks * input.tickSize * 2;
  const feeCost = input.entryPrice * input.feeRate * 2;
  const costR = (adverseCost + feeCost) / risk;

  for (let index = 0; index < bars.length; index += 1) {
    const current = bars[index];
    if (input.direction === "long") {
      const stopHit = current.low <= input.stopPrice;
      const targetHit = current.high >= targetPrice;
      if (stopHit) return { pnlR: -1 - costR, rawPnlR: -1, costR, exitReason: "stop", barsHeld: index + 1 };
      if (targetHit) return { pnlR: input.targetR - costR, rawPnlR: input.targetR, costR, exitReason: "target", barsHeld: index + 1 };
    } else {
      const stopHit = current.high >= input.stopPrice;
      const targetHit = current.low <= targetPrice;
      if (stopHit) return { pnlR: -1 - costR, rawPnlR: -1, costR, exitReason: "stop", barsHeld: index + 1 };
      if (targetHit) return { pnlR: input.targetR - costR, rawPnlR: input.targetR, costR, exitReason: "target", barsHeld: index + 1 };
    }
  }

  const last = bars[bars.length - 1];
  if (!last) {
    return { pnlR: -costR, rawPnlR: 0, costR, exitReason: "timeout", barsHeld: 0 };
  }

  const rawPnlR =
    input.direction === "long"
      ? (last.close - input.entryPrice) / risk
      : (input.entryPrice - last.close) / risk;
  return { pnlR: rawPnlR - costR, rawPnlR, costR, exitReason: "timeout", barsHeld: bars.length };
}

function replayEntryPrice(mode: ReplayEntryMode, direction: TradeDirection, signalCandle: Candle): number {
  const signalRange = range(signalCandle);
  if (mode === "limit-signal-close") return signalCandle.close;
  if (mode === "limit-quarter-pullback") {
    return direction === "long"
      ? signalCandle.close - signalRange * 0.25
      : signalCandle.close + signalRange * 0.25;
  }
  if (mode === "limit-half-pullback") {
    return direction === "long"
      ? signalCandle.close - signalRange * 0.5
      : signalCandle.close + signalRange * 0.5;
  }
  return signalCandle.close;
}

export function simulateReplayTrade(input: ReplayTradeInput): BarrierTradeResult | null {
  const firstReplayBar = input.oneMinuteCandles[0];
  if (!firstReplayBar) return null;
  const entryPrice =
    input.entryMode === "next-open"
      ? firstReplayBar.open
      : replayEntryPrice(input.entryMode, input.direction, input.signalCandle);
  const entryWaitBars = input.entryMode === "next-open" ? 1 : Math.max(1, input.entryWaitBars);
  const entryFillBuffer = Math.max(0, input.entryFillBufferTicks ?? 0) * input.tickSize;
  let fillIndex = -1;

  for (let index = 0; index < Math.min(entryWaitBars, input.oneMinuteCandles.length); index += 1) {
    const current = input.oneMinuteCandles[index];
    const filled =
      input.entryMode === "next-open"
        ? true
        : input.direction === "long"
          ? current.low <= entryPrice - entryFillBuffer
          : current.high >= entryPrice + entryFillBuffer;
    if (filled) {
      fillIndex = index;
      break;
    }
  }

  if (fillIndex === -1) return null;

  const replayBars = input.oneMinuteCandles.slice(fillIndex, fillIndex + input.maxBars);
  if (input.entryMode !== "next-open" && replayBars[0]) {
    replayBars[0] =
      input.direction === "long"
        ? { ...replayBars[0], high: Math.min(replayBars[0].high, entryPrice) }
        : { ...replayBars[0], low: Math.max(replayBars[0].low, entryPrice) };
  }

  const result = simulateBarrierTrade({
    direction: input.direction,
    entryPrice,
    stopPrice: input.stopPrice,
    targetR: input.targetR,
    maxBars: input.maxBars,
    oneMinuteCandles: replayBars,
    feeRate: input.feeRate,
    tickSize: input.tickSize,
    adverseTicks: input.adverseTicks,
  });

  return {
    ...result,
    entryPrice,
    entryFilled: true,
    entryMode: input.entryMode,
  };
}

export function computeKellyRisk(input: KellyRiskInput): KellyRiskResult {
  if (input.payoffRatio <= 0 || input.winRate <= 0 || input.winRate >= 1) {
    return { fullKelly: 0, recommendedRiskPct: 0 };
  }
  const fullKelly = Math.max(0, input.winRate - (1 - input.winRate) / input.payoffRatio);
  return {
    fullKelly,
    recommendedRiskPct: Math.min(fullKelly * input.kellyFraction, input.riskCapPct),
  };
}

function summarizeStrategy(
  signal: Pick<Signal, "id" | "name" | "direction" | "notes">,
  entryMode: ReplayEntryMode,
  targetR: number,
  maxHoldFiveMinuteBars: number,
  trades: BarrierTradeResult[],
  submittedOrders: number,
  config: ResearchConfig,
): StrategyReport {
  const wins = trades.filter((trade) => trade.pnlR > 0);
  const losses = trades.filter((trade) => trade.pnlR < 0);
  const sumWins = wins.reduce((sum, trade) => sum + trade.pnlR, 0);
  const sumLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlR, 0));
  const winRate = trades.length === 0 ? 0 : wins.length / trades.length;
  const averageWin = wins.length === 0 ? 0 : sumWins / wins.length;
  const averageLoss = losses.length === 0 ? 0 : sumLosses / losses.length;
  const payoffRatio = averageLoss === 0 ? 0 : averageWin / averageLoss;
  const expectancyR = trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.pnlR, 0) / trades.length;
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Number.POSITIVE_INFINITY : 0) : sumWins / sumLosses;
  const fillRate = submittedOrders === 0 ? 0 : trades.length / submittedOrders;
  const kelly = computeKellyRisk({
    winRate,
    payoffRatio,
    kellyFraction: config.kellyFraction,
    riskCapPct: config.riskCapPct,
  });
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of trades) {
    equity += trade.pnlR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  return {
    id: `${signal.id}:entry-${entryMode}:target-${targetR}:hold-${maxHoldFiveMinuteBars}`,
    name: signal.name,
    direction: signal.direction,
    entryMode,
    signals: submittedOrders,
    filledTrades: trades.length,
    missedTrades: Math.max(0, submittedOrders - trades.length),
    fillRate,
    targetR,
    maxHoldFiveMinuteBars,
    trades: trades.length,
    winRate,
    payoffRatio,
    expectancyR,
    profitFactor,
    maxDrawdownR,
    fullKelly: kelly.fullKelly,
    recommendedRiskPct: kelly.recommendedRiskPct,
    accepted:
      trades.length >= config.minTrades &&
      fillRate >= (config.minFillRate ?? 0) &&
      expectancyR > 0 &&
      profitFactor >= 1.15 &&
      kelly.recommendedRiskPct > 0,
    notes: signal.notes,
  };
}

function evaluateSignals(
  oneMinute: Candle[],
  fiveMinute: FiveMinuteCandle[],
  signals: Signal[],
  config: ResearchConfig,
): StrategyReport[] {
  const reports: StrategyReport[] = [];
  const grouped = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = `${signal.id}:${signal.direction}`;
    grouped.set(key, [...(grouped.get(key) ?? []), signal]);
  }

  for (const signalGroup of grouped.values()) {
    const template = signalGroup[0];
    const entryModes: ReplayEntryMode[] =
      config.entryModes && config.entryModes.length > 0 ? config.entryModes : ["next-open"];
    for (const entryMode of entryModes) {
      for (const targetR of [1, 1.5, 2, 3]) {
        for (const maxHoldFiveMinuteBars of [1, 2, 3, 6]) {
          const trades: BarrierTradeResult[] = [];
          let submittedOrders = 0;
          for (const signal of signalGroup) {
            const signalCandle = fiveMinute[signal.fiveMinuteIndex];
            const sourceEndIndex = signalCandle.sourceEndIndex;
            const entryIndex = sourceEndIndex + 1;
            const entry = oneMinute[entryIndex];
            if (!entry) continue;
            const entryWaitBars = entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
            const entryPrice =
              entryMode === "next-open"
                ? entry.open
                : replayEntryPrice(entryMode, signal.direction, signalCandle);
            const risk =
              signal.direction === "long"
                ? entryPrice - signal.stopPrice
                : signal.stopPrice - entryPrice;
            if (risk < config.tickSize * 2) continue;
            if (risk / entryPrice < config.minRiskPct) continue;
            submittedOrders += 1;
            const trade = simulateReplayTrade({
              direction: signal.direction,
              entryMode,
              signalCandle,
              stopPrice: signal.stopPrice,
              targetR,
              maxBars: maxHoldFiveMinuteBars * 5,
              entryWaitBars,
              oneMinuteCandles: oneMinute.slice(
                entryIndex,
                entryIndex + entryWaitBars + maxHoldFiveMinuteBars * 5,
              ),
              entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
              feeRate: config.feeRate,
              tickSize: config.tickSize,
              adverseTicks: config.adverseTicks,
            });
            if (trade) trades.push(trade);
          }
          reports.push(summarizeStrategy(template, entryMode, targetR, maxHoldFiveMinuteBars, trades, submittedOrders, config));
        }
      }
    }
  }

  return reports.sort((left, right) => {
    if (Number.isFinite(right.expectancyR - left.expectancyR)) return right.expectancyR - left.expectancyR;
    return right.trades - left.trades;
  });
}

function summarizeEdgeZone(
  bucket: {
    strategyId: string;
    variantId: string;
    zone: EdgeZoneLabel;
    direction: TradeDirection;
    entryMode: ReplayEntryMode;
    targetR: number;
    maxHoldFiveMinuteBars: number;
    submittedOrders: number;
    trades: BarrierTradeResult[];
  },
): EdgeZoneReportRow {
  const wins = bucket.trades.filter((trade) => trade.pnlR > 0);
  const losses = bucket.trades.filter((trade) => trade.pnlR < 0);
  const sumWins = wins.reduce((sum, trade) => sum + trade.pnlR, 0);
  const sumLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlR, 0));
  const winRate = bucket.trades.length === 0 ? 0 : wins.length / bucket.trades.length;
  const averageWin = wins.length === 0 ? 0 : sumWins / wins.length;
  const averageLoss = losses.length === 0 ? 0 : sumLosses / losses.length;
  const payoffRatio = averageLoss === 0 ? 0 : averageWin / averageLoss;
  const expectancyR =
    bucket.trades.length === 0
      ? 0
      : bucket.trades.reduce((sum, trade) => sum + trade.pnlR, 0) / bucket.trades.length;
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Number.POSITIVE_INFINITY : 0) : sumWins / sumLosses;
  const fillRate = bucket.submittedOrders === 0 ? 0 : bucket.trades.length / bucket.submittedOrders;
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of bucket.trades) {
    equity += trade.pnlR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  return {
    strategyId: bucket.strategyId,
    variantId: bucket.variantId,
    zoneId: bucket.zone.zoneId,
    dimension: bucket.zone.dimension,
    bucket: bucket.zone.bucket,
    direction: bucket.direction,
    entryMode: bucket.entryMode,
    targetR: bucket.targetR,
    maxHoldFiveMinuteBars: bucket.maxHoldFiveMinuteBars,
    signals: bucket.submittedOrders,
    filledTrades: bucket.trades.length,
    missedTrades: Math.max(0, bucket.submittedOrders - bucket.trades.length),
    fillRate,
    trades: bucket.trades.length,
    winRate,
    payoffRatio,
    expectancyR,
    profitFactor,
    maxDrawdownR,
  };
}

export function buildBtcusdtEdgeZoneReport(
  oneMinuteCandles: Candle[],
  options: EdgeZoneOptions = {},
): EdgeZoneReport {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const signals = detectSignals(fiveMinute, oneMinuteCandles).filter((signal) =>
    options.strategyIdPrefix ? signal.id.startsWith(options.strategyIdPrefix) : true,
  );
  const entryModes: ReplayEntryMode[] =
    config.entryModes && config.entryModes.length > 0 ? config.entryModes : ["next-open"];
  const targetRs = options.targetRs ?? [1, 1.5, 2, 3];
  const maxHoldValues = options.maxHoldFiveMinuteBars ?? [1, 2, 3, 6];
  const minZoneTrades = options.minZoneTrades ?? config.minTrades;
  const buckets = new Map<
    string,
    {
      strategyId: string;
      variantId: string;
      zone: EdgeZoneLabel;
      direction: TradeDirection;
      entryMode: ReplayEntryMode;
      targetR: number;
      maxHoldFiveMinuteBars: number;
      submittedOrders: number;
      trades: BarrierTradeResult[];
    }
  >();

  for (const signal of signals) {
    const signalCandle = fiveMinute[signal.fiveMinuteIndex];
    const sourceEndIndex = signalCandle.sourceEndIndex;
    const entryIndex = sourceEndIndex + 1;
    const entry = oneMinuteCandles[entryIndex];
    if (!entry) continue;
    const zones = edgeZoneLabels(fiveMinute, signal.fiveMinuteIndex);

    for (const entryMode of entryModes) {
      const entryWaitBars = entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
      const entryPrice =
        entryMode === "next-open" ? entry.open : replayEntryPrice(entryMode, signal.direction, signalCandle);
      const risk = signal.direction === "long" ? entryPrice - signal.stopPrice : signal.stopPrice - entryPrice;
      if (risk < config.tickSize * 2) continue;
      if (risk / entryPrice < config.minRiskPct) continue;

      for (const targetR of targetRs) {
        for (const maxHoldFiveMinuteBars of maxHoldValues) {
          const variantId = `${signal.id}:entry-${entryMode}:target-${targetR}:hold-${maxHoldFiveMinuteBars}`;
          const trade = simulateReplayTrade({
            direction: signal.direction,
            entryMode,
            signalCandle,
            stopPrice: signal.stopPrice,
            targetR,
            maxBars: maxHoldFiveMinuteBars * 5,
            entryWaitBars,
            oneMinuteCandles: oneMinuteCandles.slice(
              entryIndex,
              entryIndex + entryWaitBars + maxHoldFiveMinuteBars * 5,
            ),
            entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
            feeRate: config.feeRate,
            tickSize: config.tickSize,
            adverseTicks: config.adverseTicks,
          });

          for (const zone of zones) {
            const key = `${variantId}:${zone.zoneId}`;
            const bucket =
              buckets.get(key) ??
              {
                strategyId: signal.id,
                variantId,
                zone,
                direction: signal.direction,
                entryMode,
                targetR,
                maxHoldFiveMinuteBars,
                submittedOrders: 0,
                trades: [],
              };
            bucket.submittedOrders += 1;
            if (trade) bucket.trades.push(trade);
            buckets.set(key, bucket);
          }
        }
      }
    }
  }

  const zones = [...buckets.values()]
    .map(summarizeEdgeZone)
    .filter((row) => row.trades >= minZoneTrades)
    .sort((left, right) => {
      if (right.expectancyR !== left.expectancyR) return right.expectancyR - left.expectancyR;
      return right.trades - left.trades;
    });

  return {
    sourceInterval: "1m",
    signalInterval: "5m",
    candles: {
      oneMinute: oneMinuteCandles.length,
      fiveMinute: fiveMinute.length,
    },
    config,
    assumptions: [
      "Edge zones are derived only from completed OHLCV candles.",
      "Zone labels use 5m range rank, volume rank, body ratio, close position, body direction, and recent candle drift.",
      "Each signal is replayed with the same future-blind maker-limit engine used by the strategy report.",
      "Unfilled maker-limit orders remain missed orders inside each zone's fill-rate calculation.",
    ],
    zones,
  };
}

interface StrategylessAtom {
  id: string;
  label: string;
  dimension: string;
  bucket: string;
}

interface StrategylessConditionSet {
  conditionId: string;
  conditions: string[];
}

interface StrategylessRawBucket {
  conditionId: string;
  conditions: string[];
  direction: TradeDirection;
  fiveMinuteIndexes: number[];
}

function bucketEarlyMiddleLate(index: number, length: number): string {
  if (length <= 1) return "middle";
  const ratio = index / (length - 1);
  if (ratio <= 0.25) return "early";
  if (ratio >= 0.75) return "late";
  return "middle";
}

function pushUniqueStrategylessAtom(target: StrategylessAtom[], atom: StrategylessAtom): void {
  if (!target.some((item) => item.id === atom.id)) target.push(atom);
}

function strategylessAtoms(oneMinute: Candle[], fiveMinute: FiveMinuteCandle[], index: number): StrategylessAtom[] {
  const current = fiveMinute[index];
  const previous = previousWindow(fiveMinute, index, 24);
  const labels = edgeZoneLabels(fiveMinute, index).filter((label) => !label.zoneId.includes("+"));
  const atoms: StrategylessAtom[] = labels.map((label) => ({
    id: label.zoneId,
    label: label.zoneId,
    dimension: label.dimension,
    bucket: label.bucket,
  }));

  const stats = intrabarStats(oneMinute, current);
  if (stats) {
    const closePath =
      stats.risingCloseSteps >= 4
        ? "mostlyUp"
        : stats.fallingCloseSteps >= 4
          ? "mostlyDown"
          : stats.risingCloseSteps > stats.fallingCloseSteps
            ? "upBias"
            : stats.fallingCloseSteps > stats.risingCloseSteps
              ? "downBias"
              : "mixed";
    pushUniqueStrategylessAtom(atoms, {
      id: `intrabarClosePath:${closePath}`,
      label: `intrabarClosePath:${closePath}`,
      dimension: "intrabarClosePath",
      bucket: closePath,
    });
    pushUniqueStrategylessAtom(atoms, {
      id: `intrabarMaxVolumeMinute:${bucketEarlyMiddleLate(stats.maxVolumeIndex, stats.bars.length)}`,
      label: `intrabarMaxVolumeMinute:${bucketEarlyMiddleLate(stats.maxVolumeIndex, stats.bars.length)}`,
      dimension: "intrabarMaxVolumeMinute",
      bucket: bucketEarlyMiddleLate(stats.maxVolumeIndex, stats.bars.length),
    });
    pushUniqueStrategylessAtom(atoms, {
      id: `intrabarHighMinute:${bucketEarlyMiddleLate(stats.highMinuteIndex, stats.bars.length)}`,
      label: `intrabarHighMinute:${bucketEarlyMiddleLate(stats.highMinuteIndex, stats.bars.length)}`,
      dimension: "intrabarHighMinute",
      bucket: bucketEarlyMiddleLate(stats.highMinuteIndex, stats.bars.length),
    });
    pushUniqueStrategylessAtom(atoms, {
      id: `intrabarLowMinute:${bucketEarlyMiddleLate(stats.lowMinuteIndex, stats.bars.length)}`,
      label: `intrabarLowMinute:${bucketEarlyMiddleLate(stats.lowMinuteIndex, stats.bars.length)}`,
      dimension: "intrabarLowMinute",
      bucket: bucketEarlyMiddleLate(stats.lowMinuteIndex, stats.bars.length),
    });
    const firstHalfVolume = stats.bars.slice(0, 2).reduce((sum, item) => sum + item.volume, 0);
    const secondHalfVolume = stats.bars.slice(3).reduce((sum, item) => sum + item.volume, 0);
    const volumeShift =
      secondHalfVolume > firstHalfVolume * 1.25
        ? "lateRising"
        : firstHalfVolume > secondHalfVolume * 1.25
          ? "earlyFading"
          : "balanced";
    pushUniqueStrategylessAtom(atoms, {
      id: `intrabarVolumeShift:${volumeShift}`,
      label: `intrabarVolumeShift:${volumeShift}`,
      dimension: "intrabarVolumeShift",
      bucket: volumeShift,
    });

    const volumes = stats.bars.map((bar) => bar.volume);
    const ranges = stats.bars.map(range);
    const signedBodies = stats.bars.map(signedBody);
    const closeDeltas = stats.bars.slice(1).map((bar, step) => bar.close - stats.bars[step].close);
    const volumeSlopeRatio = linearSlope(volumes) / Math.max(average(volumes), 1e-9);
    const rangeSlopeRatio = linearSlope(ranges) / Math.max(average(ranges), 1e-9);
    const bodySlope = linearSlope(signedBodies);
    const averageIntrabarRange = Math.max(average(ranges), 1e-9);
    const totalSignedBody = signedBodies.reduce((sum, value) => sum + value, 0);
    const volumeSlope =
      volumeSlopeRatio >= 0.12 ? "rising" : volumeSlopeRatio <= -0.12 ? "falling" : "flat";
    const rangeSlope =
      rangeSlopeRatio >= 0.12 ? "expanding" : rangeSlopeRatio <= -0.12 ? "contracting" : "flat";
    const bodyMomentum =
      bodySlope >= averageIntrabarRange * 0.2
        ? totalSignedBody >= 0
          ? "buildingBull"
          : "fadingBear"
        : bodySlope <= -averageIntrabarRange * 0.2
          ? totalSignedBody <= 0
            ? "buildingBear"
            : "fadingBull"
          : "flat";
    const firstLeg = stats.bars[1].close - stats.bars[0].open;
    const finalLeg = stats.bars[stats.bars.length - 1].close - stats.bars[1].close;
    const reversalThreshold = Math.max(averageIntrabarRange * 0.5, range(current) * 0.2);
    const intrabarReversal =
      firstLeg >= reversalThreshold && finalLeg <= -reversalThreshold
        ? "upThenDown"
        : firstLeg <= -reversalThreshold && finalLeg >= reversalThreshold
          ? "downThenUp"
          : "none";
    const extremeOrder =
      stats.highMinuteIndex < stats.lowMinuteIndex
        ? "highBeforeLow"
        : stats.lowMinuteIndex < stats.highMinuteIndex
          ? "lowBeforeHigh"
          : "sameMinute";
    const closeSlope = linearSlope(stats.bars.map((bar) => bar.close));
    const closeAcceleration = linearSlope(closeDeltas);
    const closeAccelerationBucket =
      Math.abs(closeAcceleration) < averageIntrabarRange * 0.08
        ? "steady"
        : closeAcceleration > 0 && closeSlope > 0
          ? "acceleratingUp"
          : closeAcceleration < 0 && closeSlope < 0
            ? "acceleratingDown"
            : closeAcceleration > 0
              ? "deceleratingDown"
              : "deceleratingUp";
    const effortResult =
      volumeSlope === "rising" && totalSignedBody > averageIntrabarRange
        ? "risingVolumeUp"
        : volumeSlope === "rising" && totalSignedBody < -averageIntrabarRange
          ? "risingVolumeDown"
          : volumeSlope === "falling" && Math.abs(totalSignedBody) > averageIntrabarRange
            ? "quietDirectional"
            : "balanced";

    const derivativeAtoms = [
      ["intrabarVolumeSlope", volumeSlope],
      ["intrabarRangeSlope", rangeSlope],
      ["intrabarBodyMomentum", bodyMomentum],
      ["intrabarReversal", intrabarReversal],
      ["intrabarExtremeOrder", extremeOrder],
      ["intrabarCloseAcceleration", closeAccelerationBucket],
      ["intrabarEffortResult", effortResult],
    ] as const;
    for (const [dimension, bucket] of derivativeAtoms) {
      pushUniqueStrategylessAtom(atoms, {
        id: `${dimension}:${bucket}`,
        label: `${dimension}:${bucket}`,
        dimension,
        bucket,
      });
    }
  }

  const upperWick = upperWickRatio(current);
  const lowerWick = lowerWickRatio(current);
  const wickImbalance =
    upperWick >= lowerWick + 0.2 ? "upperDominant" : lowerWick >= upperWick + 0.2 ? "lowerDominant" : "balanced";
  pushUniqueStrategylessAtom(atoms, {
    id: `wickImbalance:${wickImbalance}`,
    label: `wickImbalance:${wickImbalance}`,
    dimension: "wickImbalance",
    bucket: wickImbalance,
  });

  if (previous.length >= 6) {
    const previousHigh = Math.max(...previous.map((item) => item.high));
    const previousLow = Math.min(...previous.map((item) => item.low));
    const breakState =
      current.high > previousHigh && current.close <= previousHigh
        ? "failedHighBreak"
        : current.low < previousLow && current.close >= previousLow
          ? "failedLowBreak"
          : current.close > previousHigh
            ? "heldHighBreak"
            : current.close < previousLow
              ? "heldLowBreak"
              : "inside";
    pushUniqueStrategylessAtom(atoms, {
      id: `structureBreak:${breakState}`,
      label: `structureBreak:${breakState}`,
      dimension: "structureBreak",
      bucket: breakState,
    });

    const recentThree = previous.slice(-3);
    const recentRange = recentThree.reduce((sum, item) => sum + range(item), 0);
    const currentRange = range(current);
    const compressionState =
      recentRange > 0 && currentRange <= average(recentThree.map(range)) * 0.75
        ? "compressing"
        : currentRange >= average(recentThree.map(range)) * 1.35
          ? "expanding"
          : "normal";
    pushUniqueStrategylessAtom(atoms, {
      id: `localRangeState:${compressionState}`,
      label: `localRangeState:${compressionState}`,
      dimension: "localRangeState",
      bucket: compressionState,
    });
  }

  return atoms;
}

function strategylessConditionSets(
  atoms: StrategylessAtom[],
  maxConditions: number,
  maxSets: number,
): StrategylessConditionSet[] {
  const sets: StrategylessConditionSet[] = [];
  const canonical = new Set<string>();
  const pushSet = (items: StrategylessAtom[]) => {
    const sorted = [...items].sort((left, right) => left.id.localeCompare(right.id));
    const conditionId = sorted.map((item) => item.id).join("+");
    if (canonical.has(conditionId)) return;
    canonical.add(conditionId);
    sets.push({
      conditionId,
      conditions: sorted.map((item) => item.label),
    });
  };

  for (const atom of atoms) {
    pushSet([atom]);
    if (sets.length >= maxSets) return sets;
  }

  if (maxConditions >= 2) {
    for (let left = 0; left < atoms.length; left += 1) {
      for (let right = left + 1; right < atoms.length; right += 1) {
        if (atoms[left].dimension === atoms[right].dimension) continue;
        pushSet([atoms[left], atoms[right]]);
        if (sets.length >= maxSets) return sets;
      }
    }
  }

  return sets;
}

function summarizeStrategylessCandidate(bucket: {
  conditionId: string;
  conditions: string[];
  direction: TradeDirection;
  entryMode: ReplayEntryMode;
  targetR: number;
  holdMinutes: number;
  submittedOrders: number;
  trades: BarrierTradeResult[];
}, config: ResearchConfig): StrategylessOhlcvCandidateReport {
  const wins = bucket.trades.filter((trade) => trade.pnlR > 0);
  const losses = bucket.trades.filter((trade) => trade.pnlR < 0);
  const sumWins = wins.reduce((sum, trade) => sum + trade.pnlR, 0);
  const sumLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlR, 0));
  const winRate = bucket.trades.length === 0 ? 0 : wins.length / bucket.trades.length;
  const averageWin = wins.length === 0 ? 0 : sumWins / wins.length;
  const averageLoss = losses.length === 0 ? 0 : sumLosses / losses.length;
  const payoffRatio = averageLoss === 0 ? 0 : averageWin / averageLoss;
  const expectancyR =
    bucket.trades.length === 0
      ? 0
      : bucket.trades.reduce((sum, trade) => sum + trade.pnlR, 0) / bucket.trades.length;
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Number.POSITIVE_INFINITY : 0) : sumWins / sumLosses;
  const fillRate = bucket.submittedOrders === 0 ? 0 : bucket.trades.length / bucket.submittedOrders;
  const kelly = computeKellyRisk({
    winRate,
    payoffRatio,
    kellyFraction: config.kellyFraction,
    riskCapPct: config.riskCapPct,
  });
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of bucket.trades) {
    equity += trade.pnlR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  const profitFactorScore = Number.isFinite(profitFactor) ? Math.min(profitFactor, 5) : 5;
  const score =
    expectancyR *
    Math.log1p(bucket.trades.length) *
    Math.min(fillRate / 0.25, 1) *
    Math.max(0.25, Math.min(profitFactorScore / 1.5, 2));

  return {
    strategyFamily: "strategyless-ohlcv",
    variantId: `strategyless-ohlcv:${bucket.conditionId}:${bucket.direction}:entry-${bucket.entryMode}:target-${bucket.targetR}:hold-${bucket.holdMinutes}m`,
    conditionId: bucket.conditionId,
    conditions: bucket.conditions,
    direction: bucket.direction,
    entryMode: bucket.entryMode,
    targetR: bucket.targetR,
    holdMinutes: bucket.holdMinutes,
    submittedOrders: bucket.submittedOrders,
    filledTrades: bucket.trades.length,
    missedTrades: Math.max(0, bucket.submittedOrders - bucket.trades.length),
    fillRate,
    trades: bucket.trades.length,
    winRate,
    payoffRatio,
    expectancyR,
    profitFactor,
    maxDrawdownR,
    fullKelly: kelly.fullKelly,
    recommendedRiskPct: kelly.recommendedRiskPct,
    score,
  };
}

export function buildBtcusdtStrategylessOhlcvReport(
  oneMinuteCandles: Candle[],
  options: StrategylessOhlcvOptions = {},
): StrategylessOhlcvReport {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const entryModes: ReplayEntryMode[] =
    config.entryModes && config.entryModes.length > 0 ? config.entryModes : ["limit-signal-close"];
  const targetRs = [...new Set(options.targetRs ?? [1, 1.5, 2, 3, 4])].sort((left, right) => left - right);
  const holdMinutes = [...new Set(options.holdMinutes ?? [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 240, 360])]
    .filter((value) => Number.isFinite(value) && value >= 1)
    .map((value) => Math.floor(value))
    .sort((left, right) => left - right);
  const maxConditions = Math.max(1, Math.min(2, options.maxConditions ?? 2));
  const maxConditionSetsPerSignal = Math.max(1, options.maxConditionSetsPerSignal ?? 48);
  const minTrades = options.minTrades ?? config.minTrades;
  const minFillRate = options.minFillRate ?? config.minFillRate ?? 0;
  const minExpectancyR = options.minExpectancyR ?? Number.NEGATIVE_INFINITY;
  const minProfitFactor = options.minProfitFactor ?? 0;
  const maxCandidates = options.maxCandidates ?? 250;
  const maxRawBuckets = options.maxRawBuckets ?? 48;
  const rawBuckets = new Map<string, StrategylessRawBucket>();

  for (let index = 6; index < fiveMinute.length - 1; index += 1) {
    const atoms = strategylessAtoms(oneMinuteCandles, fiveMinute, index);
    const conditionSets = strategylessConditionSets(atoms, maxConditions, maxConditionSetsPerSignal);
    for (const conditionSet of conditionSets) {
      for (const direction of ["long", "short"] satisfies TradeDirection[]) {
        const key = `${conditionSet.conditionId}:${direction}`;
        const bucket =
          rawBuckets.get(key) ??
          {
            conditionId: conditionSet.conditionId,
            conditions: conditionSet.conditions,
            direction,
            fiveMinuteIndexes: [],
          };
        bucket.fiveMinuteIndexes.push(index);
        rawBuckets.set(key, bucket);
      }
    }
  }

  const eligibleRawBuckets = [...rawBuckets.values()]
    .filter((bucket) => bucket.fiveMinuteIndexes.length >= Math.max(1, Math.min(minTrades, 30)))
    .sort((left, right) => {
      if (right.fiveMinuteIndexes.length !== left.fiveMinuteIndexes.length) {
        return right.fiveMinuteIndexes.length - left.fiveMinuteIndexes.length;
      }
      return left.conditionId.localeCompare(right.conditionId);
    });
  const singleRawBuckets = eligibleRawBuckets.filter((bucket) => bucket.conditions.length === 1);
  const compositeRawBuckets = eligibleRawBuckets.filter((bucket) => bucket.conditions.length > 1);
  const singleLimit = Math.min(singleRawBuckets.length, Math.ceil(maxRawBuckets * 0.5));
  const selectedRawBuckets = [
    ...singleRawBuckets.slice(0, singleLimit),
    ...compositeRawBuckets.slice(0, Math.max(0, maxRawBuckets - singleLimit)),
  ];

  const candidateBuckets: Array<{
    conditionId: string;
    conditions: string[];
    direction: TradeDirection;
    entryMode: ReplayEntryMode;
    targetR: number;
    holdMinutes: number;
    submittedOrders: number;
    trades: BarrierTradeResult[];
  }> = [];

  for (const rawBucket of selectedRawBuckets) {
    for (const entryMode of entryModes) {
      for (const targetR of targetRs) {
        for (const holdMinuteValue of holdMinutes) {
          const bucket = {
            conditionId: rawBucket.conditionId,
            conditions: rawBucket.conditions,
            direction: rawBucket.direction,
            entryMode,
            targetR,
            holdMinutes: holdMinuteValue,
            submittedOrders: 0,
            trades: [] as BarrierTradeResult[],
          };
          for (const fiveMinuteIndex of rawBucket.fiveMinuteIndexes) {
            const signalCandle = fiveMinute[fiveMinuteIndex];
            const entryIndex = signalCandle.sourceEndIndex + 1;
            const entry = oneMinuteCandles[entryIndex];
            if (!entry) continue;
            const stopPrice = rawBucket.direction === "long" ? signalCandle.low : signalCandle.high;
            const entryWaitBars = entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
            const entryPrice =
              entryMode === "next-open" ? entry.open : replayEntryPrice(entryMode, rawBucket.direction, signalCandle);
            const risk = rawBucket.direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
            if (risk < config.tickSize * 2) continue;
            if (risk / entryPrice < config.minRiskPct) continue;
            bucket.submittedOrders += 1;
            const trade = simulateReplayTrade({
              direction: rawBucket.direction,
              entryMode,
              signalCandle,
              stopPrice,
              targetR,
              maxBars: holdMinuteValue,
              entryWaitBars,
              oneMinuteCandles: oneMinuteCandles.slice(entryIndex, entryIndex + entryWaitBars + holdMinuteValue),
              entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
              feeRate: config.feeRate,
              tickSize: config.tickSize,
              adverseTicks: config.adverseTicks,
            });
            if (trade) bucket.trades.push(trade);
          }
          candidateBuckets.push(bucket);
        }
      }
    }
  }

  const candidates = candidateBuckets
    .map((bucket) => summarizeStrategylessCandidate(bucket, config))
    .filter(
      (candidate) =>
        candidate.trades >= minTrades &&
        candidate.fillRate >= minFillRate &&
        candidate.expectancyR >= minExpectancyR &&
        candidate.profitFactor >= minProfitFactor,
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.expectancyR !== left.expectancyR) return right.expectancyR - left.expectancyR;
      return right.trades - left.trades;
    })
    .slice(0, maxCandidates);

  return {
    sourceInterval: "1m",
    contextInterval: "5m",
    candles: {
      oneMinute: oneMinuteCandles.length,
      fiveMinute: fiveMinute.length,
    },
    config,
    targetRs,
    holdMinutes,
    assumptions: [
      "No fixed strategy families: candidates are generated from OHLCV transform labels.",
      "Inputs are limited to completed 1m candles and completed 5m resamples built from those candles.",
      "Feature ranks and buckets are computed from prior candles only at the signal point.",
      "Maker-limit entry prices are fixed from completed signal candles before future bars are replayed.",
      "Hold time is expressed in one-minute bars and can extend beyond the 5m context horizon.",
      "If stop and target are both inside the same 1m candle, stop is assumed to fill first.",
    ],
    candidates,
  };
}

export function filterPayoffSkewZones(
  zones: EdgeZoneReportRow[],
  options: PayoffSkewFilterOptions,
): EdgeZoneReportRow[] {
  return zones
    .filter(
      (zone) =>
        zone.trades >= options.minTrades &&
        zone.winRate <= options.maxWinRate &&
        zone.payoffRatio >= options.minPayoffRatio &&
        zone.expectancyR >= options.minExpectancyR &&
        zone.profitFactor >= options.minProfitFactor &&
        zone.fillRate >= (options.minFillRate ?? 0),
    )
    .sort((left, right) => {
      const leftScore = left.expectancyR * left.payoffRatio * Math.sqrt(left.trades);
      const rightScore = right.expectancyR * right.payoffRatio * Math.sqrt(right.trades);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.trades - left.trades;
    });
}

export function buildBtcusdtEdgeZoneStressReport(
  oneMinuteCandles: Candle[],
  options: EdgeZoneStressOptions,
): EdgeZoneStressReport {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const signals = detectSignals(fiveMinute, oneMinuteCandles).filter((signal) => signal.id === options.strategyId);
  const targetR = options.targetR;
  const maxHoldFiveMinuteBars = options.maxHoldFiveMinuteBars;
  const variantId = `${options.strategyId}:entry-${options.entryMode}:target-${targetR}:hold-${maxHoldFiveMinuteBars}`;
  const tradeRows: Array<{
    signal: Signal;
    signalCandle: FiveMinuteCandle;
    entryOpenTime: number;
    trade: BarrierTradeResult;
  }> = [];
  let submittedOrders = 0;
  let direction: TradeDirection | null = null;

  for (const signal of signals) {
    const signalCandle = fiveMinute[signal.fiveMinuteIndex];
    const sourceEndIndex = signalCandle.sourceEndIndex;
    const entryIndex = sourceEndIndex + 1;
    const entry = oneMinuteCandles[entryIndex];
    if (!entry) continue;
    if (!edgeZoneLabels(fiveMinute, signal.fiveMinuteIndex).some((zone) => zone.zoneId === options.zoneId)) {
      continue;
    }

    const entryWaitBars = options.entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
    const entryPrice =
      options.entryMode === "next-open"
        ? entry.open
        : replayEntryPrice(options.entryMode, signal.direction, signalCandle);
    const risk = signal.direction === "long" ? entryPrice - signal.stopPrice : signal.stopPrice - entryPrice;
    if (risk < config.tickSize * 2) continue;
    if (risk / entryPrice < config.minRiskPct) continue;

    direction = signal.direction;
    submittedOrders += 1;
    const trade = simulateReplayTrade({
      direction: signal.direction,
      entryMode: options.entryMode,
      signalCandle,
      stopPrice: signal.stopPrice,
      targetR,
      maxBars: maxHoldFiveMinuteBars * 5,
      entryWaitBars,
      oneMinuteCandles: oneMinuteCandles.slice(
        entryIndex,
        entryIndex + entryWaitBars + maxHoldFiveMinuteBars * 5,
      ),
      entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
      feeRate: config.feeRate,
      tickSize: config.tickSize,
      adverseTicks: config.adverseTicks,
    });
    if (trade) {
      tradeRows.push({
        signal,
        signalCandle,
        entryOpenTime: entry.openTime,
        trade,
      });
    }
  }

  const trades = tradeRows.map((row) => row.trade);
  const wins = trades.filter((trade) => trade.pnlR > 0);
  const losses = trades.filter((trade) => trade.pnlR < 0);
  const sumWins = wins.reduce((sum, trade) => sum + trade.pnlR, 0);
  const sumLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlR, 0));
  const winRate = trades.length === 0 ? 0 : wins.length / trades.length;
  const averageWin = wins.length === 0 ? 0 : sumWins / wins.length;
  const averageLoss = losses.length === 0 ? 0 : sumLosses / losses.length;
  const payoffRatio = averageLoss === 0 ? 0 : averageWin / averageLoss;
  const expectancyR = trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.pnlR, 0) / trades.length;
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Number.POSITIVE_INFINITY : 0) : sumWins / sumLosses;
  const kelly = computeKellyRisk({
    winRate,
    payoffRatio,
    kellyFraction: config.kellyFraction,
    riskCapPct: config.riskCapPct,
  });
  const riskPct = options.riskPct ?? kelly.recommendedRiskPct;
  const initialEquity = options.initialEquity ?? 1;
  const positiveTradePnls = trades.map((trade) => trade.pnlR).filter((pnlR) => pnlR > 0);
  const topProfitTradeShare =
    sumWins === 0 || positiveTradePnls.length === 0 ? 0 : Math.max(...positiveTradePnls) / sumWins;

  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  const dailyPnlR = new Map<number, number>();
  const tradeLog: EdgeZoneStressTrade[] = [];

  for (const row of tradeRows) {
    const pnlR = row.trade.pnlR;
    equityR += pnlR;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
    equity = Math.max(0, equity * (1 + pnlR * riskPct));
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity === 0 ? 0 : (peakEquity - equity) / peakEquity;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    if (pnlR > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (pnlR < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    const dayIndex = Math.floor(row.entryOpenTime / 86_400_000);
    dailyPnlR.set(dayIndex, (dailyPnlR.get(dayIndex) ?? 0) + pnlR);
    tradeLog.push({
      signalOpenTime: row.signalCandle.openTime,
      entryOpenTime: row.entryOpenTime,
      pnlR,
      rawPnlR: row.trade.rawPnlR,
      exitReason: row.trade.exitReason,
      barsHeld: row.trade.barsHeld,
      entryPrice: row.trade.entryPrice,
      cumulativePnlR: equityR,
      equity,
      drawdownPct,
    });
  }

  const positiveDayPnls = [...dailyPnlR.values()].filter((pnlR) => pnlR > 0);
  const sumPositiveDays = positiveDayPnls.reduce((sum, pnlR) => sum + pnlR, 0);
  const topProfitDayShare =
    sumPositiveDays === 0 || positiveDayPnls.length === 0 ? 0 : Math.max(...positiveDayPnls) / sumPositiveDays;

  return {
    strategyId: options.strategyId,
    variantId,
    zoneId: options.zoneId,
    direction,
    entryMode: options.entryMode,
    targetR,
    maxHoldFiveMinuteBars,
    submittedOrders,
    missedTrades: Math.max(0, submittedOrders - trades.length),
    fillRate: submittedOrders === 0 ? 0 : trades.length / submittedOrders,
    trades: trades.length,
    winRate,
    payoffRatio,
    expectancyR,
    profitFactor,
    maxDrawdownR,
    fullKelly: kelly.fullKelly,
    recommendedRiskPct: kelly.recommendedRiskPct,
    riskPct,
    initialEquity,
    finalEquity: equity,
    returnPct: initialEquity === 0 ? 0 : (equity - initialEquity) / initialEquity,
    maxDrawdownPct,
    longestWinStreak,
    longestLossStreak,
    topProfitTradeShare,
    topProfitDayShare,
    tradeLog,
  };
}

function summarizeFragilitySlice(label: string, pnlRs: number[]): EdgeZoneFragilitySlice {
  const wins = pnlRs.filter((pnlR) => pnlR > 0);
  const losses = pnlRs.filter((pnlR) => pnlR < 0);
  const sumWins = wins.reduce((sum, pnlR) => sum + pnlR, 0);
  const sumLosses = Math.abs(losses.reduce((sum, pnlR) => sum + pnlR, 0));
  const averageWin = wins.length === 0 ? 0 : sumWins / wins.length;
  const averageLoss = losses.length === 0 ? 0 : sumLosses / losses.length;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownR = 0;

  for (const pnlR of pnlRs) {
    cumulative += pnlR;
    peak = Math.max(peak, cumulative);
    maxDrawdownR = Math.max(maxDrawdownR, peak - cumulative);
  }

  return {
    label,
    trades: pnlRs.length,
    winRate: pnlRs.length === 0 ? 0 : wins.length / pnlRs.length,
    payoffRatio: averageLoss === 0 ? (averageWin > 0 ? Number.POSITIVE_INFINITY : 0) : averageWin / averageLoss,
    expectancyR: pnlRs.length === 0 ? 0 : pnlRs.reduce((sum, pnlR) => sum + pnlR, 0) / pnlRs.length,
    profitFactor: sumLosses === 0 ? (sumWins > 0 ? Number.POSITIVE_INFINITY : 0) : sumWins / sumLosses,
    maxDrawdownR,
    totalPnlR: cumulative,
  };
}

function removeBestWinningTrades(trades: EdgeZoneStressTrade[], count: number): EdgeZoneStressTrade[] {
  const winningIndexes = trades
    .map((trade, index) => ({ index, pnlR: trade.pnlR }))
    .filter((row) => row.pnlR > 0)
    .sort((left, right) => right.pnlR - left.pnlR)
    .slice(0, count)
    .map((row) => row.index);
  const removed = new Set(winningIndexes);
  return trades.filter((_, index) => !removed.has(index));
}

function removeBestPositiveDay(trades: EdgeZoneStressTrade[]): EdgeZoneStressTrade[] {
  const dailyPnlR = new Map<number, number>();
  for (const trade of trades) {
    const dayIndex = Math.floor(trade.entryOpenTime / 86_400_000);
    dailyPnlR.set(dayIndex, (dailyPnlR.get(dayIndex) ?? 0) + trade.pnlR);
  }
  const bestDay = [...dailyPnlR.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!bestDay || bestDay[1] <= 0) return trades;
  return trades.filter((trade) => Math.floor(trade.entryOpenTime / 86_400_000) !== bestDay[0]);
}

export function buildBtcusdtEdgeZoneFragilityReport(
  oneMinuteCandles: Candle[],
  options: EdgeZoneStressOptions,
): EdgeZoneFragilityReport {
  const stress = buildBtcusdtEdgeZoneStressReport(oneMinuteCandles, options);
  const tradeLog = stress.tradeLog;
  const pnlRs = tradeLog.map((trade) => trade.pnlR);
  const positiveTrades = tradeLog.filter((trade) => trade.pnlR > 0).length;
  const topFivePercentWinnerCount = positiveTrades === 0 ? 0 : Math.max(1, Math.ceil(positiveTrades * 0.05));
  const halfIndex = Math.ceil(tradeLog.length / 2);

  const baseline = summarizeFragilitySlice("baseline", pnlRs);
  const withoutBestTrade = summarizeFragilitySlice(
    "withoutBestTrade",
    removeBestWinningTrades(tradeLog, positiveTrades === 0 ? 0 : 1).map((trade) => trade.pnlR),
  );
  const withoutBestFivePercentWinners = summarizeFragilitySlice(
    "withoutBestFivePercentWinners",
    removeBestWinningTrades(tradeLog, topFivePercentWinnerCount).map((trade) => trade.pnlR),
  );
  const withoutBestDay = summarizeFragilitySlice("withoutBestDay", removeBestPositiveDay(tradeLog).map((trade) => trade.pnlR));
  const firstHalf = summarizeFragilitySlice("firstHalf", tradeLog.slice(0, halfIndex).map((trade) => trade.pnlR));
  const secondHalf = summarizeFragilitySlice("secondHalf", tradeLog.slice(halfIndex).map((trade) => trade.pnlR));
  const perturbationExpectancies = [
    withoutBestTrade.expectancyR,
    withoutBestFivePercentWinners.expectancyR,
    withoutBestDay.expectancyR,
    firstHalf.expectancyR,
    secondHalf.expectancyR,
  ];
  const positiveHalves = [firstHalf, secondHalf].filter((slice) => slice.trades > 0 && slice.expectancyR > 0).length;
  const robust =
    baseline.expectancyR > 0 &&
    perturbationExpectancies.every((expectancyR) => expectancyR > 0) &&
    positiveHalves === 2;

  return {
    strategyId: stress.strategyId,
    variantId: stress.variantId,
    zoneId: stress.zoneId,
    entryMode: stress.entryMode,
    targetR: stress.targetR,
    maxHoldFiveMinuteBars: stress.maxHoldFiveMinuteBars,
    baseline,
    withoutBestTrade,
    withoutBestFivePercentWinners,
    withoutBestDay,
    firstHalf,
    secondHalf,
    positiveHalves,
    worstPerturbationExpectancyR: Math.min(...perturbationExpectancies),
    robust,
    notes: [
      "Fragility uses only the already replayed trade path; it does not peek past the original signal/entry rules.",
      "Best-trade and best-day removals test whether expectancy depends on one outlier event.",
      "First-half and second-half slices test whether the edge is at least directionally present on both sides of the sample.",
    ],
  };
}

function aggregateMicroWindow(oneMinuteCandles: Candle[], endIndex: number, width: number): Candle | null {
  const startIndex = endIndex - width + 1;
  if (startIndex < 0) return null;
  const bars = oneMinuteCandles.slice(startIndex, endIndex + 1);
  if (bars.length !== width) return null;
  for (let offset = 1; offset < bars.length; offset += 1) {
    if (bars[offset].openTime !== bars[0].openTime + offset * 60_000) return null;
  }
  return {
    openTime: bars[0].openTime,
    open: bars[0].open,
    high: Math.max(...bars.map((item) => item.high)),
    low: Math.min(...bars.map((item) => item.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((sum, item) => sum + item.volume, 0),
    closeTime: bars[bars.length - 1].closeTime,
  };
}

function detectMicroScalpSignals(oneMinuteCandles: Candle[]): MicroScalpSignal[] {
  const signals: MicroScalpSignal[] = [];
  const width = 2;
  const zoneId = "width:2+quietRangeRank:lte0.35";
  const windows = oneMinuteCandles.map((_, index) => aggregateMicroWindow(oneMinuteCandles, index, width));

  for (let index = 40; index < oneMinuteCandles.length - 1; index += 1) {
    const current = windows[index];
    if (!current) continue;
    const history = windows
      .slice(Math.max(0, index - 96), index)
      .filter((item): item is Candle => item !== null);
    if (history.length < 30) continue;

    const shelf = history.slice(-4);
    if (shelf.length < 4) continue;
    const historyRanges = history.map(range);
    const quietShelf = shelf.every((item) => percentileRank(historyRanges, range(item)) <= 0.35);
    const shelfHigh = Math.max(...shelf.map((item) => item.high));
    const shelfLow = Math.min(...shelf.map((item) => item.low));
    const currentRangeRank = percentileRank(historyRanges, range(current));
    const shortBreak =
      quietShelf &&
      current.close < shelfLow &&
      closePosition(current) <= 0.35 &&
      currentRangeRank >= 0.55;

    if (!shortBreak) continue;
    signals.push({
      id: "micro-squeeze-break-q35-short",
      zoneId,
      direction: "short",
      signalCandle: current,
      sourceEndIndex: index,
      stopPrice: shelfHigh,
    });
  }

  return signals;
}

function strategylessConditionMatches(
  oneMinuteCandles: Candle[],
  fiveMinute: FiveMinuteCandle[],
  fiveMinuteIndex: number,
  conditionId: string,
): boolean {
  const atomIds = new Set(strategylessAtoms(oneMinuteCandles, fiveMinute, fiveMinuteIndex).map((atom) => atom.id));
  return conditionId.split("+").every((atomId) => atomIds.has(atomId));
}

function strategylessVariantId(candidate: StrategylessOhlcvPortfolioCandidate): string {
  return `strategyless-ohlcv:${candidate.conditionId}:${candidate.direction}:entry-${candidate.entryMode}:target-${candidate.targetR}:hold-${candidate.holdMinutes}m`;
}

export function buildBtcusdtStrategylessOhlcvPortfolioOrders(
  oneMinuteCandles: Candle[],
  options: StrategylessOhlcvPortfolioOptions,
): EdgeZonePortfolioOrder[] {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const orders: EdgeZonePortfolioOrder[] = [];

  for (let candidateIndex = 0; candidateIndex < options.candidates.length; candidateIndex += 1) {
    const candidate = options.candidates[candidateIndex];
    const variantId = strategylessVariantId(candidate);
    for (let fiveMinuteIndex = 6; fiveMinuteIndex < fiveMinute.length - 1; fiveMinuteIndex += 1) {
      if (!strategylessConditionMatches(oneMinuteCandles, fiveMinute, fiveMinuteIndex, candidate.conditionId)) continue;
      const signalCandle = fiveMinute[fiveMinuteIndex];
      const entryStartIndex = signalCandle.sourceEndIndex + 1;
      const entry = oneMinuteCandles[entryStartIndex];
      if (!entry) continue;
      const stopPrice = candidate.direction === "long" ? signalCandle.low : signalCandle.high;
      const entryWaitBars = candidate.entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
      const entryPrice =
        candidate.entryMode === "next-open"
          ? entry.open
          : replayEntryPrice(candidate.entryMode, candidate.direction, signalCandle);
      const risk = candidate.direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
      if (risk < config.tickSize * 2) continue;
      if (risk / entryPrice < config.minRiskPct) continue;
      const targetPrice =
        candidate.direction === "long"
          ? entryPrice + risk * candidate.targetR
          : entryPrice - risk * candidate.targetR;

      orders.push({
        orderId: `${candidate.label ?? `strategyless-${candidateIndex}`}:${variantId}:${signalCandle.openTime}`,
        candidateIndex,
        candidateLabel: candidate.label ?? `strategyless-${candidateIndex + 1}`,
        strategyId: "strategyless-ohlcv",
        variantId,
        zoneId: candidate.conditionId,
        direction: candidate.direction,
        signalOpenTime: signalCandle.openTime,
        signalCloseTime: signalCandle.closeTime ?? signalCandle.openTime + 5 * 60_000 - 1,
        signalSourceEndIndex: signalCandle.sourceEndIndex,
        entryStartIndex,
        entryOpenTime: entry.openTime,
        entryMode: candidate.entryMode,
        entryWaitBars,
        entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
        entryPrice,
        stopPrice,
        targetPrice,
        targetR: candidate.targetR,
        maxHoldFiveMinuteBars: Math.ceil(candidate.holdMinutes / 5),
        maxBars: candidate.holdMinutes,
      });
    }
  }

  return orders.sort((left, right) => {
    if (left.signalOpenTime !== right.signalOpenTime) return left.signalOpenTime - right.signalOpenTime;
    return left.orderId.localeCompare(right.orderId);
  });
}

export function buildBtcusdtMicroScalpPortfolioOrders(
  oneMinuteCandles: Candle[],
  options: MicroScalpPortfolioOptions,
): EdgeZonePortfolioOrder[] {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const signals = detectMicroScalpSignals(oneMinuteCandles);
  const orders: EdgeZonePortfolioOrder[] = [];

  for (const signal of signals) {
    const entryIndex = signal.sourceEndIndex + 1;
    const entry = oneMinuteCandles[entryIndex];
    if (!entry) continue;

    for (let candidateIndex = 0; candidateIndex < options.candidates.length; candidateIndex += 1) {
      const candidate = options.candidates[candidateIndex];
      if (candidate.strategyId !== signal.id) continue;
      if (candidate.zoneId !== signal.zoneId) continue;

      const entryWaitBars = candidate.entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
      const entryPrice =
        candidate.entryMode === "next-open" ? entry.open : replayEntryPrice(candidate.entryMode, signal.direction, signal.signalCandle);
      const risk = signal.direction === "long" ? entryPrice - signal.stopPrice : signal.stopPrice - entryPrice;
      if (risk < config.tickSize * 2) continue;
      if (risk / entryPrice < config.minRiskPct) continue;

      const targetPrice =
        signal.direction === "long" ? entryPrice + risk * candidate.targetR : entryPrice - risk * candidate.targetR;
      const variantId = `${candidate.strategyId}:entry-${candidate.entryMode}:target-${candidate.targetR}:hold-${candidate.maxHoldBars}m`;
      const candidateLabel = candidate.label ?? `${candidate.strategyId}:${candidate.zoneId}`;
      const orderId = [
        "micro",
        candidateIndex,
        variantId,
        candidate.zoneId,
        signal.signalCandle.openTime,
        candidateLabel,
      ].join(":");

      orders.push({
        orderId,
        candidateIndex,
        candidateLabel,
        strategyId: signal.id,
        variantId,
        zoneId: candidate.zoneId,
        direction: signal.direction,
        signalOpenTime: signal.signalCandle.openTime,
        signalCloseTime: signal.signalCandle.closeTime ?? signal.signalCandle.openTime + 2 * 60_000 - 1,
        signalSourceEndIndex: signal.sourceEndIndex,
        entryStartIndex: entryIndex,
        entryOpenTime: entry.openTime,
        entryMode: candidate.entryMode,
        entryWaitBars,
        entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
        entryPrice,
        stopPrice: signal.stopPrice,
        targetPrice,
        targetR: candidate.targetR,
        maxHoldFiveMinuteBars: Math.ceil(candidate.maxHoldBars / 5),
        maxBars: candidate.maxHoldBars,
      });
    }
  }

  return orders.sort((left, right) => {
    if (left.signalOpenTime !== right.signalOpenTime) return left.signalOpenTime - right.signalOpenTime;
    return left.orderId.localeCompare(right.orderId);
  });
}

export function buildBtcusdtEdgeZonePortfolioOrders(
  oneMinuteCandles: Candle[],
  options: EdgeZonePortfolioOptions,
): EdgeZonePortfolioOrder[] {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const signals = detectSignals(fiveMinute, oneMinuteCandles);
  const orders: EdgeZonePortfolioOrder[] = [];

  for (const signal of signals) {
    const signalCandle = fiveMinute[signal.fiveMinuteIndex];
    const sourceEndIndex = signalCandle.sourceEndIndex;
    const entryIndex = sourceEndIndex + 1;
    const entry = oneMinuteCandles[entryIndex];
    if (!entry) continue;

    const zones = edgeZoneLabels(fiveMinute, signal.fiveMinuteIndex);
    for (let candidateIndex = 0; candidateIndex < options.candidates.length; candidateIndex += 1) {
      const candidate = options.candidates[candidateIndex];
      if (candidate.strategyId !== signal.id) continue;
      if (!zones.some((zone) => zone.zoneId === candidate.zoneId)) continue;

      const entryWaitBars = candidate.entryMode === "next-open" ? 1 : Math.max(1, config.entryWaitBars ?? 3);
      const entryPrice =
        candidate.entryMode === "next-open" ? entry.open : replayEntryPrice(candidate.entryMode, signal.direction, signalCandle);
      const risk = signal.direction === "long" ? entryPrice - signal.stopPrice : signal.stopPrice - entryPrice;
      if (risk < config.tickSize * 2) continue;
      if (risk / entryPrice < config.minRiskPct) continue;

      const variantId = `${candidate.strategyId}:entry-${candidate.entryMode}:target-${candidate.targetR}:hold-${candidate.maxHoldFiveMinuteBars}`;
      const candidateLabel = candidate.label ?? `${candidate.strategyId}:${candidate.zoneId}`;
      const targetPrice =
        signal.direction === "long"
          ? entryPrice + risk * candidate.targetR
          : entryPrice - risk * candidate.targetR;
      const orderId = [
        candidateIndex,
        variantId,
        candidate.zoneId,
        signalCandle.openTime,
        candidateLabel,
      ].join(":");

      orders.push({
        orderId,
        candidateIndex,
        candidateLabel,
        strategyId: signal.id,
        variantId,
        zoneId: candidate.zoneId,
        direction: signal.direction,
        signalOpenTime: signalCandle.openTime,
        signalCloseTime: signalCandle.closeTime ?? signalCandle.openTime + 5 * 60_000 - 1,
        signalSourceEndIndex: sourceEndIndex,
        entryStartIndex: entryIndex,
        entryOpenTime: entry.openTime,
        entryMode: candidate.entryMode,
        entryWaitBars,
        entryFillBufferTicks: config.entryFillBufferTicks ?? 0,
        entryPrice,
        stopPrice: signal.stopPrice,
        targetPrice,
        targetR: candidate.targetR,
        maxHoldFiveMinuteBars: candidate.maxHoldFiveMinuteBars,
        maxBars: candidate.maxHoldFiveMinuteBars * 5,
      });
    }
  }

  return orders.sort((left, right) => {
    if (left.signalOpenTime !== right.signalOpenTime) return left.signalOpenTime - right.signalOpenTime;
    return left.orderId.localeCompare(right.orderId);
  });
}

export function buildBtcusdtEdgeZonePortfolioReport(
  oneMinuteCandles: Candle[],
  options: EdgeZonePortfolioOptions,
): EdgeZonePortfolioReport {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const initialEquity = options.initialEquity ?? 1;
  const riskPct = options.riskPct ?? config.riskCapPct;
  const candidates: EdgeZonePortfolioCandidateReport[] = [];
  const tradeLog: EdgeZonePortfolioTrade[] = [];

  options.candidates.forEach((candidate, candidateIndex) => {
    const stress = buildBtcusdtEdgeZoneStressReport(oneMinuteCandles, {
      ...candidate,
      initialEquity,
      riskPct,
      config,
    });
    const label = candidate.label ?? `${candidate.strategyId}:${candidate.zoneId}`;
    candidates.push({
      label,
      strategyId: stress.strategyId,
      variantId: stress.variantId,
      zoneId: stress.zoneId,
      entryMode: stress.entryMode,
      targetR: stress.targetR,
      maxHoldFiveMinuteBars: stress.maxHoldFiveMinuteBars,
      submittedOrders: stress.submittedOrders,
      trades: stress.trades,
      fillRate: stress.fillRate,
      winRate: stress.winRate,
      payoffRatio: stress.payoffRatio,
      expectancyR: stress.expectancyR,
      profitFactor: stress.profitFactor,
      maxDrawdownR: stress.maxDrawdownR,
    });
    for (const trade of stress.tradeLog) {
      tradeLog.push({
        candidateIndex,
        candidateLabel: label,
        strategyId: stress.strategyId,
        variantId: stress.variantId,
        zoneId: stress.zoneId,
        direction: stress.direction,
        entryOpenTime: trade.entryOpenTime,
        pnlR: trade.pnlR,
        rawPnlR: trade.rawPnlR,
        exitReason: trade.exitReason,
        barsHeld: trade.barsHeld,
        entryPrice: trade.entryPrice,
      });
    }
  });

  tradeLog.sort((left, right) => {
    if (left.entryOpenTime !== right.entryOpenTime) return left.entryOpenTime - right.entryOpenTime;
    return left.candidateIndex - right.candidateIndex;
  });

  const grouped = new Map<number, EdgeZonePortfolioTrade[]>();
  for (const trade of tradeLog) {
    const bucket = grouped.get(trade.entryOpenTime) ?? [];
    bucket.push(trade);
    grouped.set(trade.entryOpenTime, bucket);
  }

  const pnlRs = tradeLog.map((trade) => trade.pnlR);
  const baseline = summarizeFragilitySlice("portfolio", pnlRs);
  let cumulativePnlR = 0;
  let peakPnlR = 0;
  let maxDrawdownR = 0;
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  let currentLossStreak = 0;
  let longestLossStreak = 0;
  const groupedTradeLog: EdgeZonePortfolioEntryGroup[] = [];

  for (const [entryOpenTime, trades] of [...grouped.entries()].sort((left, right) => left[0] - right[0])) {
    const netPnlR = trades.reduce((sum, trade) => sum + trade.pnlR, 0);
    cumulativePnlR += netPnlR;
    peakPnlR = Math.max(peakPnlR, cumulativePnlR);
    maxDrawdownR = Math.max(maxDrawdownR, peakPnlR - cumulativePnlR);
    equity = Math.max(0, equity * (1 + netPnlR * riskPct));
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity === 0 ? 0 : (peakEquity - equity) / peakEquity;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    if (netPnlR < 0) {
      currentLossStreak += 1;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
    groupedTradeLog.push({
      entryOpenTime,
      trades: trades.length,
      candidateLabels: trades.map((trade) => trade.candidateLabel),
      netPnlR,
      grossRiskPct: trades.length * riskPct,
      cumulativePnlR,
      equity,
      drawdownPct,
    });
  }

  const sameMinuteEntryGroups = groupedTradeLog.filter((group) => group.trades > 1).length;
  const overlappedTrades = groupedTradeLog
    .filter((group) => group.trades > 1)
    .reduce((sum, group) => sum + group.trades, 0);

  return {
    candidates,
    trades: tradeLog.length,
    entryGroups: groupedTradeLog.length,
    sameMinuteEntryGroups,
    maxSameMinuteTrades: groupedTradeLog.length === 0 ? 0 : Math.max(...groupedTradeLog.map((group) => group.trades)),
    overlapShare: tradeLog.length === 0 ? 0 : overlappedTrades / tradeLog.length,
    winRate: baseline.winRate,
    payoffRatio: baseline.payoffRatio,
    expectancyR: baseline.expectancyR,
    profitFactor: baseline.profitFactor,
    maxDrawdownR,
    riskPct,
    initialEquity,
    finalEquity: equity,
    returnPct: initialEquity === 0 ? 0 : (equity - initialEquity) / initialEquity,
    maxDrawdownPct,
    longestLossStreak,
    tradeLog,
    groupedTradeLog,
    notes: [
      "Each candidate is replayed independently with the same future-blind edge-zone stress engine.",
      "Trades sharing the same entryOpenTime are grouped and applied to equity as one combined R result.",
      "overlapShare measures how much of the portfolio's filled trade count occurred in same-minute candidate clusters.",
    ],
  };
}

function replayGroupedEquity(
  groups: Array<{ netPnlR: number }>,
  initialEquity: number,
  riskPct: number,
): Pick<EdgeZonePortfolioRiskScenario, "finalEquity" | "returnPct" | "maxDrawdownPct" | "maxDrawdownR" | "longestLossStreak" | "ruined"> {
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  let cumulativePnlR = 0;
  let peakPnlR = 0;
  let maxDrawdownR = 0;
  let currentLossStreak = 0;
  let longestLossStreak = 0;

  for (const group of groups) {
    cumulativePnlR += group.netPnlR;
    peakPnlR = Math.max(peakPnlR, cumulativePnlR);
    maxDrawdownR = Math.max(maxDrawdownR, peakPnlR - cumulativePnlR);
    equity = Math.max(0, equity * (1 + group.netPnlR * riskPct));
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peakEquity === 0 ? 0 : (peakEquity - equity) / peakEquity);
    if (group.netPnlR < 0) {
      currentLossStreak += 1;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }

  return {
    finalEquity: equity,
    returnPct: initialEquity === 0 ? 0 : (equity - initialEquity) / initialEquity,
    maxDrawdownPct,
    maxDrawdownR,
    longestLossStreak,
    ruined: equity === 0,
  };
}

function summarizeGroupedDrawdown(groups: Array<{ netPnlR: number }>): number {
  let cumulativePnlR = 0;
  let peakPnlR = 0;
  let maxDrawdownR = 0;
  for (const group of groups) {
    cumulativePnlR += group.netPnlR;
    peakPnlR = Math.max(peakPnlR, cumulativePnlR);
    maxDrawdownR = Math.max(maxDrawdownR, peakPnlR - cumulativePnlR);
  }
  return maxDrawdownR;
}

export function buildBtcusdtEdgeZonePortfolioRobustnessReport(
  oneMinuteCandles: Candle[],
  options: EdgeZonePortfolioRobustnessOptions,
): EdgeZonePortfolioRobustnessReport {
  const portfolio = buildBtcusdtEdgeZonePortfolioReport(oneMinuteCandles, options);
  const grouped = portfolio.groupedTradeLog;
  const totalPnlR = grouped.reduce((sum, group) => sum + group.netPnlR, 0);
  const riskPctValues = options.riskPctValues && options.riskPctValues.length > 0 ? options.riskPctValues : [portfolio.riskPct];
  const riskScenarios = riskPctValues.map((riskPct) => ({
    riskPct,
    ...replayGroupedEquity(grouped, portfolio.initialEquity, riskPct),
  }));

  const monthlyBuckets = new Map<string, EdgeZonePortfolioEntryGroup[]>();
  for (const group of grouped) {
    const month = new Date(group.entryOpenTime).toISOString().slice(0, 7);
    const bucket = monthlyBuckets.get(month) ?? [];
    bucket.push(group);
    monthlyBuckets.set(month, bucket);
  }
  const monthlyRows = [...monthlyBuckets.entries()]
    .map(([month, rows]) => {
      const monthPnlR = rows.reduce((sum, row) => sum + row.netPnlR, 0);
      return {
        month,
        entryGroups: rows.length,
        trades: rows.reduce((sum, row) => sum + row.trades, 0),
        totalPnlR: monthPnlR,
        expectancyPerGroupR: rows.length === 0 ? 0 : monthPnlR / rows.length,
        positiveGroupRate: rows.length === 0 ? 0 : rows.filter((row) => row.netPnlR > 0).length / rows.length,
        maxDrawdownR: summarizeGroupedDrawdown(rows),
      };
    })
    .sort((left, right) => left.month.localeCompare(right.month));

  const dailyBuckets = new Map<number, EdgeZonePortfolioEntryGroup[]>();
  for (const group of grouped) {
    const day = Math.floor(group.entryOpenTime / 86_400_000);
    const bucket = dailyBuckets.get(day) ?? [];
    bucket.push(group);
    dailyBuckets.set(day, bucket);
  }
  const daysByProfit = [...dailyBuckets.entries()]
    .map(([day, rows]) => ({
      day,
      rows,
      pnlR: rows.reduce((sum, row) => sum + row.netPnlR, 0),
    }))
    .sort((left, right) => right.pnlR - left.pnlR);
  const withoutTopProfitDays = (options.topProfitDayCounts && options.topProfitDayCounts.length > 0
    ? options.topProfitDayCounts
    : [1, 3, 5]
  ).map((removedDays) => {
    const removed = new Set(daysByProfit.slice(0, removedDays).filter((day) => day.pnlR > 0).map((day) => day.day));
    const remaining = grouped.filter((group) => !removed.has(Math.floor(group.entryOpenTime / 86_400_000)));
    const remainingPnlR = remaining.reduce((sum, group) => sum + group.netPnlR, 0);
    const remainingTrades = remaining.reduce((sum, group) => sum + group.trades, 0);
    return {
      removedDays,
      remainingEntryGroups: remaining.length,
      remainingTrades,
      totalPnlR: remainingPnlR,
      expectancyPerGroupR: remaining.length === 0 ? 0 : remainingPnlR / remaining.length,
      expectancyPerTradeR: remainingTrades === 0 ? 0 : remainingPnlR / remainingTrades,
      maxDrawdownR: summarizeGroupedDrawdown(remaining),
    };
  });

  return {
    baseline: {
      trades: portfolio.trades,
      entryGroups: portfolio.entryGroups,
      totalPnlR,
      expectancyR: portfolio.expectancyR,
      profitFactor: portfolio.profitFactor,
      maxDrawdownR: portfolio.maxDrawdownR,
      overlapShare: portfolio.overlapShare,
    },
    riskScenarios,
    monthlyRows,
    withoutTopProfitDays,
    portfolio,
    notes: [
      "Risk scenarios replay the same grouped portfolio R path with different fixed risk percentages.",
      "Monthly rows use entryOpenTime buckets and do not add any non-OHLCV inputs.",
      "Top-profit-day removals remove whole entry days to test dependency on a small number of favorable sessions.",
    ],
  };
}

export function buildBtcusdtEdgeZonePortfolioRollingReport(
  oneMinuteCandles: Candle[],
  options: EdgeZonePortfolioRollingOptions,
): EdgeZonePortfolioRollingReport {
  const windowMs = Math.max(1, options.windowDays) * 86_400_000;
  const stepDays = options.stepDays ?? options.windowDays;
  const stepMs = Math.max(1, stepDays) * 86_400_000;
  const minEntryGroups = options.minEntryGroups ?? 8;
  const minPositiveWindowRate = options.minPositiveWindowRate ?? 0.66;
  const minWorstExpectancyR = options.minWorstExpectancyR ?? -0.25;
  const firstOpenTime = oneMinuteCandles[0]?.openTime ?? 0;
  const lastOpenTime = oneMinuteCandles[oneMinuteCandles.length - 1]?.openTime ?? 0;
  const windows: EdgeZonePortfolioRollingWindow[] = [];
  let startIndex = 0;
  let endIndex = 0;

  for (let startOpenTime = firstOpenTime; startOpenTime <= lastOpenTime; startOpenTime += stepMs) {
    const endOpenTime = startOpenTime + windowMs;
    while (startIndex < oneMinuteCandles.length && oneMinuteCandles[startIndex].openTime < startOpenTime) {
      startIndex += 1;
    }
    endIndex = Math.max(endIndex, startIndex);
    while (endIndex < oneMinuteCandles.length && oneMinuteCandles[endIndex].openTime < endOpenTime) {
      endIndex += 1;
    }
    const windowCandles = oneMinuteCandles.slice(startIndex, endIndex);
    if (windowCandles.length === 0) continue;
    const portfolio = buildBtcusdtEdgeZonePortfolioReport(windowCandles, options);
    const eligible = portfolio.entryGroups >= minEntryGroups;
    const positive = eligible && portfolio.expectancyR > 0;
    windows.push({
      index: windows.length,
      startOpenTime,
      endOpenTime: Math.min(endOpenTime, windowCandles[windowCandles.length - 1]?.openTime ?? endOpenTime),
      trades: portfolio.trades,
      entryGroups: portfolio.entryGroups,
      expectancyR: portfolio.expectancyR,
      profitFactor: portfolio.profitFactor,
      maxDrawdownR: portfolio.maxDrawdownR,
      returnPct: portfolio.returnPct,
      maxDrawdownPct: portfolio.maxDrawdownPct,
      eligible,
      positive,
    });
  }

  const eligibleRows = windows.filter((window) => window.eligible);
  const expectancies = eligibleRows.map((window) => window.expectancyR);
  const profitFactors = eligibleRows.map((window) => window.profitFactor).filter(Number.isFinite);
  const eligibleWindows = eligibleRows.length;
  const positiveWindows = eligibleRows.filter((window) => window.positive).length;
  const positiveWindowRate = eligibleWindows === 0 ? 0 : positiveWindows / eligibleWindows;
  const worstExpectancyR = expectancies.length === 0 ? 0 : Math.min(...expectancies);

  return {
    windowDays: options.windowDays,
    stepDays,
    windows,
    eligibleWindows,
    positiveWindows,
    positiveWindowRate,
    totalTrades: eligibleRows.reduce((sum, window) => sum + window.trades, 0),
    worstExpectancyR,
    medianExpectancyR: median(expectancies),
    worstProfitFactor: profitFactors.length === 0 ? 0 : Math.min(...profitFactors),
    worstMaxDrawdownR: eligibleRows.length === 0 ? 0 : Math.max(...eligibleRows.map((window) => window.maxDrawdownR)),
    accepted:
      eligibleWindows > 0 &&
      positiveWindowRate >= minPositiveWindowRate &&
      worstExpectancyR >= minWorstExpectancyR &&
      median(expectancies) > 0,
  };
}

export function buildBtcusdtEdgeZonePortfolioExecutionSweepReport(
  oneMinuteCandles: Candle[],
  options: EdgeZonePortfolioExecutionSweepOptions,
): EdgeZonePortfolioExecutionSweepReport {
  const baseConfig = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const rows: EdgeZonePortfolioExecutionSweepRow[] = [];

  for (const entryWaitBars of options.entryWaitBarsValues) {
    for (const entryFillBufferTicks of options.entryFillBufferTicksValues) {
      const portfolio = buildBtcusdtEdgeZonePortfolioReport(oneMinuteCandles, {
        ...options,
        config: {
          ...baseConfig,
          entryWaitBars,
          entryFillBufferTicks,
        },
      });
      const submittedOrders = portfolio.candidates.reduce((sum, candidate) => sum + candidate.submittedOrders, 0);
      rows.push({
        entryWaitBars,
        entryFillBufferTicks,
        submittedOrders,
        trades: portfolio.trades,
        entryGroups: portfolio.entryGroups,
        fillRate: submittedOrders === 0 ? 0 : portfolio.trades / submittedOrders,
        winRate: portfolio.winRate,
        payoffRatio: portfolio.payoffRatio,
        expectancyR: portfolio.expectancyR,
        profitFactor: portfolio.profitFactor,
        maxDrawdownR: portfolio.maxDrawdownR,
        returnPct: portfolio.returnPct,
        maxDrawdownPct: portfolio.maxDrawdownPct,
      });
    }
  }

  rows.sort((left, right) => {
    if (left.entryFillBufferTicks !== right.entryFillBufferTicks) {
      return left.entryFillBufferTicks - right.entryFillBufferTicks;
    }
    return left.entryWaitBars - right.entryWaitBars;
  });

  return { rows };
}

export function buildBtcusdtEdgeZoneWalkForwardReport(
  oneMinuteCandles: Candle[],
  options: EdgeZoneWalkForwardOptions,
): EdgeZoneWalkForwardReport {
  const foldOneMinuteBars = options.foldFiveMinuteBars * 5;
  const minEligibleFolds = options.minEligibleFolds ?? 3;
  const minTradesPerFold = options.minTradesPerFold ?? Math.min(10, options.config?.minTrades ?? DEFAULT_CONFIG.minTrades);
  const minWorstFoldExpectancyR = options.minWorstFoldExpectancyR ?? -0.25;
  const folds: EdgeZoneWalkForwardFold[] = [];
  const expectancies: number[] = [];
  let totalTrades = 0;

  for (let start = 0; start + foldOneMinuteBars <= oneMinuteCandles.length; start += foldOneMinuteBars) {
    const foldCandles = oneMinuteCandles.slice(start, start + foldOneMinuteBars);
    const stress = buildBtcusdtEdgeZoneStressReport(foldCandles, options);
    const eligible = stress.trades >= minTradesPerFold;
    const positive = eligible && stress.expectancyR > 0;
    if (eligible) {
      expectancies.push(stress.expectancyR);
      totalTrades += stress.trades;
    }
    folds.push({
      index: folds.length,
      startOpenTime: foldCandles[0]?.openTime ?? 0,
      endOpenTime: foldCandles[foldCandles.length - 1]?.openTime ?? 0,
      submittedOrders: stress.submittedOrders,
      trades: stress.trades,
      fillRate: stress.fillRate,
      winRate: stress.winRate,
      payoffRatio: stress.payoffRatio,
      expectancyR: stress.expectancyR,
      profitFactor: stress.profitFactor,
      maxDrawdownR: stress.maxDrawdownR,
      returnPct: stress.returnPct,
      maxDrawdownPct: stress.maxDrawdownPct,
      eligible,
      positive,
    });
  }

  const eligibleFolds = folds.filter((fold) => fold.eligible).length;
  const positiveFolds = folds.filter((fold) => fold.positive).length;
  const positiveFoldRate = eligibleFolds === 0 ? 0 : positiveFolds / eligibleFolds;
  const eligibleTradeCounts = folds.filter((fold) => fold.eligible).map((fold) => fold.trades);
  const minFoldTrades = eligibleTradeCounts.length === 0 ? 0 : Math.min(...eligibleTradeCounts);
  const worstFoldExpectancyR = expectancies.length === 0 ? 0 : Math.min(...expectancies);
  const averageExpectancyR =
    expectancies.length === 0 ? 0 : expectancies.reduce((sum, value) => sum + value, 0) / expectancies.length;
  const variantId = `${options.strategyId}:entry-${options.entryMode}:target-${options.targetR}:hold-${options.maxHoldFiveMinuteBars}`;

  return {
    strategyId: options.strategyId,
    variantId,
    zoneId: options.zoneId,
    folds,
    eligibleFolds,
    positiveFolds,
    positiveFoldRate,
    totalTrades,
    minFoldTrades,
    worstFoldExpectancyR,
    medianExpectancyR: median(expectancies),
    averageExpectancyR,
    accepted:
      eligibleFolds >= minEligibleFolds &&
      positiveFoldRate >= options.minPositiveFoldRate &&
      minFoldTrades >= minTradesPerFold &&
      worstFoldExpectancyR >= minWorstFoldExpectancyR &&
      median(expectancies) > 0,
  };
}

export function buildBtcusdtResearchReport(
  oneMinuteCandles: Candle[],
  overrides: Partial<ResearchConfig> = {},
  metadata: { symbol?: string; displaySymbol?: string; market?: string } = {},
): BtcusdtResearchReport {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const fiveMinute = resampleToFiveMinuteCandles(oneMinuteCandles);
  const signals = detectSignals(fiveMinute, oneMinuteCandles);
  const strategies = evaluateSignals(oneMinuteCandles, fiveMinute, signals, config);
  return {
    symbol: metadata.symbol ?? "BTCUSDT",
    displaySymbol: metadata.displaySymbol,
    exchange: "Binance",
    market: metadata.market ?? "USDT-M perpetual futures",
    sourceInterval: "1m",
    signalInterval: "5m",
    candles: {
      oneMinute: oneMinuteCandles.length,
      fiveMinute: fiveMinute.length,
    },
    config,
    assumptions: [
      "No technical indicators: only OHLCV-derived bar geometry and volume ranks.",
      "Signals are formed after a completed 5m candle; entries execute at the next 1m open.",
      "Maker-limit replay fixes limit price from completed candles before future bars are evaluated.",
      "Maker-limit fill buffers can require price to trade through the limit before counting a passive fill.",
      "Unfilled maker-limit orders are counted as missed orders, not profitable trades.",
      "If stop and target are both inside the same 1m candle, stop is assumed to fill first.",
      "Kelly is fractional and capped; full Kelly is reported but not used directly.",
    ],
    strategies,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildBtcusdtWalkForwardReport(
  oneMinuteCandles: Candle[],
  options: WalkForwardOptions,
): WalkForwardReport {
  const foldOneMinuteBars = options.foldFiveMinuteBars * 5;
  const minEligibleFolds = options.minEligibleFolds ?? 3;
  const minTradesPerFold = options.minTradesPerFold ?? Math.min(10, options.minTrades);
  const minWorstFoldExpectancyR = options.minWorstFoldExpectancyR ?? -0.25;
  const folds: WalkForwardFold[] = [];
  const strategyBuckets = new Map<string, StrategyReport[]>();

  for (let start = 0; start + foldOneMinuteBars <= oneMinuteCandles.length; start += foldOneMinuteBars) {
    const foldCandles = oneMinuteCandles.slice(start, start + foldOneMinuteBars);
    const report = buildBtcusdtResearchReport(foldCandles, {
      ...options.config,
      minTrades: options.minTrades,
    });
    folds.push({
      index: folds.length,
      startOpenTime: foldCandles[0]?.openTime ?? 0,
      endOpenTime: foldCandles[foldCandles.length - 1]?.openTime ?? 0,
      strategies: report.strategies.length,
      acceptedCount: report.strategies.filter((strategy) => strategy.accepted).length,
    });
    for (const strategy of report.strategies) {
      if (strategy.trades < minTradesPerFold) continue;
      strategyBuckets.set(strategy.id, [...(strategyBuckets.get(strategy.id) ?? []), strategy]);
    }
  }

  const strategies = [...strategyBuckets.entries()].map(([id, foldStrategies]) => {
    const expectancies = foldStrategies.map((strategy) => strategy.expectancyR);
    const positiveFolds = expectancies.filter((value) => value > 0).length;
    const positiveFoldRate = foldStrategies.length === 0 ? 0 : positiveFolds / foldStrategies.length;
    const totalTrades = foldStrategies.reduce((sum, strategy) => sum + strategy.trades, 0);
    const minFoldTrades = foldStrategies.length === 0 ? 0 : Math.min(...foldStrategies.map((strategy) => strategy.trades));
    const worstFoldExpectancyR = expectancies.length === 0 ? 0 : Math.min(...expectancies);
    const averageExpectancyR =
      foldStrategies.length === 0
        ? 0
        : expectancies.reduce((sum, value) => sum + value, 0) / foldStrategies.length;
    return {
      id,
      name: foldStrategies[0].name,
      direction: foldStrategies[0].direction,
      eligibleFolds: foldStrategies.length,
      positiveFolds,
      positiveFoldRate,
      totalTrades,
      minFoldTrades,
      worstFoldExpectancyR,
      medianExpectancyR: median(expectancies),
      averageExpectancyR,
      accepted:
        foldStrategies.length >= minEligibleFolds &&
        totalTrades >= options.minTrades &&
        minFoldTrades >= minTradesPerFold &&
        worstFoldExpectancyR >= minWorstFoldExpectancyR &&
        positiveFoldRate >= options.minPositiveFoldRate &&
        median(expectancies) > 0,
    };
  });

  return {
    folds,
    strategies: strategies.sort((left, right) => {
      if (right.positiveFoldRate !== left.positiveFoldRate) return right.positiveFoldRate - left.positiveFoldRate;
      return right.medianExpectancyR - left.medianExpectancyR;
    }),
  };
}

export function buildBtcusdtResearchSweep(
  oneMinuteCandles: Candle[],
  options: SweepOptions,
): ResearchSweepReport {
  const runs: SweepRun[] = [];
  for (const minRiskPct of options.minRiskPctValues) {
    for (const feeRate of options.feeRateValues) {
      const report = buildBtcusdtResearchReport(oneMinuteCandles, {
        ...options.baseConfig,
        minRiskPct,
        feeRate,
      });
      const positive = report.strategies.filter((strategy) => strategy.trades >= report.config.minTrades && strategy.expectancyR > 0);
      const accepted = report.strategies.filter((strategy) => strategy.accepted);
      const top = report.strategies.find((strategy) => strategy.trades >= report.config.minTrades) ?? report.strategies[0];
      runs.push({
        minRiskPct,
        feeRate,
        acceptedCount: accepted.length,
        positiveCount: positive.length,
        topStrategyId: top?.id ?? null,
        topExpectancyR: top?.expectancyR ?? 0,
        topTrades: top?.trades ?? 0,
      });
    }
  }
  return { runs };
}
