import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTelegramOffset, saveTelegramOffset } from "../src/telegram/pollState.js";

describe("Telegram poll state", () => {
  it("defaults to no offset and persists the next offset", () => {
    const dir = mkdtempSync(join(tmpdir(), "phase1-offset-"));
    const file = join(dir, "offset.json");

    try {
      expect(loadTelegramOffset(file)).toBeUndefined();
      saveTelegramOffset(file, 638907277);
      expect(loadTelegramOffset(file)).toBe(638907277);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
