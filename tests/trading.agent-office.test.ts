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

  it("turns promising failed core tests into autonomous improvement candidates before the core gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-auto-improve-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "workflow-shadow-wf-promising-low-sample",
            name: "wf-promising-low-sample",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "wf-promising-low-sample",
              strategyId: "inside-bar-expansion-retest-long",
              zoneId: "volumeRank:high+rangeDerivative:expanding",
              entryMode: "limit-half-pullback",
              targetR: 4,
              maxHoldFiveMinuteBars: 12,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 20,
              submittedOrders: 119,
              fillRate: 0.168,
              expectancyR: 0.3928,
              profitFactor: 1.7856,
              fullKelly: 0.12,
              totalR: 7.8,
              maxDrawdownR: 6.1,
              totalRToMaxDrawdown: 1.28,
              positiveFoldRate: 0.5,
              worstFoldExpectancyR: -1,
              recent30ExpectancyR: -0.2,
              recent90ExpectancyR: 0.1,
              bestDayRemovedProfitFactor: 1.2,
              bestFivePctRemovedExpectancyR: 0.04,
              passed: false,
            },
            notes:
              "Demoted by the latest six-month core gate: filledTrades < 300, submittedOrders < 600, totalRToMaxDrawdown < 2.0, positiveFoldRate < 0.70, worstFoldExpectancyR < -0.15, recent30ExpectancyR <= 0",
          },
        ]),
      );

      let labelsAtCoreGate: string[] = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T06:30:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{
            name: string;
            status: string;
            candidateType: string;
            candidate: { zoneId: string; entryMode: string; targetR: number; maxHoldFiveMinuteBars: number };
          }>;
          labelsAtCoreGate = registry.map((entry) => entry.name);
          expect(registry).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "auto-sample-wf-promising-low-sample-volumeRank-high-4r",
                status: "shadow",
                candidateType: "edge",
                candidate: expect.objectContaining({
                  zoneId: "volumeRank:high",
                  entryMode: "limit-half-pullback",
                }),
              }),
              expect.objectContaining({
                name: "auto-fill-wf-promising-low-sample-signal-close-4r",
                status: "shadow",
                candidateType: "edge",
                candidate: expect.objectContaining({
                  entryMode: "limit-signal-close",
                }),
              }),
              expect.objectContaining({
                name: "auto-fold-wf-promising-low-sample-3r-h9",
                status: "shadow",
                candidateType: "edge",
                candidate: expect.objectContaining({
                  targetR: 3,
                  maxHoldFiveMinuteBars: 9,
                }),
              }),
            ]),
          );
        },
      });

      const report = JSON.parse(readFileSync(result.reportPath, "utf8")) as {
        autonomousImprovement?: { candidateDrafts: Array<{ label: string }>; actions: Array<{ failureMode: string }> };
      };
      expect(labelsAtCoreGate).toContain("auto-sample-wf-promising-low-sample-volumeRank-high-4r-long");
      expect(labelsAtCoreGate).toContain("auto-sample-wf-promising-low-sample-volumeRank-high-4r-short");
      expect(report.autonomousImprovement?.actions.map((action) => action.failureMode)).toEqual(
        expect.arrayContaining(["sample_shortage", "low_fill_rate", "fold_fragility"]),
      );
      expect(report.autonomousImprovement?.candidateDrafts.length).toBeGreaterThanOrEqual(4);
      expect(result.roles.find((role) => role.role === "registry_operations")?.summary).toContain(
        "improvement drafts",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips already-registered improvement mutations so later failed strategies can keep advancing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-auto-improve-progress-"));
    try {
      const registryPath = join(dir, "registry.json");
      const sourceEntry = (name: string) => ({
        id: `workflow-shadow-${name}`,
        name,
        status: "shadow",
        candidateType: "edge",
        candidate: {
          label: name,
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high+rangeDerivative:expanding",
          entryMode: "limit-half-pullback",
          targetR: 4,
          maxHoldFiveMinuteBars: 12,
        },
        coreTest: {
          lookbackDays: 180,
          filledTrades: 20,
          submittedOrders: 119,
          fillRate: 0.168,
          expectancyR: 0.3928,
          profitFactor: 1.7856,
          fullKelly: 0.12,
          totalR: 7.8,
          maxDrawdownR: 6.1,
          totalRToMaxDrawdown: 1.28,
          positiveFoldRate: 0.5,
          worstFoldExpectancyR: -1,
          recent30ExpectancyR: -0.2,
          recent90ExpectancyR: 0.1,
          bestDayRemovedProfitFactor: 1.2,
          bestFivePctRemovedExpectancyR: 0.04,
          passed: false,
        },
      });
      const existingMutation = (name: string, label: string) => ({
        id: `auto-shadow-${label}`,
        name: label,
        status: "shadow",
        candidateType: "edge",
        candidate: {
          label,
          strategyId: "inside-bar-expansion-retest-long",
          zoneId: "volumeRank:high",
          entryMode: "limit-half-pullback",
          targetR: label.includes("-3r-h9") ? 3 : 4,
          maxHoldFiveMinuteBars: label.includes("-3r-h9") ? 9 : 12,
        },
        notes: `Existing mutation for ${name}`,
      });
      const duplicateSources = ["wf-old-1", "wf-old-2", "wf-old-3"];
      writeFileSync(
        registryPath,
        JSON.stringify([
          ...duplicateSources.map(sourceEntry),
          sourceEntry("wf-fresh"),
          ...duplicateSources.flatMap((name) => [
            existingMutation(name, `auto-sample-${name}-volumeRank-high-4r`),
            existingMutation(name, `auto-sample-${name}-rangeDerivative-expanding-4r`),
            existingMutation(name, `auto-fill-${name}-signal-close-4r`),
            existingMutation(name, `auto-fold-${name}-3r-h9`),
          ]),
        ]),
      );

      let labelsAtCoreGate: string[] = [];
      await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T06:40:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ name: string }>;
          labelsAtCoreGate = registry.map((entry) => entry.name);
        },
      });

      const newAutoLabels = labelsAtCoreGate.filter(
        (label) => label.startsWith("auto-") && (/-(long|short)$/.test(label) || /-(long|short)-/.test(label)),
      );
      expect(newAutoLabels.length).toBeGreaterThan(0);
      for (const label of newAutoLabels) {
        const opposite = label.includes("-long")
          ? label.replace("-long", "-short")
          : label.replace("-short", "-long");
        expect(labelsAtCoreGate).toContain(opposite);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses second-generation bottleneck agents on promising auto candidates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-auto2-agents-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "auto-shadow-auto-sample-baseline-early-climax-short-rangeRank-high-3r",
            name: "auto-sample-baseline-early-climax-short-rangeRank-high-3r",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "auto-sample-baseline-early-climax-short-rangeRank-high-3r",
              strategyId: "intrabar-early-climax-late-hold-short",
              zoneId: "rangeRank:high",
              entryMode: "limit-half-pullback",
              targetR: 3,
              maxHoldFiveMinuteBars: 9,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 267,
              submittedOrders: 1553,
              fillRate: 0.1719,
              expectancyR: 0.2057,
              profitFactor: 1.303,
              fullKelly: 0.072,
              totalR: 54.93,
              maxDrawdownR: 11,
              totalRToMaxDrawdown: 4.99,
              positiveFoldRate: 0.75,
              worstFoldExpectancyR: -0.2,
              recent30ExpectancyR: 0.1175,
              recent90ExpectancyR: 0.1811,
              bestDayRemovedProfitFactor: 1.25,
              bestFivePctRemovedExpectancyR: 0.15,
              passed: false,
            },
            notes: "Second-generation source: near-pass but still below filledTrades and worstFold gates.",
          },
        ]),
      );

      let labelsAtCoreGate: string[] = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T07:40:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ name: string }>;
          labelsAtCoreGate = registry.map((entry) => entry.name);
        },
      });

      const report = JSON.parse(readFileSync(result.reportPath, "utf8")) as {
        autonomousImprovement?: {
          actions: Array<{ agentTeam: string; failureMode: string; sourceDepth: number }>;
          agentTeams: Array<{ team: string; drafts: number }>;
        };
      };
      expect(labelsAtCoreGate).toContain(
        "auto2-fill-auto-sample-baseline-early-climax-short-rangeRank-high-3r-signal-close-3r",
      );
      expect(labelsAtCoreGate).toContain(
        "auto2-fold-auto-sample-baseline-early-climax-short-rangeRank-high-3r-2r-h6",
      );
      expect(labelsAtCoreGate).toContain(
        "auto2-nearpass-auto-sample-baseline-early-climax-short-rangeRank-high-3r-2r-h6",
      );
      expect(report.autonomousImprovement?.actions.map((action) => action.agentTeam)).toEqual(
        expect.arrayContaining(["fill_access", "fold_stability", "near_pass_exploitation"]),
      );
      expect(report.autonomousImprovement?.actions.every((action) => action.sourceDepth === 1)).toBe(true);
      expect(report.autonomousImprovement?.agentTeams.map((team) => team.team)).toEqual(
        expect.arrayContaining(["fill_access", "fold_stability", "near_pass_exploitation"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates single OHLCV buckets when sample expansion cannot split the zone further", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-bucket-rotation-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "auto-shadow-auto-sample-derivative-compression-short-bodyRatio-small-4r",
            name: "auto-sample-derivative-compression-short-bodyRatio-small-4r",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "auto-sample-derivative-compression-short-bodyRatio-small-4r",
              strategyId: "intrabar-early-climax-late-hold-short",
              zoneId: "bodyRatio:small",
              entryMode: "limit-half-pullback",
              targetR: 4,
              maxHoldFiveMinuteBars: 9,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 137,
              submittedOrders: 454,
              fillRate: 0.302,
              expectancyR: 0.3873,
              profitFactor: 1.541,
              fullKelly: 0.11,
              totalR: 53.06,
              maxDrawdownR: 22,
              totalRToMaxDrawdown: 2.41,
              positiveFoldRate: 0.833,
              worstFoldExpectancyR: -1,
              recent30ExpectancyR: -0.2,
              recent90ExpectancyR: 0.255,
              bestDayRemovedProfitFactor: 1.24,
              bestFivePctRemovedExpectancyR: 0.15,
              passed: false,
            },
          },
        ]),
      );

      let labelsAtCoreGate: string[] = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T07:45:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ name: string }>;
          labelsAtCoreGate = registry.map((entry) => entry.name);
        },
      });

      const report = JSON.parse(readFileSync(result.reportPath, "utf8")) as {
        autonomousImprovement?: { actions: Array<{ agentTeam: string; failureMode: string }> };
      };
      expect(labelsAtCoreGate).toContain(
        "auto2-rotate-auto-sample-derivative-compression-short-bodyRatio-small-4r-bodyRatio-medium-4r-h9",
      );
      expect(report.autonomousImprovement?.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentTeam: "sample_expansion",
            failureMode: "sample_shortage",
          }),
        ]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers autonomous improvement drafts only as long-short paired strategies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "btcusdc-agent-office-paired-auto-"));
    try {
      const registryPath = join(dir, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify([
          {
            id: "auto-shadow-auto-sample-baseline-early-climax-short-rangeRank-high-3r",
            name: "auto-sample-baseline-early-climax-short-rangeRank-high-3r",
            status: "shadow",
            candidateType: "edge",
            candidate: {
              label: "auto-sample-baseline-early-climax-short-rangeRank-high-3r",
              strategyId: "intrabar-early-climax-late-hold-short",
              zoneId: "rangeRank:high",
              entryMode: "limit-half-pullback",
              targetR: 3,
              maxHoldFiveMinuteBars: 9,
            },
            coreTest: {
              lookbackDays: 180,
              filledTrades: 267,
              submittedOrders: 1553,
              fillRate: 0.1719,
              expectancyR: 0.2057,
              profitFactor: 1.303,
              fullKelly: 0.072,
              totalR: 54.93,
              maxDrawdownR: 11,
              totalRToMaxDrawdown: 4.99,
              positiveFoldRate: 0.75,
              worstFoldExpectancyR: -0.2,
              recent30ExpectancyR: 0.1175,
              recent90ExpectancyR: 0.1811,
              bestDayRemovedProfitFactor: 1.25,
              bestFivePctRemovedExpectancyR: 0.15,
              passed: false,
            },
          },
        ]),
      );

      let registryAtCoreGate: Array<{ name: string; candidate: { strategyId: string; zoneId: string } }> = [];
      const result = await runBtcusdcAgentOfficeCycle({
        statePath: join(dir, "state.json"),
        reportDir: join(dir, "reports"),
        registryPath,
        nowIso: "2026-06-16T08:05:00.000Z",
        useModel: false,
        runCoreGate: true,
        allowRegistryWrite: true,
        commandRunner: async () => {
          registryAtCoreGate = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{
            name: string;
            candidate: { strategyId: string; zoneId: string };
          }>;
        },
      });

      const generated = registryAtCoreGate.filter((entry) => entry.name.startsWith("auto2-"));
      const shortFill = generated.find(
        (entry) => entry.name === "auto2-fill-auto-sample-baseline-early-climax-short-rangeRank-high-3r-signal-close-3r",
      );
      const longFill = generated.find(
        (entry) => entry.name === "auto2-fill-auto-sample-baseline-early-climax-long-rangeRank-high-3r-signal-close-3r",
      );

      expect(shortFill?.candidate.strategyId).toBe("intrabar-early-climax-late-hold-short");
      expect(longFill?.candidate.strategyId).toBe("intrabar-early-climax-late-hold-long");
      expect(generated.every((entry) => /-(long|short)(-|$)/.test(entry.candidate.strategyId))).toBe(true);

      const report = JSON.parse(readFileSync(result.reportPath, "utf8")) as {
        autonomousImprovement?: {
          directionalPolicy?: { mode: string; rejectedUnpairedDrafts: number };
          candidateDrafts: Array<{ label: string }>;
        };
      };
      expect(report.autonomousImprovement?.directionalPolicy).toMatchObject({
        mode: "long_short_pairs_only",
        rejectedUnpairedDrafts: 0,
      });
      expect(report.autonomousImprovement?.candidateDrafts.map((draft) => draft.label)).toContain(longFill?.name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
