import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BTCUSDC_AGENT_OFFICE_ROLES = [
  "strategy_research",
  "approach_research",
  "core_validation",
  "risk_governance",
  "registry_operations",
  "reporting",
] as const;

export type BtcusdcAgentOfficeRole = (typeof BTCUSDC_AGENT_OFFICE_ROLES)[number];
export type BtcusdcAgentOfficeRoleStatus = "completed" | "skipped" | "failed";

export interface BtcusdcAgentOfficeRoleReport {
  role: BtcusdcAgentOfficeRole;
  nameKo: string;
  status: BtcusdcAgentOfficeRoleStatus;
  summary: string;
  artifacts?: string[];
  error?: string;
}

export interface BtcusdcAgentOfficeState {
  version: 1;
  objective: string;
  cyclesCompleted: number;
  lastCycleId?: string;
  lastRunAtIso?: string;
  lastModelProvider?: "local" | "openai";
  lastModelName?: string;
  lastReportPath?: string;
  lastRegistryPath?: string;
}

interface BtcusdcAgentOfficeCooldown {
  untilIso?: string;
  reason?: string;
}

interface BtcusdcAgentOfficeWorkflowFeedback {
  strategyName: string;
  failureMode: string;
  evidence: string;
  nextMutation: string;
}

interface BtcusdcAgentOfficeCandidateDraft {
  candidateType: "edge";
  label: string;
  strategyId: string;
  zoneId: string;
  entryMode: "limit-signal-close" | "limit-half-pullback";
  targetR: number;
  maxHoldFiveMinuteBars: number;
  reason: string;
}

interface BtcusdcAgentOfficeWorkflowExperiment {
  id: string;
  hypothesis: string;
  featureAtoms: string[];
  bettingQuestion: string;
  validationFocus: string[];
  candidateDrafts: BtcusdcAgentOfficeCandidateDraft[];
}

interface BtcusdcAgentOfficeWorkflowResearch {
  cycleNumber: number;
  generatedAtIso: string;
  objective: string;
  feedbackLoops: BtcusdcAgentOfficeWorkflowFeedback[];
  experimentQueue: BtcusdcAgentOfficeWorkflowExperiment[];
  ideaBriefs: string[];
}

export interface BtcusdcAgentOfficeCycleOptions {
  statePath: string;
  reportDir: string;
  registryPath: string;
  nowIso?: string;
  useModel?: boolean;
  modelName?: string;
  openAiApiKey?: string;
  runCoreGate?: boolean;
  allowRegistryWrite?: boolean;
  coreGateDays?: number;
  coreGateMaxCandles?: number;
  coreGateCacheFile?: string;
  coreGateCooldownPath?: string;
  coreGateCooldownMs?: number;
  maxReportFiles?: number;
  commandRunner?: (args: string[]) => Promise<unknown>;
}

export interface BtcusdcAgentOfficeCycleResult {
  mode: "agent_office_cycle";
  cycleId: string;
  objective: string;
  guardrails: string[];
  modelProvider: "local" | "openai";
  modelName: string;
  roles: BtcusdcAgentOfficeRoleReport[];
  reportPath: string;
  statePath: string;
  registryPath: string;
  telegramText: string;
}

const OBJECTIVE =
  "Find continuously profitable BTCUSDC.P paper strategies using 1m~5m candle and volume behavior, favorable win-rate/payoff/Kelly structure, and six-month core validation.";

const GUARDRAILS = [
  "OHLCV only: candles and volume-derived transforms.",
  "No external indicators, fundamentals, sentiment, order book, or future leakage.",
  "Every strategy is evaluated as an independent 1000 USDC paper account.",
  "Core promotion requires the existing six-month gate before Telegram paper operation.",
  "Local Agent Office may research and write reports; it cannot place live orders.",
];

const ROLE_NAMES: Record<BtcusdcAgentOfficeRole, string> = {
  strategy_research: "전략연구팀",
  approach_research: "접근연구팀",
  core_validation: "코어검증팀",
  risk_governance: "리스크팀",
  registry_operations: "등록운영팀",
  reporting: "보고팀",
};

function defaultState(): BtcusdcAgentOfficeState {
  return {
    version: 1,
    objective: OBJECTIVE,
    cyclesCompleted: 0,
  };
}

