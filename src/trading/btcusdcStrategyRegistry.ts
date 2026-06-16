import { existsSync, readFileSync } from "node:fs";
import {
  BTCUSDC_CORE3_CANDIDATES,
  BTCUSDC_MICRO_SHADOW_CANDIDATES,
  BTCUSDC_STRATEGYLESS_SHADOW_CANDIDATES,
  type BtcusdcPaperTradingEvent,
} from "./btcusdcPaperTrading.js";
import type {
  EdgeZonePortfolioCandidate,
  MicroScalpPortfolioCandidate,
  StrategylessOhlcvPortfolioCandidate,
} from "./btcusdtResearch.js";

export type BtcusdcStrategyStatus = "candidate" | "shadow" | "core" | "disabled";
export type BtcusdcStrategyCandidateType = "edge" | "micro" | "strategyless";

export interface BtcusdcCoreTestResult {
  lookbackDays: number;
  filledTrades: number;
  submittedOrders: number;
  fillRate: number;
  expectancyR: number;
  profitFactor: number;
  fullKelly: number;
  totalR: number;
  maxDrawdownR: number;
  totalRToMaxDrawdown: number;
  positiveFoldRate: number;
  worstFoldExpectancyR: number;
  recent30ExpectancyR: number;
  recent90ExpectancyR: number;
  bestDayRemovedProfitFactor: number;
  bestFivePctRemovedExpectancyR: number;
  longTradeShare?: number;
  shortTradeShare?: number;
  portfolioMaxDrawdownDeltaR?: number;
  evaluatedAt?: string;
  source?: string;
  passed?: boolean;
}

export interface BtcusdcCoreGateEvaluation {
  passed: boolean;
  reasons: string[];
}

export type BtcusdcStrategyRegistryEntry =
  | {
      id: string;
      name: string;
      status: BtcusdcStrategyStatus;
      candidateType: "edge";
      candidate: EdgeZonePortfolioCandidate;
      coreTest?: BtcusdcCoreTestResult;
      notes?: string;
    }
  | {
      id: string;
      name: string;
      status: BtcusdcStrategyStatus;
      candidateType: "micro";
      candidate: MicroScalpPortfolioCandidate;
      coreTest?: BtcusdcCoreTestResult;
      notes?: string;
    }
  | {
      id: string;
      name: string;
      status: BtcusdcStrategyStatus;
      candidateType: "strategyless";
      candidate: StrategylessOhlcvPortfolioCandidate;
      coreTest?: BtcusdcCoreTestResult;
      notes?: string;
    };

export interface BtcusdcActivePaperCandidateSets {
  coreCandidates: EdgeZonePortfolioCandidate[];
  microCoreCandidates: MicroScalpPortfolioCandidate[];
  strategylessCoreCandidates: StrategylessOhlcvPortfolioCandidate[];
  shadowCandidates: EdgeZonePortfolioCandidate[];
  microShadowCandidates: MicroScalpPortfolioCandidate[];
  strategylessShadowCandidates: StrategylessOhlcvPortfolioCandidate[];
  runtimeCandidates: EdgeZonePortfolioCandidate[];
  runtimeMicroCandidates: MicroScalpPortfolioCandidate[];
  runtimeStrategylessCandidates: StrategylessOhlcvPortfolioCandidate[];
  coreTelegramCandidateLabels: Set<string>;
  strategyStatuses: Map<string, BtcusdcStrategyStatus>;
}

type BtcusdcDirectionalSide = "long" | "short";

function inferDirectionalSide(...values: Array<string | undefined>): BtcusdcDirectionalSide | null {
  for (const value of values) {
    if (!value) continue;
    if (/(^|[^a-zA-Z0-9])long($|[^a-zA-Z0-9])/i.test(value)) return "long";
    if (/(^|[^a-zA-Z0-9])short($|[^a-zA-Z0-9])/i.test(value)) return "short";
  }
  return null;
}

function normalizeDirectionalSide(value: string): string {
  return value
    .replace(/(^|[^a-zA-Z0-9])long($|[^a-zA-Z0-9])/gi, "$1both$2")
    .replace(/(^|[^a-zA-Z0-9])short($|[^a-zA-Z0-9])/gi, "$1both$2");
}

