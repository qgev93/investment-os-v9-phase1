import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPhase1HttpServer } from "./server/app.js";

function loadLocalEnv(path = resolve(".env")): void {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnv();

const port = Number(process.env.PORT ?? "4319");
const host = process.env.HOST ?? "127.0.0.1";

const server = createPhase1HttpServer(process.env);
server.listen(port, host, () => {
  console.log(`Investment OS Phase 1 server listening at http://${host}:${port}`);
});
