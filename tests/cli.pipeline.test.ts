import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPhase1Command } from "../src/cli/app.js";
import { TRIAGE_ACTION_BUTTONS } from "../src/telegram/labels.js";

describe("Phase 1 local CLI pipelines", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  function isolatedEnv() {
    return {
      PHASE1_STORE_PATH: join(mkdtempSync(join(tmpdir(), "phase1-cli-")), "store.json"),
    };
  }

  it("checks config without requiring paid credentials", async () => {
    const result = await runPhase1Command(["config:check"], {});

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      eliteHandles: ["@min_anko38", "@LNCV34", "@Alisvolatprop12"],
      allowPaidProviders: false,
      mode: "local_or_free_tier",
    });
  });

  it("runs fixture ingestion into pending/archived/verified buckets", async () => {
    const result = await runPhase1Command(
      ["ingest:historical", "--source", "fixtures", "--dry-run"],
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      source: "fixtures",
      dryRun: true,
      postsFetched: 4,
      rtOnlyArchived: 1,
      pendingCandidates: 1,
      canonicalCandidates: 2,
      paidCalls: 0,
    });
  });

  it("persists fixture ingestion when --persist is supplied", async () => {
    const result = await runPhase1Command(
      ["ingest:historical", "--source", "fixtures", "--persist"],
      isolatedEnv(),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      store: "memory",
      postsFetched: 4,
      ledgerRows: 4,
      rtOnlyArchived: 1,
      contextUnits: 3,
      paidCalls: 0,
    });
  });

  it("enqueues a JIT batch from pending fixture candidates only", async () => {
    const result = await runPhase1Command(["jit:enqueue", "--limit", "10"], {});

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      queued: ["lncv-001"],
      paidCalls: 0,
    });
  });

  it("enqueues a persisted JIT batch when --persist is supplied", async () => {
    const env = isolatedEnv();
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);
    const result = await runPhase1Command(["jit:enqueue", "--limit", "10", "--persist"], env);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      store: "memory",
      queued: ["lncv-001"],
      paidCalls: 0,
    });
  });

  it("returns zero-AI triage content for verified non-RT fixture units", async () => {
    const result = await runPhase1Command(["triage:next"], {});

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      unitId: "min-001",
      expertHandle: "@min_anko38",
      aiSummary: null,
      aiRecommendation: null,
      buttons: TRIAGE_ACTION_BUTTONS,
    });
  });

  it("reports cost sentinel state from KRW spend", async () => {
    const result = await runPhase1Command(["cost:status", "--spent-krw", "500000"], {});

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      state: "hard_stop",
      allowNewPaidVerification: false,
      allowNewDeepSession: false,
    });
  });

  it("sends internalization controls for a persisted unit without paid calls", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TRIAGE_CHAT_ID: "1000000001",
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    const calls: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 77 } });
    }) as typeof fetch;

    const result = await runPhase1Command(
      ["telegram:send-internalization", "--unit-id", "min-001"],
      env,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        sent: true,
        messageId: 77,
        unitId: "min-001",
        paidCalls: 0,
      },
    });
    expect(calls[0]).toMatchObject({
      chat_id: "1000000001",
      reply_markup: {
        inline_keyboard: [
          [
            { callback_data: "internalization:min-001:hint" },
            { callback_data: "internalization:min-001:retry" },
          ],
          [
            { callback_data: "internalization:min-001:mastery_check" },
            { callback_data: "internalization:min-001:reschedule" },
          ],
          [{ callback_data: "internalization:min-001:complete" }],
        ],
      },
    });

    const status = await runPhase1Command(["ops:status"], env);
    expect(status.data).toMatchObject({
      activeInternalizationUnitId: "min-001",
      activeInternalizationState: "in_progress",
      internalizationStates: {
        in_progress: 1,
      },
    });
  });

  it("does not resend an awaiting-decision unit when another unsent unit is available", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TRIAGE_CHAT_ID: "1000000001",
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    let sendMessageCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/sendMessage")) {
        sendMessageCalls += 1;
      }
      return Response.json({ ok: true, result: { message_id: 91 } });
    }) as typeof fetch;

    const first = await runPhase1Command(["telegram:send-triage"], env);
    const second = await runPhase1Command(["telegram:send-triage"], env);

    expect(first.data).toMatchObject({
      sent: true,
      unitId: "min-001",
      messageId: 91,
    });
    expect(second.data).toMatchObject({
      sent: true,
      unitId: "alis-001",
      messageId: 91,
    });
    expect(sendMessageCalls).toBe(2);

    const status = await runPhase1Command(["ops:status"], env);
    expect(status.data).toMatchObject({
      triageSentAwaitingDecision: 2,
      triageSentAwaitingDecisionUnitIds: ["min-001", "alis-001"],
    });
  });

  it("marks an already-sent triage card without calling Telegram", async () => {
    const env = isolatedEnv();
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Telegram should not be called");
    }) as typeof fetch;

    const result = await runPhase1Command(
      ["telegram:mark-triage-sent", "--unit-id", "min-001", "--message-id", "69"],
      env,
    );
    const status = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      marked: true,
      unitId: "min-001",
      messageId: 69,
      paidCalls: 0,
    });
    expect(status.data).toMatchObject({
      nextUnsentTriageUnitId: "alis-001",
      triageSentAwaitingDecision: 1,
      triageSentAwaitingDecisionUnitIds: ["min-001"],
    });
  });

  it("counts callback and text attempt updates separately while polling", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 100,
              callback_query: {
                id: "cb-100",
                data: "triage:min-001:internalize",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
            {
              update_id: 101,
              message: {
                chat: { id: 1000000001, username: "example_user", type: "private" },
                text: "\uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uB77C\uB294 \uB73B\uC774\uB2E4.",
              },
            },
          ],
        });
      }

      expect(init?.body).toBeTruthy();
      return Response.json({ ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 88 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 2,
      callbacksHandled: 1,
      textAttemptsHandled: 1,
      nextOffset: 102,
    });
  });

  it("handles /status as a Telegram command instead of a Chairman attempt", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-command-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    const sentMessages: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 200,
              callback_query: {
                id: "cb-200",
                data: "triage:min-001:internalize",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
            {
              update_id: 201,
              message: {
                chat: { id: 1000000001, username: "example_user", type: "private" },
                text: "/status",
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push(body.text);
      }
      return Response.json({ ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 88 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);
    const status = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 2,
      callbacksHandled: 1,
      textCommandsHandled: 1,
      textAttemptsHandled: 0,
    });
    expect(status.data).toMatchObject({
      activeInternalizationUnitId: "min-001",
      chairmanAttempts: 0,
    });
    expect(sentMessages.at(-1)).toContain("체화구분 봇 상태");
    expect(sentMessages.at(-1)).toContain("고를 수 있는 글: 2");
    expect(sentMessages.at(-1)).toContain("아직 안 고른 글: 0");
    expect(sentMessages.at(-1)).toContain("체화 봇에 넘긴 글: min-001");
    expect(sentMessages.at(-1)).toContain("다음에 고를 글");
    expect(sentMessages.at(-1)).toContain("유료 기능 사용: 0번");
    expect(sentMessages.at(-1)).not.toContain("triageSentAwaitingDecision");
    expect(sentMessages.at(-1)).not.toContain("Phase1 status");
    expect(sentMessages.at(-1)).not.toContain("\uC6B4\uC601");
    expect(sentMessages.at(-1)).not.toContain("\uD2B8\uB9AC\uC544\uC9C0");
    expect(sentMessages.at(-1)).not.toContain("\uAC80\uC99D");
    expect(sentMessages.at(-1)).not.toContain("\uC9C0\uAE08 \uC0C1\uD0DC");
    expect(sentMessages.at(-1)).not.toContain("\uB3C8 \uB4DC\uB294 \uC800\uC7A5\uC18C");
    expect(sentMessages.at(-1)).not.toContain("\uACF5\uBD80 \uCE74\uB4DC");
    expect(sentMessages.at(-1)).not.toContain("\uB3C8 \uC4F4 \uD69F\uC218");
  });

  it("handles Korean operations menu buttons", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-menu-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    const sentMessages: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 250,
              callback_query: {
                id: "cb-menu",
                data: "ops:status",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push(body.text);
      }
      return Response.json({ ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 92 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 1,
    });
    expect(sentMessages[0]).toContain("체화구분 봇 상태");
    expect(sentMessages[0]).toContain("X 글을 가져와서");
    expect(sentMessages[0]).toContain("유료 기능 사용: 0번");
    expect(sentMessages[0]).not.toContain("Phase1 status");
    expect(sentMessages[0]).not.toContain("\uC6B4\uC601");
    expect(sentMessages[0]).not.toContain("\uD2B8\uB9AC\uC544\uC9C0");
    expect(sentMessages[0]).not.toContain("\uAC80\uC99D");
    expect(sentMessages[0]).not.toContain("\uC9C0\uAE08 \uC0C1\uD0DC");
    expect(sentMessages[0]).not.toContain("\uB3C8 \uB4DC\uB294 \uC800\uC7A5\uC18C");
    expect(sentMessages[0]).not.toContain("\uACF5\uBD80 \uCE74\uB4DC");
    expect(sentMessages[0]).not.toContain("\uB3C8 \uC4F4 \uD69F\uC218");
  });

  it("explains menu buttons in simple Korean", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-help-offset-")), "offset.json"),
    };

    const sentMessages: string[] = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 255,
              callback_query: {
                id: "cb-help",
                data: "ops:help",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push(body.text);
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 96 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 1,
      results: [{ handled: true, action: "help", helpSent: true }],
    });
    expect(sentMessages[0]).toContain("버튼 설명");
    expect(sentMessages[0]).toContain("구분할 글 받기: 체화할지 고를 글을 하나 받아요.");
    expect(sentMessages[0]).toContain("보류 글 보기: 아직 고르기 애매해서 미뤄둔 글을 봐요.");
    expect(sentMessages[0]).toContain("구분봇 상태: 몇 개를 모았고, 몇 개를 골랐는지 봐요.");
    expect(sentMessages[0]).toContain("체화구분 봇에서는 유료 AI를 쓰지 않아요.");
    expect(callbackAnswers).toEqual(["버튼 설명을 보냈어요"]);
  });

  it("imports prepared X API context units without paid calls", async () => {
    const env = isolatedEnv();
    const filePath = join(mkdtempSync(join(tmpdir(), "phase1-xapi-")), "context_units.json");
    const contextTreesPath = join(mkdtempSync(join(tmpdir(), "phase1-xapi-trees-")), "context_trees.json");
    const enrichedPostsPath = join(mkdtempSync(join(tmpdir(), "phase1-xapi-enriched-")), "raw_posts_enriched.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        min_anko38: [
          {
            unit_id: "min_anko38_1",
            expert_handle: "min_anko38",
            structural_basis: ["conversation_thread", "quote_included"],
            completed_at: "Mon May 11 13:59:08 +0000 2026",
            source_stimulus: {
              status: "present",
              source_post_id: "third-party-1",
              source_text: "제3자가 단 댓글",
            },
            posts: [
              {
                id: "1",
                text: "첫 글",
                createdAt: "Mon May 11 13:58:08 +0000 2026",
                conversationId: "conv-1",
                author: { id: "author-1", userName: "min_anko38" },
                quoted_tweet: { id: "quote-1", text: "인용된 원문", author: { userName: "source" } },
              },
              {
                id: "2",
                text: "내 글에 단 답글",
                createdAt: "Mon May 11 13:59:08 +0000 2026",
                conversationId: "conv-1",
                isReply: true,
                inReplyToId: "1",
                inReplyToUserId: "author-1",
                author: { id: "author-1", userName: "min_anko38" },
              },
              {
                id: "3",
                text: "제3자 댓글에 단 답글",
                createdAt: "Mon May 11 14:00:08 +0000 2026",
                conversationId: "conv-1",
                isReply: true,
                inReplyToId: "third-party-1",
                inReplyToUserId: "third-party",
                author: { id: "author-1", userName: "min_anko38" },
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      contextTreesPath,
      JSON.stringify({
        min_anko38: [
          {
            id: "3",
            author: "min_anko38",
            text: "제3자 댓글에 단 답글",
            createdAt: "Mon May 11 14:00:08 +0000 2026",
            type: "reply",
            children: [
              {
                id: "third-party-1",
                author: "other",
                text: "제3자가 단 댓글",
                createdAt: "Mon May 11 13:50:08 +0000 2026",
                type: "reply",
                children: [],
              },
            ],
          },
          {
            id: "1",
            author: "min_anko38",
            text: "첫 글",
            createdAt: "Mon May 11 13:58:08 +0000 2026",
            type: "quote",
            children: [
              {
                id: "quote-1",
                author: "source",
                text: "인용된 원문",
                createdAt: "Mon May 11 13:40:08 +0000 2026",
                type: "quote",
                children: [
                  {
                    id: "quote-root",
                    author: "root_source",
                    text: "인용 원문이 다시 인용한 글",
                    createdAt: "Mon May 11 13:30:08 +0000 2026",
                    type: "original",
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      enrichedPostsPath,
      JSON.stringify({
        _third_party: [
          {
            id: "quote-root",
            text: "인용 원문이 다시 인용한 글",
            createdAt: "Mon May 11 13:30:08 +0000 2026",
            author: { userName: "root_source" },
          },
          {
            id: "quote-1",
            text: "인용된 원문",
            createdAt: "Mon May 11 13:40:08 +0000 2026",
            author: { userName: "source" },
            quoted_tweet: { id: "quote-root", text: "인용 원문이 다시 인용한 글", author: { userName: "root_source" } },
          },
        ],
      }),
    );

    const result = await runPhase1Command(
      [
        "ingest:historical",
        "--source",
        "xapi",
        "--file",
        filePath,
        "--context-trees",
        contextTreesPath,
        "--raw-posts-enriched",
        enrichedPostsPath,
        "--persist",
      ],
      env,
    );
    const next = await runPhase1Command(["triage:next", "--persist"], env);

    expect(result.data).toMatchObject({
      source: "xapi",
      postsFetched: 3,
      contextUnits: 1,
      paidCalls: 0,
    });
    expect(next.data).toMatchObject({
      unitId: "min_anko38_1",
      expertHandle: "@min_anko38",
      canonicalStatus: "verified",
    });
    const originalText = String((next.data as { originalText: string }).originalText);
    expect(originalText).toContain("@root_source · 2026-05-11 22:30 KST\n인용 원문이 다시 인용한 글");
    expect(originalText).toContain("X 링크: https://x.com/root_source/status/quote-root");
    expect(originalText).toContain("@source · 2026-05-11 22:40 KST\n인용된 원문");
    expect(originalText.indexOf("@root_source · 2026-05-11 22:30 KST\n인용 원문이 다시 인용한 글")).toBeLessThan(originalText.indexOf("@source · 2026-05-11 22:40 KST\n인용된 원문"));
    expect(originalText.indexOf("@source · 2026-05-11 22:40 KST\n인용된 원문")).toBeLessThan(originalText.indexOf("[1]\n@min_anko38 · 2026-05-11 22:58 KST"));
    expect(originalText).not.toContain("답글 단 댓글");
    expect(originalText).not.toContain("원본 흐름");
    expect(originalText).not.toContain("게시일");
    expect(originalText).not.toContain("인용 원문(");
    expect(originalText).toContain("@other · 2026-05-11 22:50 KST\n제3자가 단 댓글");
  });

  it("lets users return to the main menu from helper messages", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-menu-return-offset-")), "offset.json"),
    };

    const sentMessages: Array<{ text: string; callbacks?: string[]; labels?: string[] }> = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 256,
              callback_query: {
                id: "cb-help",
                data: "ops:help",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
            {
              update_id: 257,
              callback_query: {
                id: "cb-menu",
                data: "ops:menu",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        const buttons = body.reply_markup?.inline_keyboard.flat() ?? [];
        sentMessages.push({
          text: body.text,
          callbacks: buttons.map((button: { callback_data: string }) => button.callback_data),
          labels: buttons.map((button: { text: string }) => button.text),
        });
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 97 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 2,
      callbacksHandled: 2,
      results: [
        { handled: true, action: "help", helpSent: true },
        { handled: true, action: "menu", menuSent: true },
      ],
    });
    expect(sentMessages[0]?.callbacks).toContain("ops:menu");
    expect(sentMessages[0]?.labels).toContain("\uBA54\uB274\uB85C \uB3CC\uC544\uAC00\uAE30");
    expect(sentMessages[1]?.text).toContain("\uCCB4\uD654\uD560\uC9C0 \uBA3C\uC800 \uACE8\uB77C\uBCFC\uAC8C\uC694");
    expect(sentMessages[1]?.callbacks).toEqual([
      "ops:send_next_triage",
      "ops:pending_cards",
      "ops:status",
      "ops:help",
    ]);
    expect(callbackAnswers).toEqual([
      "\uBC84\uD2BC \uC124\uBA85\uC744 \uBCF4\uB0C8\uC5B4\uC694",
      "\uBA54\uB274\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4",
    ]);
  });

  it("ignores the removed manual import menu callback", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-manual-help-offset-")), "offset.json"),
    };

    const sentMessages: Array<{ text: string; callbacks?: string[]; labels?: string[] }> = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 258,
              callback_query: {
                id: "cb-removed-manual-help",
                data: "ops:manual_import_help",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        const buttons = body.reply_markup?.inline_keyboard.flat() ?? [];
        sentMessages.push({
          text: body.text,
          callbacks: buttons.map((button: { callback_data: string }) => button.callback_data),
          labels: buttons.map((button: { text: string }) => button.text),
        });
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 98 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 0,
      results: [
        {
          handled: false,
        },
      ],
    });
    expect(sentMessages).toEqual([]);
    expect(callbackAnswers).toEqual(["\uCC98\uB9AC\uD558\uC9C0 \uC54A\uC74C"]);
  });

  it("does not import pasted Telegram text as a manual post", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-manual-text-offset-")), "offset.json"),
    };

    const sentMessages: Array<{ text: string; callbacks?: string[] }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 259,
              message: {
                chat: { id: 1000000001, username: "example_user", type: "private" },
                text: [
                  "post_id: manual-telegram-001",
                  "expert_handle: @min_anko38",
                  "\uD14D\uC2A4\uD2B8: \uAC00\uACA9\uBCF4\uB2E4 \uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uC790.",
                  "trust_layer: canonical",
                ].join("\n"),
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push({
          text: body.text,
          callbacks: body.reply_markup?.inline_keyboard.flat().map((button: { callback_data: string }) => button.callback_data),
        });
      }
      return Response.json({ ok: true, result: { message_id: 99 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);
    const status = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      textAttemptsHandled: 0,
      results: [
        {
          handled: false,
          reason: "no_active_internalization",
        },
      ],
    });
    expect(status.data).toMatchObject({
      ledgerPosts: 0,
      contextUnits: 0,
      verifiedUnits: 0,
      nextUnsentTriageUnitId: null,
      paidCalls: 0,
    });
    expect(sentMessages).toEqual([]);
  });

  it("sends the next unsent card from a menu button", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-next-card-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    const sentMessages: string[] = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 260,
              callback_query: {
                id: "cb-next-card",
                data: "ops:send_next_triage",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push(body.text);
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 101 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);
    const status = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 1,
      results: [
        {
          handled: true,
          action: "send_next_triage",
          sent: true,
          unitId: "min-001",
          messageId: 101,
          requiresPaidModel: false,
        },
      ],
    });
    expect(sentMessages[0]).toContain("\uAE00 #min-001");
    expect(sentMessages[0]).toContain("@min_anko38");
    expect(callbackAnswers).toEqual(["\uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4"]);
    expect(status.data).toMatchObject({
      triageSentAwaitingDecision: 1,
      triageSentAwaitingDecisionUnitIds: ["min-001"],
      nextUnsentTriageUnitId: "alis-001",
      paidCalls: 0,
    });
  });

  it("sends a Korean operations menu with buttons", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TRIAGE_CHAT_ID: "1000000001",
      TELEGRAM_MENU_STATE_PATH: join(mkdtempSync(join(tmpdir(), "phase1-menu-state-")), "menu.json"),
    };
    const calls: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 93 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:send-menu"], env);

    expect(result.data).toMatchObject({
      sent: true,
      messageId: 93,
      paidCalls: 0,
    });
    expect(calls[0]).toMatchObject({
      chat_id: "1000000001",
      text: expect.stringContaining("\uCCB4\uD654\uD560\uC9C0 \uBA3C\uC800 \uACE8\uB77C\uBCFC\uAC8C\uC694"),
      reply_markup: {
        inline_keyboard: [
          [{ text: "\uAD6C\uBD84\uD560 \uAE00 \uBC1B\uAE30", callback_data: "ops:send_next_triage" }],
          [{ text: "\uBCF4\uB958 \uAE00 \uBCF4\uAE30", callback_data: "ops:pending_cards" }],
          [{ text: "\uAD6C\uBD84\uBD07 \uC0C1\uD0DC", callback_data: "ops:status" }],
          [{ text: "\uB3C4\uC6C0\uB9D0", callback_data: "ops:help" }],
        ],
      },
    });
    expect(String((calls[0] as { text: string }).text)).not.toContain("\uB3C8 \uB4DC\uB294 \uC800\uC7A5\uC18C");
  });

  it("resumes the active learning card from a menu button", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TRIAGE_CHAT_ID: "1000000001",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-resume-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    globalThis.fetch = vi.fn(async () =>
      Response.json({ ok: true, result: { message_id: 111 } }),
    ) as typeof fetch;
    await runPhase1Command(["telegram:send-internalization", "--unit-id", "alis-001"], env);

    const sentMessages: Array<{ text: string; callbacks?: string[] }> = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 270,
              callback_query: {
                id: "cb-resume",
                data: "ops:resume_learning",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push({
          text: body.text,
          callbacks: body.reply_markup?.inline_keyboard.flat().map((button: { callback_data: string }) => button.callback_data),
        });
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 112 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 1,
      results: [
        {
          handled: true,
          action: "resume_learning",
          sent: true,
          unitId: "alis-001",
          requiresPaidModel: false,
        },
      ],
    });
    expect(sentMessages[0]?.text).toContain("\uBA3C\uC800 \uC6D0\uBB38 \uBCF4\uAE30");
    expect(sentMessages[0]?.text).toContain("@Alisvolatprop12");
    expect(sentMessages[0]?.callbacks).toEqual([
      "internalization:alis-001:hint",
      "internalization:alis-001:retry",
      "internalization:alis-001:mastery_check",
      "internalization:alis-001:reschedule",
      "internalization:alis-001:complete",
    ]);
    expect(callbackAnswers).toEqual(["\uD559\uC2B5 \uCE74\uB4DC\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4"]);
  });

  it("shows pending cards that are not ready for learning yet", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-pending-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    const sentMessages: string[] = [];
    const callbackAnswers: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 280,
              callback_query: {
                id: "cb-pending",
                data: "ops:pending_cards",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }

      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") {
        sentMessages.push(body.text);
      }
      if (method === "answerCallbackQuery") {
        callbackAnswers.push(body.text);
        return Response.json({ ok: true, result: true });
      }
      return Response.json({ ok: true, result: { message_id: 113 } });
    }) as typeof fetch;

    const result = await runPhase1Command(["telegram:poll-once"], env);

    expect(result.data).toMatchObject({
      updatesSeen: 1,
      callbacksHandled: 1,
      results: [
        {
          handled: true,
          action: "pending_cards",
          count: 1,
          requiresPaidModel: false,
        },
      ],
    });
    expect(sentMessages[0]).toContain("\uB300\uAE30 \uCE74\uB4DC");
    expect(sentMessages[0]).toContain("lncv-001");
    expect(sentMessages[0]).toContain("@LNCV34");
    expect(sentMessages[0]).toContain("\uC790\uB3D9 \uD655\uC778\uC740 \uAEBC\uC838 \uC788\uC2B5\uB2C8\uB2E4");
    expect(sentMessages[0]).not.toContain("AI \uD574\uC11D");
    expect(callbackAnswers).toEqual(["\uB300\uAE30 \uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4"]);
  });

  it("does not send the same operations menu twice unless forced", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TRIAGE_CHAT_ID: "1000000001",
      TELEGRAM_MENU_STATE_PATH: join(mkdtempSync(join(tmpdir(), "phase1-menu-state-")), "menu.json"),
    };
    const calls: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 93 + calls.length } });
    }) as typeof fetch;

    const first = await runPhase1Command(["telegram:send-menu"], env);
    const second = await runPhase1Command(["telegram:send-menu"], env);
    const forced = await runPhase1Command(["telegram:send-menu", "--force"], env);

    expect(first.data).toMatchObject({ sent: true, messageId: 94 });
    expect(second.data).toMatchObject({
      sent: false,
      reason: "menu_already_sent",
      messageId: 94,
      paidCalls: 0,
    });
    expect(forced.data).toMatchObject({ sent: true, messageId: 95 });
    expect(calls).toHaveLength(2);
  });

  it("runs a free local Telegram polling loop for a bounded number of iterations", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-loop-offset-")), "offset.json"),
    };
    let getUpdatesCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        return Response.json({ ok: true, result: [] });
      }
      return Response.json({ ok: true, result: true });
    }) as typeof fetch;

    const result = await runPhase1Command(
      ["telegram:poll-loop", "--interval-ms", "0", "--max-iterations", "2"],
      env,
    );

    expect(result.data).toMatchObject({
      mode: "local_polling",
      iterations: 2,
      updatesSeen: 0,
      callbacksHandled: 0,
      textAttemptsHandled: 0,
      paidCalls: 0,
    });
    expect(getUpdatesCalls).toBe(2);
  });

  it("reports local operations status without calling paid providers", async () => {
    const env = isolatedEnv();
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);
    await runPhase1Command(["jit:enqueue", "--limit", "10", "--persist"], env);

    const result = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      store: "memory",
      ledgerPosts: 4,
      rtOnlyArchived: 1,
      contextUnits: 3,
      verifiedUnits: 2,
      pendingUnits: 1,
      triageDecisions: {},
      activeInternalizationUnitId: null,
      nextUnsentTriageUnitId: "min-001",
      chairmanAttempts: 0,
      paidCalls: 0,
    });
  });

  it("includes internalization states in operations status", async () => {
    const env = {
      ...isolatedEnv(),
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_OFFSET_PATH: join(mkdtempSync(join(tmpdir(), "phase1-state-offset-")), "offset.json"),
    };
    await runPhase1Command(["ingest:historical", "--source", "fixtures", "--persist"], env);

    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split("/").at(-1);
      if (method === "getUpdates") {
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 300,
              callback_query: {
                id: "cb-300",
                data: "triage:min-001:internalize",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
            {
              update_id: 301,
              callback_query: {
                id: "cb-301",
                data: "internalization:min-001:reschedule",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        });
      }
      return Response.json({ ok: true, result: method === "answerCallbackQuery" ? true : { message_id: 90 } });
    }) as typeof fetch;

    await runPhase1Command(["telegram:poll-once"], env);
    const result = await runPhase1Command(["ops:status"], env);

    expect(result.data).toMatchObject({
      internalizationStates: {
        rescheduled: 1,
      },
      activeInternalizationState: "rescheduled",
    });
  });
});
