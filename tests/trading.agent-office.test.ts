import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPhase1Command } from "../src/cli/app.js";
import {
  BTCUSDC_AGENT_OFFICE_ROLES,
  runBtcusdcAgentOfficeCycle,
} from "../src/trading/btcusdcAgentOffice.js";

describe("BTCUSDC local agent office", () => {
  it("runs a local PC-on research company cycle without model keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-"));
    try {
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        nowIso: "2026-06-16T00:00:00.000Z",
        useModel: false,
        runCoreGate: false,
      });

      expect(result.roles.map((role) => role.role)).toEqual(BTCUSDC_AGENT_OFFICE_ROLES);
      expect(result.objective).toContain("1m~5m");
      expect(result.guardrails).toContain("OHLCV only: candles and volume-derived transforms.");
      expect(result.roles.find((role) => role.role === "strategy_research")?.status).toBe("completed");
      expect(result.roles.find((role) => role.role === "core_validation")?.status).toBe("skipped");
      expect(result.telegramText).toContain("BTCUSDC.P Agent Office");
      expect(result.telegramText).toContain("전략연구팀");
      expect(existsSync(result.reportPath)).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toMatchObject({
        cyclesCompleted: 1,
        lastCycleId: result.cycleId,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the agent office through the CLI without sending Telegram", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-cli-"));
    try {
      const result = await runPhase1Command(
        [
          "trading:agent-office-btcusdc",
          "--state-path",
          join(dir, "state.json"),
          "--report-dir",
          join(dir, "reports"),
          "--registry-path",
          join(dir, "registry.json"),
          "--max-cycles",
          "1",
          "--no-model",
          "--no-send",
        ],
        {},
      );

      const data = result.data as {
        mode: string;
        cyclesCompleted: number;
        telegramSent: boolean;
        telegramText: string;
      };
      expect(data).toMatchObject({
        mode: "agent_office",
        cyclesCompleted: 1,
        telegramSent: false,
      });
      expect(data.telegramText).toContain("BTCUSDC.P Agent Office");
      expect(data.telegramText).toContain("워크플로우 진행");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the CLI on local grammar when an API key exists but no model is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-local-default-"));
    try {
      globalThis.fetch = async () => {
        throw new Error("OpenAI should not be called without an explicit agent model");
      };
      const result = await runPhase1Command(
        [
          "trading:agent-office-btcusdc",
          "--state-path",
          join(dir, "state.json"),
          "--report-dir",
          join(dir, "reports"),
          "--registry-path",
          join(dir, "registry.json"),
          "--max-cycles",
          "1",
          "--no-send",
        ],
        { OPENAI_API_KEY: "TEST_KEY" },
      );

      const data = result.data as {
        telegramText: string;
        cycles: Array<{ roles: Array<{ role: string; status: string }> }>;
      };
      expect(data.telegramText).toContain("모델: local/local-ohclv-grammar");
      expect(data.cycles[0]?.roles.find((role) => role.role === "strategy_research")?.status).toBe("completed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the CLI on local grammar when a model is configured but the API key is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-missing-key-"));
    try {
      globalThis.fetch = async () => {
        throw new Error("OpenAI should not be called without an API key");
      };
      const result = await runPhase1Command(
        [
          "trading:agent-office-btcusdc",
          "--state-path",
          join(dir, "state.json"),
          "--report-dir",
          join(dir, "reports"),
          "--registry-path",
          join(dir, "registry.json"),
          "--model",
          "gpt-5.5",
          "--max-cycles",
          "1",
          "--no-send",
        ],
        {},
      );

      const data = result.data as {
        telegramText: string;
        cycles: Array<{ modelProvider: string; modelName: string }>;
      };
      expect(data.telegramText).toContain("모델: local/local-ohclv-grammar");
      expect(data.cycles[0]).toMatchObject({
        modelProvider: "local",
        modelName: "local-ohclv-grammar",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs core gate through the office without letting nested research send Telegram", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-core-gate-"));
    try {
      const calls: string[][] = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        nowIso: "2026-06-16T00:00:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async (args) => {
          calls.push(args);
          return { ok: true };
        },
      });

      expect(result.roles.find((role) => role.role === "core_validation")?.status).toBe("completed");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("trading:research-btcusdc-core-gate");
      expect(calls[0]).toContain("--registry-out");
      expect(calls[0]).toContain("--no-send");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts core gate into cooldown after a Binance rate ban", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-cooldown-"));
    try {
      const calls: string[][] = [];
      const cooldownPath = join(dir, "cooldown.json");
      const first = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        coreGateCacheFile: join(dir, "candles.json"),
        coreGateCooldownPath: cooldownPath,
        nowIso: "2026-06-16T01:30:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async (args) => {
          calls.push(args);
          throw new Error(
            'Binance klines request failed with 418: {"code":-1003,"msg":"Way too many requests; IP banned until 1781574407098."}',
          );
        },
      });

      expect(first.roles.find((role) => role.role === "core_validation")?.status).toBe("failed");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("--cache-file");
      expect(JSON.parse(readFileSync(cooldownPath, "utf8"))).toMatchObject({
        untilIso: "2026-06-16T01:46:47.098Z",
      });

      const second = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        coreGateCooldownPath: cooldownPath,
        nowIso: "2026-06-16T01:31:00.000Z",
        useModel: false,
        runCoreGate: true,
        commandRunner: async (args) => {
          calls.push(args);
        },
      });

      expect(calls).toHaveLength(1);
      expect(second.roles.find((role) => role.role === "core_validation")?.status).toBe("skipped");
      expect(second.roles.find((role) => role.role === "core_validation")?.summary).toContain("cooldown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a BOM-prefixed cooldown file without crashing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-bom-cooldown-"));
    try {
      const cooldownPath = join(dir, "cooldown.json");
      writeFileSync(
        cooldownPath,
        `\uFEFF${JSON.stringify({
          untilIso: "2026-06-16T01:46:47.098Z",
          reason: "manual cooldown",
        })}`,
      );

      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        coreGateCooldownPath: cooldownPath,
        nowIso: "2026-06-16T01:31:00.000Z",
        useModel: false,
        runCoreGate: true,
        commandRunner: async () => {
          throw new Error("core gate should be skipped during cooldown");
        },
      });

      expect(result.roles.find((role) => role.role === "core_validation")?.status).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs core gate from an existing cache even while network cooldown is active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-cache-during-cooldown-"));
    try {
      const calls: string[][] = [];
      const cooldownPath = join(dir, "cooldown.json");
      const cachePath = join(dir, "candles.json");
      writeFileSync(
        cooldownPath,
        JSON.stringify({
          untilIso: "2026-06-16T02:50:47.896Z",
          reason: "recent Binance 418",
        }),
      );
      writeFileSync(cachePath, "[]");

      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath: join(dir, "registry.json"),
        coreGateCacheFile: cachePath,
        coreGateCooldownPath: cooldownPath,
        nowIso: "2026-06-16T02:00:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async (args) => {
          calls.push(args);
        },
      });

      expect(result.roles.find((role) => role.role === "core_validation")?.status).toBe("completed");
      expect(result.roles.find((role) => role.role === "core_validation")?.summary).toContain("cached candles");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("--cache-file");
      expect(calls[0]).toContain(cachePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns prior core-gate failures into a dynamic OHLCV workflow research packet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-workflow-research-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "edge-low-sample",
            name: "edge-low-sample",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "edge-low-sample",
              strategyId: "intrabar-early-climax-late-hold-short",
              zoneId: "rangeRank:high+volumeRank:high",
              entryMode: "limit-half-pullback",
              targetR: 3,
              maxHoldFiveMinuteBars: 9,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 52,
              submittedOrders: 120,
              fillRate: 0.43,
              expectancyR: 0.72,
              profitFactor: 2.1,
              fullKelly: 0.2,
              totalR: 35,
              maxDrawdownR: 7,
              totalRToMaxDrawdown: 5,
              positiveFoldRate: 0.58,
              worstFoldExpectancyR: -1,
              recent30ExpectancyR: 0.4,
              recent90ExpectancyR: 0.59,
              bestDayRemovedProfitFactor: 1.8,
              bestFivePctRemovedExpectancyR: 0.6,
              passed: false,
            },
            notes:
              "Demoted by the latest six-month core gate: filledTrades < 300, submittedOrders < 600, positiveFoldRate < 0.70, worstFoldExpectancyR < -0.15",
          },
        ]),
      );

      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T02:40:00.000Z",
        useModel: false,
        runCoreGate: false,
      });

      const report = JSON.parse(readFileSync(result.reportPath, "utf8")) as {
        workflowResearch?: {
          feedbackLoops: Array<{ failureMode: string }>;
          experimentQueue: Array<{
            hypothesis: string;
            featureAtoms: string[];
            candidateDrafts: Array<{ candidateType: string; label: string }>;
          }>;
        };
      };

      expect(report.workflowResearch?.feedbackLoops.map((item) => item.failureMode)).toContain("fold_fragility");
      expect(report.workflowResearch?.experimentQueue.length).toBeGreaterThanOrEqual(6);
      expect(report.workflowResearch?.experimentQueue.flatMap((item) => item.featureAtoms).join("|")).toContain(
        "rangeDerivative",
      );
      expect(report.workflowResearch?.experimentQueue.flatMap((item) => item.candidateDrafts).length).toBeGreaterThan(0);
      expect(result.roles.find((role) => role.role === "strategy_research")?.summary).toContain("workflow");
      expect(result.roles.find((role) => role.role === "approach_research")?.summary).toContain("failure feedback");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers workflow draft edge candidates before running the core gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-register-drafts-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "edge-low-sample",
            name: "edge-low-sample",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "edge-low-sample",
              strategyId: "intrabar-early-climax-late-hold-short",
              zoneId: "rangeRank:high+volumeRank:high",
              entryMode: "limit-half-pullback",
              targetR: 3,
              maxHoldFiveMinuteBars: 9,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 52,
              submittedOrders: 120,
              fillRate: 0.43,
              expectancyR: 0.72,
              profitFactor: 2.1,
              fullKelly: 0.2,
              totalR: 35,
              maxDrawdownR: 7,
              totalRToMaxDrawdown: 5,
              positiveFoldRate: 0.58,
              worstFoldExpectancyR: -1,
              recent30ExpectancyR: 0.4,
              recent90ExpectancyR: 0.59,
              bestDayRemovedProfitFactor: 1.8,
              bestFivePctRemovedExpectancyR: 0.6,
              passed: false,
            },
            notes:
              "Demoted by the latest six-month core gate: filledTrades < 300, submittedOrders < 600, positiveFoldRate < 0.70, worstFoldExpectancyR < -0.15",
          },
        ]),
      );

      let labelsAtCoreGate: string[] = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T03:00:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{
            name: string;
            status: string;
            candidateType: string;
          }>;
          labelsAtCoreGate = registry.map((entry) => entry.name);
          expect(registry.filter((entry) => entry.name.startsWith("wf-"))).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "wf-inside-expansion-retest-long-3r",
                status: "shadow",
                candidateType: "edge",
              }),
            ]),
          );
        },
      });

      const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ name: string; status: string }>;
      expect(labelsAtCoreGate).toContain("wf-inside-expansion-retest-long-3r");
      expect(registry.filter((entry) => entry.name.startsWith("wf-")).length).toBeGreaterThanOrEqual(12);
      expect(result.roles.find((role) => role.role === "registry_operations")?.summary).toContain("workflow drafts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
