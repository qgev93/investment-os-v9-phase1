import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadPhase1Config } from "../domain/index.js";
import { runPhase1Command } from "../cli/app.js";
import { createPhase1FileStore, createPhase1Store } from "../db/index.js";
import { TelegramBotClient, requireTelegramToken } from "../telegram/client.js";
import { handleTelegramCallback } from "../telegram/callbacks.js";

type ServerEnv = Record<string, string | undefined>;

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function stringBodyValue(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberBodyValue(body: Record<string, unknown>, key: string, fallback: number): number {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getServerStore(env: ServerEnv) {
  return env.DATABASE_URL ? createPhase1Store(env) : createPhase1FileStore(env);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  env: ServerEnv,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/health") {
    const config = loadPhase1Config(env);
    sendJson(response, 200, {
      ok: true,
      data: {
        service: "investment-os-v9-phase1",
        allowPaidProviders: config.allowPaidProviders,
        store: "local_json_or_free_tier",
      },
    });
    return;
  }

  if (method === "POST" && (url.pathname === "/ingest/historical" || url.pathname === "/ingest/daily")) {
    const body = await readJsonBody(request);
    const source = stringBodyValue(body, "source") ?? "fixtures";
    const args = [
      url.pathname.endsWith("daily") ? "ingest:daily" : "ingest:historical",
      "--source",
      source,
    ];

    const file = stringBodyValue(body, "file");
    if (file) {
      args.push("--file", file);
    }
    if (body.dryRun === true) {
      args.push("--dry-run");
    } else {
      args.push("--persist");
    }

    sendJson(response, 200, await runPhase1Command(args, env));
    return;
  }

  if (method === "POST" && url.pathname === "/jit/enqueue") {
    const body = await readJsonBody(request);
    const limit = numberBodyValue(body, "limit", 100);
    sendJson(
      response,
      200,
      await runPhase1Command(["jit:enqueue", "--limit", String(limit), "--persist"], env),
    );
    return;
  }

  if (method === "GET" && url.pathname === "/triage/next") {
    sendJson(response, 200, await runPhase1Command(["triage:next", "--persist"], env));
    return;
  }

  if (method === "POST" && url.pathname === "/telegram/webhook") {
    const body = await readJsonBody(request);
    const callback = body.callback_query as
      | {
          id?: string;
          data?: string;
          message?: { chat?: { id?: number | string } };
        }
      | undefined;

    if (!callback?.id || !callback.data || !callback.message?.chat?.id) {
      sendJson(response, 200, { ok: true, data: { handled: false } });
      return;
    }

    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const result = await handleTelegramCallback({
      store: getServerStore(env),
      client,
      callbackQueryId: callback.id,
      chatId: String(callback.message.chat.id),
      data: callback.data,
      internalizationChatId: env.INTERNALIZATION_CHAT_ID,
    });

    sendJson(response, 200, { ok: true, data: result });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}

export function createPhase1HttpServer(env: ServerEnv = process.env) {
  return createServer((request, response) => {
    route(request, response, env).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown server error";
      sendJson(response, 500, { ok: false, error: message });
    });
  });
}