function loadState(path: string): BtcusdcAgentOfficeState {
  if (!existsSync(path)) return defaultState();
  return { ...defaultState(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<BtcusdcAgentOfficeState>) };
}

function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function loadCooldown(path: string | undefined): BtcusdcAgentOfficeCooldown | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as BtcusdcAgentOfficeCooldown;
}

function cooldownActive(cooldown: BtcusdcAgentOfficeCooldown | null, nowIso: string): boolean {
  if (!cooldown?.untilIso) return false;
  return Date.parse(cooldown.untilIso) > Date.parse(nowIso);
}

function cooldownUntilFromError(error: unknown, nowIso: string, fallbackMs: number): string {
  const message = error instanceof Error ? error.message : String(error);
  const banMatch = message.match(/banned until (\d{10,})/i);
  if (banMatch) {
    const timestamp = Number(banMatch[1]);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date(Date.parse(nowIso) + fallbackMs).toISOString();
}

function pruneReportFiles(reportDir: string, maxReportFiles: number | undefined): void {
  if (!maxReportFiles || maxReportFiles <= 0 || !existsSync(reportDir)) return;
  const reports = readdirSync(reportDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(reportDir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const report of reports.slice(maxReportFiles)) {
    unlinkSync(report.path);
  }
}

function cycleIdFrom(nowIso: string, cycleNumber: number): string {
  return `${nowIso.replace(/[:.]/g, "-")}-cycle-${cycleNumber}`;
}

function localIdeaBriefs(): string[] {
  return [
    "큰 몸통봉 이후 1~5분 intrabar path와 거래량 기울기 변화를 조합해 힘이 꺾이는 구간을 찾는다.",
    "저변동 압축 뒤 첫 확장봉의 꼬리/종가 위치/거래량 효율을 나눠 추세 지속과 실패 확장을 분리한다.",
    "승률이 낮아도 3R~5R 손익비가 살아남는 maker-limit pullback 후보를 우선 검증한다.",
    "롱/숏을 동시에 열어두되, 6개월 fold 안정성과 최근 30/90일 양수 조건을 통과한 쪽만 core 후보로 본다.",
    "같은 시점 중복 진입은 grouped risk로 보고, 전략별 독립 1000 USDC 계좌 성과를 따로 집계한다.",
  ];
}

const WORKFLOW_EXPERIMENT_TEMPLATES: BtcusdcAgentOfficeWorkflowExperiment[] = [
  {
    id: "force-bar-low-volume-pullback",
    hypothesis:
      "After a large body force bar, a low-volume counter pullback may create a better payoff than chasing the force bar.",
    featureAtoms: ["bodyRatio:large", "volumeDerivative:falling", "rangeDerivative:compressing", "recentDrift:pullback"],
    bettingQuestion: "Can a maker pullback entry keep losses small while preserving 3R-5R upside?",
    validationFocus: ["submittedOrders >= 600", "filledTrades >= 300", "worstFoldExpectancyR >= -0.15"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-force-pullback-continuation-long-4r",
        strategyId: "three-candle-low-volume-pullback-continuation-long",
        zoneId: "volumeDerivative:falling+rangeDerivative:compressing",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Long-side version of the user's large-body-candle then pullback-volume idea.",
      },
      {
        candidateType: "edge",
        label: "wf-force-pullback-continuation-short-4r",
        strategyId: "three-candle-low-volume-pullback-continuation-short",
        zoneId: "volumeDerivative:falling+rangeDerivative:compressing",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Short-side symmetry check to avoid one-regime overfit.",
      },
    ],
  },
  {
    id: "early-climax-late-hold-payoff",
    hypothesis:
      "A 5m candle whose 1m path makes the extreme early but holds late may be a skewed fade/continuation boundary.",
    featureAtoms: ["intrabarHighMinute:early", "intrabarLowMinute:early", "intrabarMaxVolumeMinute:early", "closePosition"],
    bettingQuestion: "Does early volume concentration let us accept lower win rate for 3R-5R payoff?",
    validationFocus: ["bestFivePctRemovedExpectancyR >= 0", "recent30ExpectancyR > 0", "recent90ExpectancyR > 0"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-early-climax-short-4r-wide-sample",
        strategyId: "intrabar-early-climax-late-hold-short",
        zoneId: "rangeRank:high+volumeRank:high",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Existing promising short skew, widened hold/target variant to test payoff resilience.",
      },
      {
        candidateType: "edge",
        label: "wf-early-climax-long-4r-wide-sample",
        strategyId: "intrabar-early-climax-late-hold-long",
        zoneId: "rangeRank:high+volumeRank:high",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Long symmetry of the early-climax structure.",
      },
    ],
  },
  {
    id: "derivative-exhaustion-reversal",
    hypothesis:
      "First-derivative deceleration in close movement plus fading volume may mark exhaustion where payoff beats hit rate.",
    featureAtoms: ["closeDerivative", "closeAcceleration", "volumeDerivative:falling", "bodyDerivative:compressing"],
    bettingQuestion: "Can deceleration filters reduce worst-fold damage without killing trade count?",
    validationFocus: ["positiveFoldRate >= 0.70", "worstFoldExpectancyR >= -0.15"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-derivative-exhaustion-short-4r",
        strategyId: "derivative-exhaustion-reversal-short",
        zoneId: "closeAcceleration:deceleratingUp+volumeDerivative:falling",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 9,
        reason: "Uses candle first derivative and volume fade only.",
      },
      {
        candidateType: "edge",
        label: "wf-derivative-exhaustion-long-4r",
        strategyId: "derivative-exhaustion-reversal-long",
        zoneId: "closeAcceleration:deceleratingDown+volumeDerivative:falling",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 9,
        reason: "Long-side deceleration symmetry.",
      },
    ],
  },
  {
    id: "wick-stack-absorption",
    hypothesis:
      "Repeated same-side wick rejection across several 5m candles may identify absorption using only candle geometry and volume.",
    featureAtoms: ["wickImbalance", "closePosition", "effortResult:highEffortNoResult", "volumeRank:high"],
    bettingQuestion: "Can repeated wick rejection lift win rate enough while still targeting 3R-4R?",
    validationFocus: ["fillRate >= 0.15", "profitFactor >= 1.20", "bestDayRemovedProfitFactor >= 1.05"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-wick-stack-absorption-long-3r",
        strategyId: "wick-stack-absorption-long",
        zoneId: "effortResult:highEffortNoResult+closePosition:upper",
        entryMode: "limit-signal-close",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Tests repeated lower-wick rejection as an absorption long.",
      },
      {
        candidateType: "edge",
        label: "wf-wick-stack-absorption-short-3r",
        strategyId: "wick-stack-absorption-short",
        zoneId: "effortResult:highEffortNoResult+closePosition:lower",
        entryMode: "limit-signal-close",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Tests repeated upper-wick rejection as an absorption short.",
      },
    ],
  },
  {
    id: "quiet-coil-failed-expansion",
    hypothesis:
      "Low-range and low-volume compression that breaks and fails can be a high payoff mean-reversion zone.",
    featureAtoms: ["rangeDerivative:compressing", "volumeRank:low", "closePosition:failedBreak", "localRangeState:compressing"],
    bettingQuestion: "Does failed expansion create enough asymmetry after fees and maker fill assumptions?",
    validationFocus: ["totalRToMaxDrawdown >= 2.0", "submittedOrders >= 600"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-quiet-coil-failure-short-4r",
        strategyId: "quiet-coil-failed-expansion-short",
        zoneId: "rangeDerivative:compressing+volumeRank:low",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Fades upside failed expansion from candle compression.",
      },
      {
        candidateType: "edge",
        label: "wf-quiet-coil-failure-long-4r",
        strategyId: "quiet-coil-failed-expansion-long",
        zoneId: "rangeDerivative:compressing+volumeRank:low",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 12,
        reason: "Fades downside failed expansion from candle compression.",
      },
    ],
  },
  {
    id: "pressure-shelf-break",
    hypothesis:
      "Repeated rising lows or falling highs against a flat shelf may show one-sided pressure before a maker retest.",
    featureAtoms: ["shelfHighCluster", "shelfLowCluster", "rangeDerivative:compressing", "volumeDerivative:rising"],
    bettingQuestion: "Can shelf pressure improve fill count while keeping payoff above 3R?",
    validationFocus: ["filledTrades >= 300", "fillRate >= 0.15", "fullKelly > 0"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-pressure-shelf-break-long-3r",
        strategyId: "pressure-shelf-break-long",
        zoneId: "rangeDerivative:compressing+volumeDerivative:rising",
        entryMode: "limit-half-pullback",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Long pressure shelf with rising lows.",
      },
      {
        candidateType: "edge",
        label: "wf-pressure-shelf-break-short-3r",
        strategyId: "pressure-shelf-break-short",
        zoneId: "rangeDerivative:compressing+volumeDerivative:rising",
        entryMode: "limit-half-pullback",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Short pressure shelf with falling highs.",
      },
    ],
  },
  {
    id: "low-volume-breakout-trap",
    hypothesis:
      "A boundary break on weak volume that cannot hold may be a cleaner trade than a normal breakout fade.",
    featureAtoms: ["volumeRank:low", "recentHighBreak", "recentLowBreak", "closeBackInside"],
    bettingQuestion: "Can weak breakout traps raise PF after removing the best day?",
    validationFocus: ["bestDayRemovedProfitFactor >= 1.05", "recent90ExpectancyR > 0"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-low-volume-trap-short-4r",
        strategyId: "low-volume-breakout-trap-short",
        zoneId: "volumeRank:low+closePosition:lower",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 9,
        reason: "Short trap after failed weak-volume upside break.",
      },
      {
        candidateType: "edge",
        label: "wf-low-volume-trap-long-4r",
        strategyId: "low-volume-breakout-trap-long",
        zoneId: "volumeRank:low+closePosition:upper",
        entryMode: "limit-half-pullback",
        targetR: 4,
        maxHoldFiveMinuteBars: 9,
        reason: "Long trap after failed weak-volume downside break.",
      },
    ],
  },
  {
    id: "inside-bar-expansion-retest",
    hypothesis:
      "A contained 5m candle followed by expansion may create simple maker retest entries with enough sample size.",
    featureAtoms: ["insideBar", "rangeDerivative:expanding", "volumeRank:high", "closePosition:upper/lower"],
    bettingQuestion: "Can a simpler continuation logic beat more complex path filters over 6 months?",
    validationFocus: ["submittedOrders >= 600", "expectancyR > 0", "portfolioMaxDrawdownDeltaR <= 0"],
    candidateDrafts: [
      {
        candidateType: "edge",
        label: "wf-inside-expansion-retest-long-3r",
        strategyId: "inside-bar-expansion-retest-long",
        zoneId: "volumeRank:high+rangeDerivative:expanding",
        entryMode: "limit-half-pullback",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Simple continuation after stored range breaks upward.",
      },
      {
        candidateType: "edge",
        label: "wf-inside-expansion-retest-short-3r",
        strategyId: "inside-bar-expansion-retest-short",
        zoneId: "volumeRank:high+rangeDerivative:expanding",
        entryMode: "limit-half-pullback",
        targetR: 3,
        maxHoldFiveMinuteBars: 9,
        reason: "Simple continuation after stored range breaks downward.",
      },
    ],
  },
];

