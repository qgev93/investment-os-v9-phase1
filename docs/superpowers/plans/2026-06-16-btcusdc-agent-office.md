# BTCUSDC Agent Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local PC-on "agent office" loop that keeps researching BTCUSDC.P OHLCV-only strategies and hands validated work into the existing core-gate, registry, Fly, and Telegram workflow.

**Architecture:** Add a focused `btcusdcAgentOffice` module that owns local state, role separation, cycle reports, optional OpenAI model briefs, and safe command orchestration. Expose it through `runPhase1Command` as `trading:agent-office-btcusdc`, plus an npm script for local operation. The office never sends live orders and never bypasses the existing six-month core gate.

**Tech Stack:** TypeScript, Node.js fetch, existing CLI runner, Vitest, local `.phase1` JSON state, existing BTCUSDC trading modules.

---

### Task 1: Agent Office Core Module

**Files:**
- Create: `src/trading/btcusdcAgentOffice.ts`
- Test: `tests/trading.agent-office.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BTCUSDC_AGENT_OFFICE_ROLES,
  runBtcusdcAgentOfficeCycle,
} from "../src/trading/btcusdcAgentOffice.js";

describe("BTCUSDC agent office", () => {
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
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toMatchObject({ cyclesCompleted: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/trading.agent-office.test.ts`

Expected: FAIL because `src/trading/btcusdcAgentOffice.ts` does not exist.

- [ ] **Step 3: Implement minimal module**

Create role constants, local state load/save, report writing, local OHLCV idea generation, optional model placeholder handling, and safe core-gate orchestration hooks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/trading.agent-office.test.ts`

Expected: PASS.

### Task 2: CLI And npm Entry

**Files:**
- Modify: `src/cli/app.ts`
- Modify: `package.json`
- Test: `tests/trading.agent-office.test.ts`

- [ ] **Step 1: Add failing CLI test**

Add a test that calls `runPhase1Command(["trading:agent-office-btcusdc", "--state-path", statePath, "--report-dir", reportDir, "--max-cycles", "1", "--no-model", "--no-send"], env)` and asserts `mode === "agent_office"`, `cyclesCompleted === 1`, and the returned Telegram text contains `BTCUSDC.P Agent Office`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/trading.agent-office.test.ts`

Expected: FAIL because the CLI command is not registered.

- [ ] **Step 3: Implement CLI and script**

Wire `trading:agent-office-btcusdc` to the core module, add optional `--run-core-gate`, `--allow-registry-write`, `--model`, `--interval-ms`, `--max-cycles`, Telegram sending through existing quota, and npm script `trading:agent-office-btcusdc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/trading.agent-office.test.ts`

Expected: PASS.

### Task 3: Verification

**Files:**
- No new files unless verification reveals a gap.

- [ ] **Step 1: Run targeted tests**

Run: `npm.cmd test -- tests/trading.agent-office.test.ts`

- [ ] **Step 2: Run full test suite**

Run: `npm.cmd test`

- [ ] **Step 3: Run runtime typecheck**

Run: `npx.cmd tsc -p tsconfig.runtime.json`

- [ ] **Step 4: Run build**

Run: `npm.cmd run build`

- [ ] **Step 5: Commit and push**

Commit message: `feat: add btcusdc local agent office`