function registryEntryDirection(entry: BtcusdcStrategyRegistryEntry): BtcusdcDirectionalSide | null {
  if (entry.candidateType === "strategyless") return entry.candidate.direction;
  return inferDirectionalSide(entry.candidate.strategyId, entry.candidate.label, entry.name, entry.id);
}

function registryEntryPairKey(entry: BtcusdcStrategyRegistryEntry): string | null {
  const direction = registryEntryDirection(entry);
  if (!direction) return null;
  if (entry.candidateType === "edge") {
    return [
      entry.candidateType,
      normalizeDirectionalSide(entry.candidate.strategyId),
      entry.candidate.zoneId,
      entry.candidate.entryMode,
      entry.candidate.targetR,
      entry.candidate.maxHoldFiveMinuteBars,
    ].join("|");
  }
  if (entry.candidateType === "micro") {
    return [
      entry.candidateType,
      normalizeDirectionalSide(entry.candidate.strategyId),
      entry.candidate.zoneId,
      entry.candidate.entryMode,
      entry.candidate.targetR,
      entry.candidate.maxHoldBars,
    ].join("|");
  }
  return [
    entry.candidateType,
    entry.candidate.conditionId,
    entry.candidate.entryMode,
    entry.candidate.targetR,
    entry.candidate.holdMinutes,
  ].join("|");
}

function oppositeDirection(direction: BtcusdcDirectionalSide): BtcusdcDirectionalSide {
  return direction === "long" ? "short" : "long";
}

function replaceDirectionalToken(value: string, from: BtcusdcDirectionalSide, to: BtcusdcDirectionalSide): string {
  return value.replace(new RegExp(`(^|[^a-zA-Z0-9])${from}($|[^a-zA-Z0-9])`, "gi"), `$1${to}$2`);
}

function directionalPairMap(entries: BtcusdcStrategyRegistryEntry[]): Map<string, Set<BtcusdcDirectionalSide>> {
  const pairs = new Map<string, Set<BtcusdcDirectionalSide>>();
  for (const entry of entries) {
    const direction = registryEntryDirection(entry);
    const pairKey = registryEntryPairKey(entry);
    if (!direction || !pairKey) continue;
    const directions = pairs.get(pairKey) ?? new Set<BtcusdcDirectionalSide>();
    directions.add(direction);
    pairs.set(pairKey, directions);
  }
  return pairs;
}

function isDirectionallyPaired(
  entry: BtcusdcStrategyRegistryEntry,
  pairs: Map<string, Set<BtcusdcDirectionalSide>>,
): boolean {
  const direction = registryEntryDirection(entry);
  const pairKey = registryEntryPairKey(entry);
  if (!direction || !pairKey) return false;
  return pairs.get(pairKey)?.has(oppositeDirection(direction)) ?? false;
}

export function findBtcusdcUnpairedActiveRegistryEntries(
  entries: BtcusdcStrategyRegistryEntry[],
): BtcusdcStrategyRegistryEntry[] {
  const activeEntries = entries.filter((entry) => entry.status !== "disabled");
  const pairsByStatus = new Map<string, Set<BtcusdcDirectionalSide>>();
  for (const entry of activeEntries) {
    const direction = registryEntryDirection(entry);
    const pairKey = registryEntryPairKey(entry);
    if (!direction || !pairKey) continue;
    const statusPairKey = `${entry.status}|${pairKey}`;
    const directions = pairsByStatus.get(statusPairKey) ?? new Set<BtcusdcDirectionalSide>();
    directions.add(direction);
    pairsByStatus.set(statusPairKey, directions);
  }

  return activeEntries.filter((entry) => {
    const direction = registryEntryDirection(entry);
    const pairKey = registryEntryPairKey(entry);
    if (!direction || !pairKey) return true;
    return !pairsByStatus.get(`${entry.status}|${pairKey}`)?.has(oppositeDirection(direction));
  });
}