function failureModesFromRegistryEntry(entry: Record<string, unknown>): string[] {
  const coreTest = (entry.coreTest && typeof entry.coreTest === "object" ? entry.coreTest : {}) as Record<string, unknown>;
  const notes = typeof entry.notes === "string" ? entry.notes : "";
  const modes = new Set<string>();
  const filledTrades = Number(coreTest.filledTrades ?? 0);
  const submittedOrders = Number(coreTest.submittedOrders ?? 0);
  const expectancyR = Number(coreTest.expectancyR ?? 0);
  const profitFactor = Number(coreTest.profitFactor ?? 0);
  const positiveFoldRate = Number(coreTest.positiveFoldRate ?? 1);
  const worstFoldExpectancyR = Number(coreTest.worstFoldExpectancyR ?? 0);
  const recent30ExpectancyR = Number(coreTest.recent30ExpectancyR ?? 0);
  const recent90ExpectancyR = Number(coreTest.recent90ExpectancyR ?? 0);

  if (filledTrades > 0 && filledTrades < 300) modes.add("sample_shortage");
  if (submittedOrders > 0 && submittedOrders < 600) modes.add("order_frequency_shortage");
  if (positiveFoldRate < 0.7 || worstFoldExpectancyR < -0.15 || notes.includes("worstFoldExpectancyR")) {
    modes.add("fold_fragility");
  }
  if (expectancyR > 0 && profitFactor >= 1.2 && filledTrades < 300) modes.add("positive_skew_low_sample");
  if (recent30ExpectancyR <= 0 || recent90ExpectancyR <= 0) modes.add("recent_decay");
  if (modes.size === 0 && notes) modes.add("unclassified_gate_failure");
  return [...modes];
}

