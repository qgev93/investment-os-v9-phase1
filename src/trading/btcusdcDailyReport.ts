import { existsSync, readFileSync } from "node:fs";
import type { BtcusdcPaperTradingEvent, BtcusdcPaperTradingState } from "./btcusdcPaperTrading.js";
import type { BtcusdcStrategyStatus } from "./btcusdcStrategyRegistry.js";

interface StrategyDailyStats {
  label: string;
  status: BtcusdcStrategyStatus | "unknown";
  seedEquity: number;
  strategyEquity: number;
  strategyPeakEquity: number;
  strategyMaxDrawdownPct: number;
  submittedOrders: number;
  filledOrders: number;
  missedOrders: number;
  closedTrades: number;
  wins: number;
  losses: number;
  totalPnlR: number;
  totalPnl: number;
  grossWinR: number;
  grossLossR: number;
  lastEquity: number | null;
}

export interface BtcusdcWorkflowTelegramReportInput {
  generatedAtIso?: string;
  realtimeWorker: string;
  dailyReport: string;
  weeklyResearch: string;
  telegramQuota: string;
  notes?: string[];
}

export interface BtcusdcDailyPerformanceReportOptions {
  seedEquity?: number;
  strategyStatuses?: Map<string, BtcusdcStrategyStatus>;
  state?: BtcusdcPaperTradingState | null;
  generatedAtIso?: string;
}

export interface BtcusdcDailyReportScheduleDecision {
  due: boolean;
  currentDate: string;
}

export interface BtcusdcWeeklyResearchScheduleDecision {
  due: boolean;
  currentWeek: string;
}

function round(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "inf";
  return value.toFixed(digits);
}

