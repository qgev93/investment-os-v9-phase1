import { describe, expect, it } from "vitest";
import {
  TelegramBotClient,
  buildTelegramInternalizationMessage,
  buildTelegramOpsMenuMessage,
  buildTelegramTriageMessage,
  requireTelegramToken,
} from "../src/telegram/client.js";

describe("Telegram Bot API client", () => {
  it("requires a token without leaking one in the error", () => {
    expect(() => requireTelegramToken({})).toThrow("TELEGRAM_BOT_TOKEN is required");
  });

  it("calls getMe through the Bot API", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TelegramBotClient({
      token: "TEST_TOKEN",
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          result: { id: 1, is_bot: true, username: "phase1_test_bot" },
        });
      },
    });

    await expect(client.getMe()).resolves.toEqual({
      id: 1,
      isBot: true,
      username: "phase1_test_bot",
    });
    expect(calls[0]?.url).toBe("https://api.telegram.org/botTEST_TOKEN/getMe");
  });

  it("fetches updates and normalizes chat ids", async () => {
    const calls: Array<{ body?: string }> = [];
    const client = new TelegramBotClient({
      token: "TEST_TOKEN",
      fetchFn: async (_url, init) => {
        calls.push({ body: init?.body ? String(init.body) : undefined });
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                chat: { id: -1001, title: "triage", type: "channel" },
                text: "hello",
              },
            },
          ],
        });
      },
    });

    await expect(client.getUpdates(123)).resolves.toEqual([
      {
        updateId: 10,
        callbackQueryId: null,
        callbackData: null,
        chatId: "-1001",
        chatTitle: "triage",
        chatType: "channel",
        text: "hello",
      },
    ]);
    expect(calls[0]?.body).toBe(JSON.stringify({ offset: 123 }));
  });

  it("normalizes callback query updates", async () => {
    const client = new TelegramBotClient({
      token: "TEST_TOKEN",
      fetchFn: async () =>
        Response.json({
          ok: true,
          result: [
            {
              update_id: 11,
              callback_query: {
                id: "cb-1",
                data: "triage:min-001:internalize",
                message: {
                  chat: { id: 1000000001, username: "example_user", type: "private" },
                },
              },
            },
          ],
        }),
    });

    await expect(client.getUpdates()).resolves.toEqual([
      {
        updateId: 11,
        callbackQueryId: "cb-1",
        callbackData: "triage:min-001:internalize",
        chatId: "1000000001",
        chatTitle: "example_user",
        chatType: "private",
        text: null,
      },
    ]);
  });

  it("answers callback queries", async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const client = new TelegramBotClient({
      token: "TEST_TOKEN",
      fetchFn: async (url, init) => {
        calls.push({
          method: String(url).split("/").at(-1) ?? "",
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ ok: true, result: true });
      },
    });

    await client.answerCallbackQuery("cb-1", "Saved");

    expect(calls).toEqual([
      {
        method: "answerCallbackQuery",
        body: { callback_query_id: "cb-1", text: "Saved" },
      },
    ]);
  });

  it("sends triage cards with inline callback buttons", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = new TelegramBotClient({
      token: "TEST_TOKEN",
      fetchFn: async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ ok: true, result: { message_id: 42 } });
      },
    });

    const message = buildTelegramTriageMessage({
      unitId: "min-001",
      expertHandle: "@min_anko38",
      originalText: "\uD604\uAE08\uD750\uB984\uC774 \uBA3C\uC800\uACE0 \uAC00\uACA9\uC740 \uADF8 \uB2E4\uC74C\uC774\uB2E4.",
      canonicalStatus: "verified",
    });
    await client.sendMessage("-1001", message);

    expect(calls[0]?.url).toBe("https://api.telegram.org/botTEST_TOKEN/sendMessage");
    expect(calls[0]?.body).toMatchObject({
      chat_id: "-1001",
      text: expect.stringContaining("@min_anko38"),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\uCCB4\uD654\uD560\uB798\uC694", callback_data: "triage:min-001:internalize" },
            { text: "\uB118\uAE38\uB798\uC694", callback_data: "triage:min-001:skip" },
            { text: "\uBCF4\uB958\uD560\uB798\uC694", callback_data: "triage:min-001:hold" },
          ],
        ],
      },
    });
    expect(message.text).toContain("\uAE00 #min-001");
    expect(message.text).toContain("\uC4F4 \uC0AC\uB78C");
    expect(message.text).toContain("\uD655\uC778: \uB05D\uB0A8");
    expect(message.text).not.toContain("\uC720\uB2DB");
    expect(message.text).not.toContain("\uC804\uBB38\uAC00");
    expect(message.text).not.toContain("\uAC80\uC99D");
    expect(message.text).not.toContain("unit:");
    expect(message.text).not.toContain("expert:");
    expect(message.text).not.toContain("canonical:");
  });

  it("builds internalization buttons with visible labels", () => {
    const message = buildTelegramInternalizationMessage({
      unitId: "min-001",
      expertHandle: "@min_anko38",
      originalText: "\uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uB77C\uB294 \uB73B\uC774\uB2E4.",
    });

    const buttons = message.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(buttons).toHaveLength(5);
    expect(buttons.every((button) => typeof button.text === "string" && button.text.length > 0)).toBe(true);
    expect(buttons.map((button) => button.text)).toContain("\uB2E4 \uBD24\uC5B4\uC694");
  });

  it("builds a Korean button menu for operations", () => {
    expect(buildTelegramOpsMenuMessage()).toEqual({
      text: "\uCCB4\uD654\uD560\uC9C0 \uBA3C\uC800 \uACE8\uB77C\uBCFC\uAC8C\uC694.\n\uC774 \uBD07\uC740 \uAE00\uC744 \uACE0\uB974\uB294 \uCCB4\uD654\uAD6C\uBD84 \uBD07\uC774\uC5D0\uC694.\n\uACF5\uBD80\uB294 \uCCB4\uD654 \uBD07\uC5D0\uC11C \uC774\uC5B4\uC9D1\uB2C8\uB2E4.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "\uAD6C\uBD84\uD560 \uAE00 \uBC1B\uAE30", callback_data: "ops:send_next_triage" }],
          [{ text: "\uBCF4\uB958 \uAE00 \uBCF4\uAE30", callback_data: "ops:pending_cards" }],
          [{ text: "\uAD6C\uBD84\uBD07 \uC0C1\uD0DC", callback_data: "ops:status" }],
          [{ text: "\uB3C4\uC6C0\uB9D0", callback_data: "ops:help" }],
        ],
      },
    });
  });
});