function registryFeedbackLoops(registryPath: string): BtcusdcAgentOfficeWorkflowFeedback[] {
  if (!existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!Array.isArray(parsed)) return [];
    const feedback: BtcusdcAgentOfficeWorkflowFeedback[] = [];
    for (const rawEntry of parsed) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const entry = rawEntry as Record<string, unknown>;
      const name = String(entry.name ?? entry.id ?? "unknown");
      const coreTest = (entry.coreTest && typeof entry.coreTest === "object" ? entry.coreTest : {}) as Record<string, unknown>;
      for (const failureMode of failureModesFromRegistryEntry(entry)) {
        feedback.push({
          strategyName: name,
          failureMode,
          evidence: `filled=${String(coreTest.filledTrades ?? "na")}, orders=${String(coreTest.submittedOrders ?? "na")}, expectancyR=${String(coreTest.expectancyR ?? "na")}, pf=${String(coreTest.profitFactor ?? "na")}, positiveFoldRate=${String(coreTest.positiveFoldRate ?? "na")}, worstFold=${String(coreTest.worstFoldExpectancyR ?? "na")}`,
          nextMutation:
            failureMode === "fold_fragility"
              ? "Split long/short symmetry and add derivative/compression filters before core promotion."
              : failureMode === "sample_shortage" || failureMode === "order_frequency_shortage"
                ? "Widen the condition grammar or reduce over-specific atoms until trade count clears the gate."
                : "Keep the payoff structure but test simpler candle/volume atoms across more regimes.",
        });
      }
    }
    return feedback.slice(0, 12);
  } catch {
    return [];
  }
}

