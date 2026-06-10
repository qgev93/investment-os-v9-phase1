import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function loadTelegramOffset(filePath: string): number | undefined {
  if (!existsSync(filePath)) return undefined;
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { offset?: unknown };
  return typeof parsed.offset === "number" ? parsed.offset : undefined;
}

export function saveTelegramOffset(filePath: string, offset: number): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ offset }, null, 2));
}
