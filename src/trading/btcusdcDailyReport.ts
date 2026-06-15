import { existsSync, readFileSync } from "node:fs";
import type { BtcusdcPaperTradingEvent, BtcusdcPaperTradingState } from "./btcusdcPaperTrading.js";
import type { BtcusdcStrategyStatus } from "./btcusdcStrategyRegistry.js";

interface StrategyDailyStats {
  label: string;
  status: BtcusdcStrategyStatus | "unknown";
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

function createStats(label: string, status: BtcusdcStrategyStatus | "unknown"): StrategyDailyStats {
  return {
    label,
    status,
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
  const portfolio = createStats("Portfolio", "unknown");

  for (const event of events) {
    const label = event.candidateLabel ?? "unknown";
    const stats =
      byStrategy.get(label) ??
      createStats(label, options.strategyStatuses?.get(label) ?? "unknown");
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
      const pnl = (event as BtcusdcPaperTradingEvent & { pnl?: number }).pnl ?? 0;
      stats.closedTrades += 1;
      stats.totalPnlR += pnlR;
      stats.totalPnl += pnl;
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
  const lines = [
    "BTCUSDC.P Paper Daily",
    `generated ${generatedAtIso} | seed ${money(seedEquity)} USDC | bots ${strategyStats.length}`,
    `Portfolio: submitted ${portfolio.submittedOrders} | filled ${portfolio.filledOrders} | missed ${portfolio.missedOrders} | closed ${portfolio.closedTrades} | W/L ${portfolio.wins}/${portfolio.losses} | total ${signedR(portfolio.totalPnlR)} | exp ${signedR(portfolioExpectancy)} | PF ${round(profitFactor(portfolio))}`,
  ];

  if (options.state) {
    lines.push(
      `state equity ${money(options.state.equity)} | total ${signedR(options.state.totalPnlR)} | maxDD ${round(options.state.maxDrawdownPct * 100)}% | daily ${options.state.dailySeedDate}`,
    );
  }

  for (const stats of strategyStats) {
    const expectancy = stats.closedTrades > 0 ? stats.totalPnlR / stats.closedTrades : 0;
    lines.push(
      `[${stats.status}] ${stats.label}: submitted ${stats.submittedOrders} | filled ${stats.filledOrders} | missed ${stats.missedOrders} | closed ${stats.closedTrades} | W/L ${stats.wins}/${stats.losses} | total ${signedR(stats.totalPnlR)} | exp ${signedR(expectancy)} | PF ${round(profitFactor(stats))}`,
    );
  }

  if (strategyStats.length === 0) {
    lines.push("No paper events recorded for this report window.");
  }

  return lines.join("\n");
}
