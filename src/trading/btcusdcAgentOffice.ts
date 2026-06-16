import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  const ideaBriefs = localIdeaBriefs();
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
    roles.push(role("strategy_research", "completed", `${ideaBriefs.length}개 OHLCV-only 연구 방향 생성`, artifacts));
  }
  roles.push(role("approach_research", "completed", "1m 원천과 5m 맥락을 모두 허용하고, 보유시간은 후보별 자유로 열어둠"));

  if (options.runCoreGate && options.commandRunner) {
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
    if (options.allowRegistryWrite) {
      args.push("--registry-out", options.registryPath);
    }
    try {
      await options.commandRunner(args);
      roles.push(role("core_validation", "completed", `6개월 core gate 실행: ${args.join(" ")}`));
    } catch (error) {
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
  });
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
