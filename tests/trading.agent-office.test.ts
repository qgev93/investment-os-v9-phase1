import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