function signedR(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${round(value)}R`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function seedLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : round(value);
}

function parseKstReportMinute(reportAtKst: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(reportAtKst.trim());
  if (!match) throw new Error("reportAtKst must use HH:mm");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("reportAtKst must use HH:mm");
  }
  return hours * 60 + minutes;
}

function kstDateParts(nowIso: string): { date: string; minuteOfDay: number } {
  const time = Date.parse(nowIso);
  if (!Number.isFinite(time)) throw new Error("nowIso must be a valid ISO date");
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  return {
    date: kst.toISOString().slice(0, 10),
    minuteOfDay: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

export function shouldSendBtcusdcDailyReport(input: {
  nowIso: string;
  reportAtKst: string;
  lastSentDate?: string;
}): BtcusdcDailyReportScheduleDecision {
  const current = kstDateParts(input.nowIso);
  const reportMinute = parseKstReportMinute(input.reportAtKst);
  return {
    due: current.minuteOfDay >= reportMinute && input.lastSentDate !== current.date,
    currentDate: current.date,
  };
}

function kstWeekParts(nowIso: string): {
  weekStartDate: string;
  minuteOfWeek: number;
} {
  const time = Date.parse(nowIso);
  if (!Number.isFinite(time)) throw new Error("nowIso must be a valid ISO date");
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  const dayOfWeek = kst.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceMonday));
  return {
    weekStartDate: weekStart.toISOString().slice(0, 10),
    minuteOfWeek: daysSinceMonday * 24 * 60 + kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

export function shouldRunBtcusdcWeeklyResearch(input: {
  nowIso: string;
  runDayOfWeek: number;
  runAtKst: string;
  lastStartedWeek?: string;
}): BtcusdcWeeklyResearchScheduleDecision {
  if (!Number.isInteger(input.runDayOfWeek) || input.runDayOfWeek < 0 || input.runDayOfWeek > 6) {
    throw new Error("runDayOfWeek must be 0-6 where 0 is Sunday");
  }
  const current = kstWeekParts(input.nowIso);
  const runMinute = ((input.runDayOfWeek + 6) % 7) * 24 * 60 + parseKstReportMinute(input.runAtKst);
  return {
    due: current.minuteOfWeek >= runMinute && input.lastStartedWeek !== current.weekStartDate,
    currentWeek: current.weekStartDate,
  };
}

function createStats(label: string, status: BtcusdcStrategyStatus | "unknown", seedEquity: number): StrategyDailyStats {
  return {
    label,
    status,
    seedEquity,
    strategyEquity: seedEquity,
    strategyPeakEquity: seedEquity,
    strategyMaxDrawdownPct: 0,
    submittedOrders: 0,
    filledOrders: 0,
    missedOrders: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    totalPnlR: 0,
    totalPnl: 0,
    grossWinR: 0,
    grossLossR: 0,
    lastEquity: null,
  };
}

function profitFactor(stats: Pick<StrategyDailyStats, "grossWinR" | "grossLossR">): number {
  if (stats.grossLossR < 0) return stats.grossWinR / Math.abs(stats.grossLossR);
  return stats.grossWinR > 0 ? Number.POSITIVE_INFINITY : 0;
}

function eventPnlAmount(event: BtcusdcPaperTradingEvent): number {
  const explicitPnl = (event as BtcusdcPaperTradingEvent & { pnl?: number }).pnl;
  if (explicitPnl !== undefined) return explicitPnl;
  return (event.pnlR ?? 0) * (event.riskAmount ?? 0);
}

export function buildBtcusdcWorkflowTelegramMessage(input: BtcusdcWorkflowTelegramReportInput): string {
  const generatedAtIso = input.generatedAtIso ?? new Date().toISOString();
  const lines = [
    "BTCUSDC.P 워크플로우 진행 보고",
    `생성 ${generatedAtIso}`,
    `실시간: ${input.realtimeWorker}`,
    `성과보고: ${input.dailyReport}`,
    `연구: ${input.weeklyResearch}`,
    `발송제한: ${input.telegramQuota}`,
  ];
  for (const note of input.notes ?? []) {
    lines.push(`메모: ${note}`);
  }
  return lines.join("\n");
}

export function loadBtcusdcPaperTradingEventLog(path: string): BtcusdcPaperTradingEvent[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8").trim();
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BtcusdcPaperTradingEvent);
}

export function buildBtcusdcDailyPerformanceTelegramMessage(
  events: BtcusdcPaperTradingEvent[],
  options: BtcusdcDailyPerformanceReportOptions = {},
): string {
  const generatedAtIso = options.generatedAtIso ?? new Date().toISOString();
  const seedEquity = options.seedEquity ?? options.state?.dailySeedEquity ?? options.state?.initialEquity ?? 1_000;
  const byStrategy = new Map<string, StrategyDailyStats>();
  const portfolio = createStats("Portfolio", "unknown", seedEquity);

  for (const event of events) {
    const label = event.candidateLabel ?? "unknown";
    const stats =
      byStrategy.get(label) ??
      createStats(label, options.strategyStatuses?.get(label) ?? "unknown", event.strategyInitialEquity ?? seedEquity);
    byStrategy.set(label, stats);

    if (event.type === "order_submitted") {
      stats.submittedOrders += 1;
      portfolio.submittedOrders += 1;
    } else if (event.type === "order_filled") {
      stats.filledOrders += 1;
      portfolio.filledOrders += 1;
    } else if (event.type === "order_missed") {
      stats.missedOrders += 1;
      portfolio.missedOrders += 1;
    } else if (event.type === "trade_closed") {
      const pnlR = event.pnlR ?? 0;
      const pnl = eventPnlAmount(event);
      stats.closedTrades += 1;
      stats.totalPnlR += pnlR;
      stats.totalPnl += pnl;
      stats.strategyEquity = event.strategyEquity ?? Math.max(0, stats.seedEquity + stats.totalPnl);
      stats.strategyPeakEquity = Math.max(stats.strategyPeakEquity, stats.strategyEquity);
      stats.strategyMaxDrawdownPct = Math.max(
        stats.strategyMaxDrawdownPct,
        event.strategyMaxDrawdownPct ??
          (stats.strategyPeakEquity === 0 ? 0 : (stats.strategyPeakEquity - stats.strategyEquity) / stats.strategyPeakEquity),
      );
      stats.lastEquity = event.equity ?? stats.lastEquity;
      portfolio.closedTrades += 1;
      portfolio.totalPnlR += pnlR;
      portfolio.totalPnl += pnl;
      portfolio.lastEquity = event.equity ?? portfolio.lastEquity;

      if (pnlR > 0) {
        stats.wins += 1;
        stats.grossWinR += pnlR;
        portfolio.wins += 1;
        portfolio.grossWinR += pnlR;
      } else {
        stats.losses += 1;
        stats.grossLossR += pnlR;
        portfolio.losses += 1;
        portfolio.grossLossR += pnlR;
      }
    }
  }

  const strategyStats = [...byStrategy.values()].sort((left, right) => {
    const statusOrder = { core: 0, shadow: 1, candidate: 2, disabled: 3, unknown: 4 };
    const statusDelta = statusOrder[left.status] - statusOrder[right.status];
    return statusDelta === 0 ? left.label.localeCompare(right.label) : statusDelta;
  });
  const portfolioExpectancy = portfolio.closedTrades > 0 ? portfolio.totalPnlR / portfolio.closedTrades : 0;
  const strategyEquityTotal = strategyStats.reduce((sum, stats) => sum + stats.strategyEquity, 0);
  const lines = [
    "BTCUSDC.P 페이퍼 일일 보고",
    `생성 ${generatedAtIso} | 기준시드 ${money(seedEquity)} USDC | 봇 ${strategyStats.length}개`,
    `각 전략 ${seedLabel(seedEquity)} USDC 테스트: 전략별 독립 시드/켈리 계좌 기준`,
    `포트폴리오: 제출 ${portfolio.submittedOrders} | 체결 ${portfolio.filledOrders} | 미체결 ${portfolio.missedOrders} | 종료 ${portfolio.closedTrades} | 승/패 ${portfolio.wins}/${portfolio.losses} | 합계 ${signedR(portfolio.totalPnlR)} | 기대값 ${signedR(portfolioExpectancy)} | PF ${round(profitFactor(portfolio))} | 전략합산자산 ${money(strategyEquityTotal)}`,
  ];

  if (options.state) {
    lines.push(
      `계좌합산: 자산 ${money(options.state.equity)} | 누적 ${signedR(options.state.totalPnlR)} | 최대DD ${round(options.state.maxDrawdownPct * 100)}% | 일일시드일 ${options.state.dailySeedDate}`,
    );
  }

  for (const stats of strategyStats) {
    const expectancy = stats.closedTrades > 0 ? stats.totalPnlR / stats.closedTrades : 0;
    lines.push(
      `[${stats.status}] ${stats.label}: 전략시드 ${money(stats.seedEquity)} USDC | 자산 ${money(stats.strategyEquity)} | 최대DD ${round(stats.strategyMaxDrawdownPct * 100)}% | 제출 ${stats.submittedOrders} | 체결 ${stats.filledOrders} | 미체결 ${stats.missedOrders} | 종료 ${stats.closedTrades} | 승/패 ${stats.wins}/${stats.losses} | 합계 ${signedR(stats.totalPnlR)} | 기대값 ${signedR(expectancy)} | PF ${round(profitFactor(stats))}`,
    );
  }

  if (strategyStats.length === 0) {
    lines.push("이번 보고 구간에 기록된 페이퍼 이벤트가 없습니다.");
  }

  return lines.join("\n");
}