function rotatedExperiments(
  cycleNumber: number,
  feedback: BtcusdcAgentOfficeWorkflowFeedback[],
): BtcusdcAgentOfficeWorkflowExperiment[] {
  const rotation = cycleNumber % WORKFLOW_EXPERIMENT_TEMPLATES.length;
  const rotated = [
    ...WORKFLOW_EXPERIMENT_TEMPLATES.slice(rotation),
    ...WORKFLOW_EXPERIMENT_TEMPLATES.slice(0, rotation),
  ];
  const hasFoldFragility = feedback.some((item) => item.failureMode === "fold_fragility");
  const hasSampleShortage = feedback.some(
    (item) => item.failureMode === "sample_shortage" || item.failureMode === "order_frequency_shortage",
  );
  const prioritized = rotated.filter((experiment) => {
    if (hasFoldFragility && experiment.validationFocus.some((item) => item.includes("worstFold"))) return true;
    if (
      hasSampleShortage &&
      experiment.validationFocus.some((item) => item.includes("submittedOrders") || item.includes("filledTrades"))
    ) {
      return true;
    }
    return false;
  });
  const unique = new Map<string, BtcusdcAgentOfficeWorkflowExperiment>();
  for (const experiment of [...prioritized, ...rotated]) unique.set(experiment.id, experiment);
  return [...unique.values()].slice(0, 8);
}

function buildWorkflowResearch(input: {
  cycleNumber: number;
  nowIso: string;
  registryPath: string;
}): BtcusdcAgentOfficeWorkflowResearch {
  const feedbackLoops = registryFeedbackLoops(input.registryPath);
  const experimentQueue = rotatedExperiments(input.cycleNumber, feedbackLoops);
  const ideaBriefs = [
    ...feedbackLoops.slice(0, 4).map((item) => `failure feedback ${item.failureMode}: ${item.strategyName} -> ${item.nextMutation}`),
    ...experimentQueue.map((experiment) => `${experiment.id}: ${experiment.hypothesis} | atoms=${experiment.featureAtoms.join(",")}`),
  ];
  return {
    cycleNumber: input.cycleNumber,
    generatedAtIso: input.nowIso,
    objective: "Continuously mutate OHLCV-only ideas toward positive expectancy, payoff, Kelly, and fold stability.",
    feedbackLoops,
    experimentQueue,
    ideaBriefs,
  };
}

function extractOpenAiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const fragments: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string") fragments.push(text);
    }
  }
  return fragments.join("\n").trim() || null;
}

async function requestOpenAiBrief(input: {
  apiKey: string;
  modelName: string;
  nowIso: string;
}): Promise<string> {
  const prompt = [
    "You are one member of a BTCUSDC.P strategy research office.",
    "Generate concise OHLCV-only research directions.",
    "Hard constraints: 1m~5m candles/volume only, no indicators, no future leakage, maker-limit paper testing, Kelly risk, six-month core gate.",
    "Prefer creative candle geometry, wick, body, volume slope, first derivative, effort/result, compression/expansion, and long/short symmetry ideas.",
    `Run timestamp: ${input.nowIso}`,
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.modelName,
      input: prompt,
      max_output_tokens: 700,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI brief request failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return extractOpenAiText(payload) ?? "OpenAI returned no text brief.";
}

function role(role: BtcusdcAgentOfficeRole, status: BtcusdcAgentOfficeRoleStatus, summary: string, artifacts?: string[]): BtcusdcAgentOfficeRoleReport {
  return {
    role,
    nameKo: ROLE_NAMES[role],
    status,
    summary,
    artifacts,
  };
}

function buildTelegramText(result: Omit<BtcusdcAgentOfficeCycleResult, "telegramText">): string {
  const lines = [
    "BTCUSDC.P Agent Office",
    `워크플로우 진행 ${result.cycleId}`,
    `목표: ${result.objective}`,
    `모델: ${result.modelProvider}/${result.modelName}`,
    `리포트: ${result.reportPath}`,
    `레지스트리: ${result.registryPath}`,
  ];
  for (const item of result.roles) {
    lines.push(`${item.nameKo}: ${item.status} - ${item.summary}`);
  }
  return lines.join("\n");
}

export async function runBtcusdcAgentOfficeCycle(
  options: BtcusdcAgentOfficeCycleOptions,
): Promise<BtcusdcAgentOfficeCycleResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const state = loadState(options.statePath);
  const cycleNumber = state.cyclesCompleted + 1;
  const cycleId = cycleIdFrom(nowIso, cycleNumber);
  const requestedModelName = options.modelName ?? "local-ohclv-grammar";
  const modelProvider: "local" | "openai" = options.useModel && options.openAiApiKey ? "openai" : "local";
  const modelName = modelProvider === "openai" ? requestedModelName : "local-ohclv-grammar";
  const roles: BtcusdcAgentOfficeRoleReport[] = [];
  const artifacts: string[] = [];

  const workflowResearch = buildWorkflowResearch({
    cycleNumber,
    nowIso,
    registryPath: options.registryPath,
  });
  const ideaBriefs = [...localIdeaBriefs(), ...workflowResearch.ideaBriefs];
  artifacts.push("workflow-research-packet");
  if (modelProvider === "openai" && options.openAiApiKey) {
    try {
      const modelBrief = await requestOpenAiBrief({
        apiKey: options.openAiApiKey,
        modelName,
        nowIso,
      });
      artifacts.push("openai-model-brief");
      ideaBriefs.push(`모델 브리프: ${modelBrief.slice(0, 700)}`);
    } catch (error) {
      roles.push({
        ...role("strategy_research", "failed", "모델 브리프 실패 후 로컬 OHLCV grammar로 계속 진행"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!roles.some((item) => item.role === "strategy_research")) {
    roles.push(
      role(
        "strategy_research",
        "completed",
        `workflow generated ${workflowResearch.experimentQueue.length} OHLCV experiments and ${workflowResearch.feedbackLoops.length} feedback loops`,
        artifacts,
      ),
    );
  }
  roles.push(
    role(
      "approach_research",
      "completed",
      "failure feedback drives open-ended 1m/5m candle-volume grammar; holding time remains candidate-specific",
    ),
  );

  const cooldown = loadCooldown(options.coreGateCooldownPath);
  const hasUsableCoreGateCache = Boolean(options.coreGateCacheFile && existsSync(options.coreGateCacheFile));
  const shouldSkipCoreGateForCooldown = cooldownActive(cooldown, nowIso) && !hasUsableCoreGateCache;
  if (options.runCoreGate && shouldSkipCoreGateForCooldown) {
    roles.push(
      role(
        "core_validation",
        "skipped",
        `core gate cooldown until ${cooldown?.untilIso}; reason: ${cooldown?.reason ?? "recent failure"}`,
      ),
    );
  } else if (options.runCoreGate && options.commandRunner) {
    const args = [
      "trading:research-btcusdc-core-gate",
      "--days",
      String(options.coreGateDays ?? 180),
      "--max-candles",
      String(options.coreGateMaxCandles ?? (options.coreGateDays ?? 180) * 24 * 60),
      "--registry-path",
      options.registryPath,
      "--no-send",
    ];
    if (options.coreGateCacheFile) {
      args.push("--cache-file", options.coreGateCacheFile);
    }
    if (options.allowRegistryWrite) {
      args.push("--registry-out", options.registryPath);
    }
    try {
      await options.commandRunner(args);
      if (options.coreGateCooldownPath) {
        saveJson(options.coreGateCooldownPath, {
          untilIso: nowIso,
          reason: "last core gate succeeded",
        } satisfies BtcusdcAgentOfficeCooldown);
      }
      roles.push(
        role(
          "core_validation",
          "completed",
          `${hasUsableCoreGateCache && cooldownActive(cooldown, nowIso) ? "cached candles로 cooldown 중 " : ""}6개월 core gate 실행: ${args.join(" ")}`,
        ),
      );
    } catch (error) {
      const untilIso = cooldownUntilFromError(error, nowIso, options.coreGateCooldownMs ?? 15 * 60_000);
      if (options.coreGateCooldownPath) {
        saveJson(options.coreGateCooldownPath, {
          untilIso,
          reason: error instanceof Error ? error.message : String(error),
        } satisfies BtcusdcAgentOfficeCooldown);
      }
      roles.push({
        ...role("core_validation", "failed", "6개월 core gate 실행 실패"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    roles.push(role("core_validation", "skipped", "이번 cycle은 후보 생성/계획만 수행; --run-core-gate가 켜지면 검증 실행"));
  }

  roles.push(role("risk_governance", "completed", "승률, 손익비, Kelly, 최대DD, fold 안정성 기준으로만 승격 판단"));
  roles.push(
    role(
      "registry_operations",
      options.allowRegistryWrite ? "completed" : "skipped",
      options.allowRegistryWrite ? "core gate 결과만 registry 반영 허용" : "registry 자동 변경 비활성; 보고서만 기록",
    ),
  );
  roles.push(role("reporting", "completed", "PC-on agent-office 상태를 Telegram/JSON report용 텍스트로 정리"));

  const reportPath = join(options.reportDir, `${cycleId}.json`);
  const resultWithoutTelegram = {
    mode: "agent_office_cycle" as const,
    cycleId,
    objective: OBJECTIVE,
    guardrails: GUARDRAILS,
    modelProvider,
    modelName,
    roles,
    reportPath,
    statePath: options.statePath,
    registryPath: options.registryPath,
  };
  const telegramText = buildTelegramText(resultWithoutTelegram);
  const result: BtcusdcAgentOfficeCycleResult = {
    ...resultWithoutTelegram,
    telegramText,
  };
  saveJson(reportPath, {
    ...result,
    localIdeaBriefs: ideaBriefs,
    workflowResearch,
  });
  pruneReportFiles(options.reportDir, options.maxReportFiles);
  saveJson(options.statePath, {
    ...state,
    version: 1,
    objective: OBJECTIVE,
    cyclesCompleted: cycleNumber,
    lastCycleId: cycleId,
    lastRunAtIso: nowIso,
    lastModelProvider: modelProvider,
    lastModelName: modelName,
    lastReportPath: reportPath,
    lastRegistryPath: options.registryPath,
  } satisfies BtcusdcAgentOfficeState);
  return result;
}