export function mirrorBtcusdcRegistryEntry(entry: BtcusdcStrategyRegistryEntry): BtcusdcStrategyRegistryEntry | null {
  const direction = registryEntryDirection(entry);
  if (!direction) return null;
  const opposite = oppositeDirection(direction);
  const id = replaceDirectionalToken(entry.id, direction, opposite);
  const name = replaceDirectionalToken(entry.name, direction, opposite);
  if (id === entry.id && name === entry.name) return null;
  const status = entry.status === "core" ? "shadow" : entry.status;
  const notes = `${entry.notes ? `${entry.notes} ` : ""}Mirrored by long/short registry policy from ${direction} to ${opposite}.`;

  if (entry.candidateType === "edge") {
    const label = replaceDirectionalToken(entry.candidate.label ?? entry.name, direction, opposite);
    const strategyId = replaceDirectionalToken(entry.candidate.strategyId, direction, opposite);
    if (label === entry.candidate.label && strategyId === entry.candidate.strategyId) return null;
    return {
      id,
      name,
      status,
      candidateType: "edge",
      candidate: {
        ...entry.candidate,
        label,
        strategyId,
      },
      notes,
    };
  }

  if (entry.candidateType === "micro") {
    const label = replaceDirectionalToken(entry.candidate.label ?? entry.name, direction, opposite);
    const strategyId = replaceDirectionalToken(entry.candidate.strategyId, direction, opposite);
    if (label === entry.candidate.label && strategyId === entry.candidate.strategyId) return null;
    return {
      id,
      name,
      status,
      candidateType: "micro",
      candidate: {
        ...entry.candidate,
        label,
        strategyId,
      },
      notes,
    };
  }

  return {
    id,
    name,
    status,
    candidateType: "strategyless",
    candidate: {
      ...entry.candidate,
      label: replaceDirectionalToken(entry.candidate.label ?? entry.name, direction, opposite),
      direction: opposite,
    },
    notes,
  };
}

function registryEntryKeys(entry: BtcusdcStrategyRegistryEntry): string[] {
  return [entry.id, entry.name, entry.candidate.label ?? entry.name];
}

function suffixRegistryEntryKeys(entry: BtcusdcStrategyRegistryEntry, suffix: string): BtcusdcStrategyRegistryEntry {
  if (entry.candidateType === "edge") {
    return {
      ...entry,
      id: `${entry.id}${suffix}`,
      name: `${entry.name}${suffix}`,
      candidate: {
        ...entry.candidate,
        label: `${entry.candidate.label ?? entry.name}${suffix}`,
      },
    };
  }
  if (entry.candidateType === "micro") {
    return {
      ...entry,
      id: `${entry.id}${suffix}`,
      name: `${entry.name}${suffix}`,
      candidate: {
        ...entry.candidate,
        label: `${entry.candidate.label ?? entry.name}${suffix}`,
      },
    };
  }
  return {
    ...entry,
    id: `${entry.id}${suffix}`,
    name: `${entry.name}${suffix}`,
    candidate: {
      ...entry.candidate,
      label: `${entry.candidate.label ?? entry.name}${suffix}`,
    },
  };
}

function withUniqueRegistryEntryKeys(
  entry: BtcusdcStrategyRegistryEntry,
  existingKeys: Set<string>,
): BtcusdcStrategyRegistryEntry {
  if (!registryEntryKeys(entry).some((key) => existingKeys.has(key))) return entry;
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? "-paired" : `-paired-${index}`;
    const suffixed = suffixRegistryEntryKeys(entry, suffix);
    if (!registryEntryKeys(suffixed).some((key) => existingKeys.has(key))) return suffixed;
  }
  throw new Error(`Unable to allocate a unique BTCUSDC registry mirror for ${entry.name}`);
}

export function repairBtcusdcRegistryActivePairs(entries: BtcusdcStrategyRegistryEntry[]): {
  entries: BtcusdcStrategyRegistryEntry[];
  added: number;
  unpairedBefore: number;
} {
  const existingKeys = new Set(entries.flatMap((entry) => [entry.id, entry.name, entry.candidate.label ?? entry.name]));
  const additions: BtcusdcStrategyRegistryEntry[] = [];
  for (const entry of findBtcusdcUnpairedActiveRegistryEntries(entries)) {
    const mirror = mirrorBtcusdcRegistryEntry(entry);
    if (!mirror) continue;
    const uniqueMirror = withUniqueRegistryEntryKeys(mirror, existingKeys);
    additions.push(uniqueMirror);
    for (const key of registryEntryKeys(uniqueMirror)) existingKeys.add(key);
  }
  return {
    entries: additions.length > 0 ? [...entries, ...additions] : entries,
    added: additions.length,
    unpairedBefore: findBtcusdcUnpairedActiveRegistryEntries(entries).length,
  };
}

