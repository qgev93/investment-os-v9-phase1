import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManualImportFile } from "../src/ingestion/manualImport.js";
import { runPhase1Command } from "../src/cli/app.js";

describe("manual no-cost import", () => {
  function withTempJson(content: unknown, test: (filePath: string) => Promise<void>) {
    return async () => {
      const dir = mkdtempSync(join(tmpdir(), "phase1-manual-"));
      const filePath = join(dir, "posts.json");
      writeFileSync(filePath, JSON.stringify(content, null, 2));
      try {
        await test(filePath);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
  }

  it(
    "parses manual JSON posts into normalized records",
    withTempJson(
      [
        {
          post_id: "manual-001",
          expert_handle: "@min_anko38",
          text: "수급이 가격보다 먼저 움직인다.",
          created_at: "2026-02-01T00:00:00.000Z",
          trust_layer: "canonical",
          structural_basis: ["original_post"],
        },
      ],
      async (filePath) => {
        const parsed = parseManualImportFile(filePath);
        expect(parsed).toEqual([
          {
            post_id: "manual-001",
            expert_handle: "@min_anko38",
            text: "수급이 가격보다 먼저 움직인다.",
            created_at: "2026-02-01T00:00:00.000Z",
            trust_layer: "canonical",
            is_rt_only: false,
            structural_basis: ["original_post"],
          },
        ]);
      },
    ),
  );

  it(
    "rejects posts outside the Elite 3 handles",
    withTempJson(
      [
        {
          post_id: "bad-001",
          expert_handle: "@someone_else",
          text: "out of scope",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      async (filePath) => {
        expect(() => parseManualImportFile(filePath)).toThrow(
          "Manual import contains non-Elite handle: @someone_else",
        );
      },
    ),
  );

  it(
    "persists manual import through the no-cost store",
    withTempJson(
      [
        {
          post_id: "manual-001",
          expert_handle: "@min_anko38",
          text: "수급이 가격보다 먼저 움직인다.",
          created_at: "2026-02-01T00:00:00.000Z",
          trust_layer: "canonical",
        },
        {
          post_id: "manual-rt-001",
          expert_handle: "@LNCV34",
          text: "",
          created_at: "2026-02-02T00:00:00.000Z",
          trust_layer: "gray",
          is_rt_only: true,
          retweeted_post_id: "external-rt",
        },
      ],
      async (filePath) => {
        const storePath = join(mkdtempSync(join(tmpdir(), "phase1-store-")), "store.json");
        const result = await runPhase1Command(
          ["ingest:historical", "--source", "manual", "--file", filePath, "--persist"],
          { PHASE1_STORE_PATH: storePath },
        );

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
          source: "manual",
          store: "memory",
          postsFetched: 2,
          ledgerRows: 2,
          rtOnlyArchived: 1,
          contextUnits: 1,
          paidCalls: 0,
        });
      },
    ),
  );
});
