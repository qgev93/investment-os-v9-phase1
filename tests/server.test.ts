import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPhase1HttpServer } from "../src/server/app.js";

let openServer: Server | undefined;

async function startServer(storePath: string) {
  const server = createPhase1HttpServer({ PHASE1_STORE_PATH: storePath });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  openServer = server;
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer() {
  if (!openServer) return;
  await new Promise<void>((resolve, reject) => {
    openServer?.close((error) => (error ? reject(error) : resolve()));
  });
  openServer = undefined;
}

async function json(response: Response) {
  return (await response.json()) as { ok: boolean; data?: unknown; error?: string };
}

describe("local Phase 1 HTTP server", () => {
  afterEach(async () => {
    await closeServer();
  });

  it("serves a no-cost health endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phase1-server-"));
    try {
      const baseUrl = await startServer(join(dir, "store.json"));
      const body = await json(await fetch(`${baseUrl}/health`));

      expect(body).toEqual({
        ok: true,
        data: {
          service: "investment-os-v9-phase1",
          allowPaidProviders: false,
          store: "local_json_or_free_tier",
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists fixture ingestion, JIT enqueue, and triage over HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phase1-server-"));
    try {
      const baseUrl = await startServer(join(dir, "store.json"));

      const ingest = await json(
        await fetch(`${baseUrl}/ingest/historical`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "fixtures" }),
        }),
      );
      expect(ingest.data).toMatchObject({
        store: "memory",
        postsFetched: 4,
        paidCalls: 0,
      });

      const jit = await json(
        await fetch(`${baseUrl}/jit/enqueue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 10 }),
        }),
      );
      expect(jit.data).toMatchObject({
        queued: ["lncv-001"],
        paidCalls: 0,
      });

      const triage = await json(await fetch(`${baseUrl}/triage/next`));
      expect(triage.data).toMatchObject({
        unitId: "min-001",
        aiSummary: null,
        aiRecommendation: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns JSON errors for unknown routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phase1-server-"));
    try {
      const baseUrl = await startServer(join(dir, "store.json"));
      const response = await fetch(`${baseUrl}/missing`);
      const body = await json(response);

      expect(response.status).toBe(404);
      expect(body).toEqual({ ok: false, error: "Not found" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