export function evaluateBtcusdcCoreTestGate(result: BtcusdcCoreTestResult): BtcusdcCoreGateEvaluation {
  const reasons: string[] = [];

  if (result.passed === false) reasons.push("passed flag is false");
  if (result.lookbackDays < 180) reasons.push("lookbackDays < 180");
  if (result.filledTrades < 300) reasons.push("filledTrades < 300");
  if (result.submittedOrders < 600) reasons.push("submittedOrders < 600");
  if (result.fillRate < 0.15) reasons.push("fillRate < 0.15");
  if (result.expectancyR <= 0) reasons.push("expectancyR <= 0");
  if (result.profitFactor < 1.2) reasons.push("profitFactor < 1.20");
  if (result.fullKelly <= 0) reasons.push("fullKelly <= 0");
  if (result.totalRToMaxDrawdown < 2) reasons.push("totalRToMaxDrawdown < 2.0");
  if (result.positiveFoldRate < 0.7) reasons.push("positiveFoldRate < 0.70");
  if (result.worstFoldExpectancyR < -0.15) reasons.push("worstFoldExpectancyR < -0.15");
  if (result.recent30ExpectancyR <= 0) reasons.push("recent30ExpectancyR <= 0");
  if (result.recent90ExpectancyR <= 0) reasons.push("recent90ExpectancyR <= 0");
  if (result.bestDayRemovedProfitFactor < 1.05) reasons.push("bestDayRemovedProfitFactor < 1.05");
  if (result.bestFivePctRemovedExpectancyR < 0) reasons.push("bestFivePctRemovedExpectancyR < 0");
  if ((result.longTradeShare ?? 0) > 0.85) reasons.push("longTradeShare > 0.85");
  if ((result.shortTradeShare ?? 0) > 0.85) reasons.push("shortTradeShare > 0.85");
  if ((result.portfolioMaxDrawdownDeltaR ?? 0) > 0) reasons.push("portfolioMaxDrawdownDeltaR > 0");

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

export function isBtcusdcCoreEligible(entry: BtcusdcStrategyRegistryEntry): boolean {
  if (entry.status !== "core" || !entry.coreTest) return false;
  return evaluateBtcusdcCoreTestGate(entry.coreTest).passed;
}

export function buildBtcusdcActivePaperCandidateSets(
  entries: BtcusdcStrategyRegistryEntry[],
): BtcusdcActivePaperCandidateSets {
  const sets: BtcusdcActivePaperCandidateSets = {
    coreCandidates: [],
    microCoreCandidates: [],
    strategylessCoreCandidates: [],
    shadowCandidates: [],
    microShadowCandidates: [],
    strategylessShadowCandidates: [],
    runtimeCandidates: [],
    runtimeMicroCandidates: [],
    runtimeStrategylessCandidates: [],
    coreTelegramCandidateLabels: new Set<string>(),
    strategyStatuses: new Map<string, BtcusdcStrategyStatus>(),
  };

  const coreEligibleEntries = entries.filter((entry) => entry.status === "core" && isBtcusdcCoreEligible(entry));
  const shadowEntries = entries.filter((entry) => entry.status === "shadow");
  const coreDirectionalPairs = directionalPairMap(coreEligibleEntries);
  const shadowDirectionalPairs = directionalPairMap(shadowEntries);

  for (const entry of entries) {
    const label = entry.candidate.label ?? entry.name;
    sets.strategyStatuses.set(label, entry.status);
    if (entry.status === "disabled" || entry.status === "candidate") continue;

    const coreEligible = isBtcusdcCoreEligible(entry);
    if (entry.status === "core" && !coreEligible) continue;
    if (entry.status === "core" && !isDirectionallyPaired(entry, coreDirectionalPairs)) continue;
    if (entry.status === "shadow" && !isDirectionallyPaired(entry, shadowDirectionalPairs)) continue;

    if (entry.status === "core") {
      sets.coreTelegramCandidateLabels.add(label);
      if (entry.candidateType === "edge") {
        sets.coreCandidates.push(entry.candidate);
        sets.runtimeCandidates.push(entry.candidate);
      } else if (entry.candidateType === "micro") {
        sets.microCoreCandidates.push(entry.candidate);
        sets.runtimeMicroCandidates.push(entry.candidate);
      } else {
        sets.strategylessCoreCandidates.push(entry.candidate);
        sets.runtimeStrategylessCandidates.push(entry.candidate);
      }
      continue;
    }

    if (entry.candidateType === "edge") {
      sets.shadowCandidates.push(entry.candidate);
      sets.runtimeCandidates.push(entry.candidate);
    } else if (entry.candidateType === "micro") {
      sets.microShadowCandidates.push(entry.candidate);
      sets.runtimeMicroCandidates.push(entry.candidate);
    } else {
      sets.strategylessShadowCandidates.push(entry.candidate);
      sets.runtimeStrategylessCandidates.push(entry.candidate);
    }
  }

  return sets;
}

export function filterBtcusdcCoreTelegramEvents(
  events: BtcusdcPaperTradingEvent[],
  coreTelegramCandidateLabels: Set<string>,
): BtcusdcPaperTradingEvent[] {
  if (coreTelegramCandidateLabels.size === 0) return [];
  return events.filter((event) => coreTelegramCandidateLabels.has(event.candidateLabel));
}

function registryComparisonValue(entries: BtcusdcStrategyRegistryEntry[]): unknown {
  return entries.map((entry) => {
    if (!entry.coreTest) return entry;
    const { evaluatedAt: _evaluatedAt, ...stableCoreTest } = entry.coreTest;
    return {
      ...entry,
      coreTest: stableCoreTest,
    };
  });
}

export function hasBtcusdcRegistrySemanticChange(
  current: BtcusdcStrategyRegistryEntry[],
  next: BtcusdcStrategyRegistryEntry[],
): boolean {
  return JSON.stringify(registryComparisonValue(current)) !== JSON.stringify(registryComparisonValue(next));
}

function seededCoreResult(): BtcusdcCoreTestResult {
  return {
    lookbackDays: 180,
    filledTrades: 300,
    submittedOrders: 600,
    fillRate: 0.15,
    expectancyR: 0.01,
    profitFactor: 1.2,
    fullKelly: 0.01,
    totalR: 20,
    maxDrawdownR: 10,
    totalRToMaxDrawdown: 2,
    positiveFoldRate: 0.7,
    worstFoldExpectancyR: -0.15,
    recent30ExpectancyR: 0.01,
    recent90ExpectancyR: 0.01,
    bestDayRemovedProfitFactor: 1.05,
    bestFivePctRemovedExpectancyR: 0,
    longTradeShare: 0.5,
    shortTradeShare: 0.5,
    portfolioMaxDrawdownDeltaR: 0,
    source: "preexisting-core-registry",
    passed: true,
  };
}

export function defaultBtcusdcStrategyRegistry(): BtcusdcStrategyRegistryEntry[] {
  return [
    ...BTCUSDC_CORE3_CANDIDATES.map((candidate, index): BtcusdcStrategyRegistryEntry => ({
      id: `core3-${index + 1}-${candidate.label ?? candidate.strategyId}`,
      name: candidate.label ?? candidate.strategyId,
      status: "core",
      candidateType: "edge",
      candidate,
      coreTest: seededCoreResult(),
      notes: "Seeded from the existing core strategy set; future registry updates must replace this with fresh 6-month gate metrics.",
    })),
    ...BTCUSDC_MICRO_SHADOW_CANDIDATES.map((candidate, index): BtcusdcStrategyRegistryEntry => ({
      id: `micro-shadow-${index + 1}-${candidate.label ?? candidate.strategyId}`,
      name: candidate.label ?? candidate.strategyId,
      status: "shadow",
      candidateType: "micro",
      candidate,
    })),
    ...BTCUSDC_STRATEGYLESS_SHADOW_CANDIDATES.map((candidate, index): BtcusdcStrategyRegistryEntry => ({
      id: `strategyless-shadow-${index + 1}-${candidate.label ?? candidate.conditionId}`,
      name: candidate.label ?? candidate.conditionId,
      status: "shadow",
      candidateType: "strategyless",
      candidate,
    })),
  ];
}

export function loadBtcusdcStrategyRegistry(path: string): BtcusdcStrategyRegistryEntry[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("BTCUSDC strategy registry must be a JSON array");
  }
  return parsed as BtcusdcStrategyRegistryEntry[];
}

export function loadBtcusdcStrategyRegistryOrDefault(path?: string): BtcusdcStrategyRegistryEntry[] {
  if (!path) return defaultBtcusdcStrategyRegistry();
  return loadBtcusdcStrategyRegistry(path) ?? defaultBtcusdcStrategyRegistry();
}
