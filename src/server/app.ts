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

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
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

function aiStatus(env: ServerEnv) {
  return {
    openai: {
      configured: Boolean(env.OPENAI_API_KEY?.trim()),
      model: env.OPENAI_MODEL?.trim() || "gpt-5.5",
    },
    anthropic: {
      configured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
      model: env.ANTHROPIC_MODEL?.trim() || env.AI_MODEL_JUDGE?.trim() || "claude-sonnet-4-6",
    },
  };
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Investment OS AI</title>
  <style>
    :root { color-scheme: light dark; font-family: Arial, "Noto Sans KR", sans-serif; }
    body { margin: 0; background: #f5f7fb; color: #18202f; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 20px; color: #526071; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 20px 0; }
    .panel { background: #fff; border: 1px solid #d9e0ea; border-radius: 8px; padding: 16px; }
    .label { color: #526071; font-size: 13px; margin-bottom: 4px; }
    .value { font-weight: 700; font-size: 18px; }
    .ok { color: #0f7a45; }
    .missing { color: #a3362d; }
    textarea { width: 100%; box-sizing: border-box; min-height: 104px; resize: vertical; border: 1px solid #c9d2df; border-radius: 8px; padding: 12px; font: inherit; background: #fff; color: inherit; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 700; color: #fff; background: #2359c4; cursor: pointer; }
    button.secondary { background: #4a5568; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    pre { min-height: 120px; white-space: pre-wrap; word-break: break-word; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 14px; overflow: auto; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Investment OS AI</h1>
    <p>Claude와 OpenAI API 키 연결 상태를 확인하고 짧은 테스트 호출을 실행합니다.</p>
    <section class="grid">
      <div class="panel">
        <div class="label">OpenAI</div>
        <div id="openai-status" class="value">확인 중</div>
        <div id="openai-model" class="label"></div>
      </div>
      <div class="panel">
        <div class="label">Claude</div>
        <div id="anthropic-status" class="value">확인 중</div>
        <div id="anthropic-model" class="label"></div>
      </div>
    </section>
    <section class="panel">
      <div class="label">테스트 프롬프트</div>
      <textarea id="prompt">한국어로 한 문장만 답해줘. API 연결 테스트 성공.</textarea>
      <div class="actions">
        <button id="test-openai">OpenAI 테스트</button>
        <button id="test-anthropic" class="secondary">Claude 테스트</button>
        <button id="refresh" class="secondary">상태 새로고침</button>
      </div>
      <pre id="result">대기 중</pre>
    </section>
  </main>
  <script>
    const result = document.getElementById("result");
    const promptInput = document.getElementById("prompt");
    const buttons = [...document.querySelectorAll("button")];

    function setBusy(busy) {
      buttons.forEach((button) => { button.disabled = busy; });
    }

    async function loadStatus() {
      const response = await fetch("/ai/status");
      const body = await response.json();
      for (const provider of ["openai", "anthropic"]) {
        const status = body.data[provider];
        const statusEl = document.getElementById(provider + "-status");
        const modelEl = document.getElementById(provider + "-model");
        statusEl.textContent = status.configured ? "연결 준비됨" : "API 키 없음";
        statusEl.className = "value " + (status.configured ? "ok" : "missing");
        modelEl.textContent = "model: " + status.model;
      }
    }

    async function testProvider(provider) {
      setBusy(true);
      result.textContent = provider + " 호출 중...";
      try {
        const response = await fetch("/ai/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, prompt: promptInput.value }),
        });
        const body = await response.json();
        result.textContent = JSON.stringify(body, null, 2);
      } catch (error) {
        result.textContent = String(error);
      } finally {
        setBusy(false);
        await loadStatus();
      }
    }

    document.getElementById("refresh").addEventListener("click", loadStatus);
    document.getElementById("test-openai").addEventListener("click", () => testProvider("openai"));
    document.getElementById("test-anthropic").addEventListener("click", () => testProvider("anthropic"));
    loadStatus().catch((error) => { result.textContent = String(error); });
  </script>
</body>
</html>`;
}

async function callOpenAi(env: ServerEnv, prompt: string) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = env.OPENAI_MODEL?.trim() || "gpt-5.5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 120,
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI API failed with ${response.status}`);

  const outputText =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((item) => typeof item.text === "string")?.text;
  return { provider: "openai", model, text: outputText ?? "" };
}

async function callAnthropic(env: ServerEnv, prompt: string) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const model = env.ANTHROPIC_MODEL?.trim() || env.AI_MODEL_JUDGE?.trim() || "claude-sonnet-4-6";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    content?: Array<{ text?: string; type?: string }>;
  };
  if (!response.ok) throw new Error(payload.error?.message || `Anthropic API failed with ${response.status}`);

  return {
    provider: "anthropic",
    model,
    text: payload.content?.find((item) => typeof item.text === "string")?.text ?? "",
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  env: ServerEnv,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/") {
    sendHtml(response, dashboardHtml());
    return;
  }

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

  if (method === "GET" && url.pathname === "/ai/status") {
    sendJson(response, 200, { ok: true, data: aiStatus(env) });
    return;
  }

  if (method === "POST" && url.pathname === "/ai/test") {
    const body = await readJsonBody(request);
    const provider = stringBodyValue(body, "provider");
    const prompt = stringBodyValue(body, "prompt") ?? "Reply in one short sentence: API connection test.";
    try {
      if (provider === "openai") {
        sendJson(response, 200, { ok: true, data: await callOpenAi(env, prompt) });
        return;
      }
      if (provider === "anthropic") {
        sendJson(response, 200, { ok: true, data: await callAnthropic(env, prompt) });
        return;
      }
      sendJson(response, 400, { ok: false, error: "provider must be openai or anthropic" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown AI error";
      sendJson(response, 502, { ok: false, error: message });
    }
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
