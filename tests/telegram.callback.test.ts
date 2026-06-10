import { describe, expect, it } from "vitest";
import { MemoryPhase1Store } from "../src/db/index.js";
import {
  handleTelegramCallback,
  parseInternalizationCallbackData,
  parseTriageCallbackData,
  type CallbackTelegramClient,
} from "../src/telegram/callbacks.js";

describe("Telegram triage callback handling", () => {
  async function seededStore() {
    const store = new MemoryPhase1Store();
    await store.upsertContextUnit({
      unitId: "min-001",
      expertHandle: "@min_anko38",
      originalText: "\uD604\uAE08\uD750\uB984\uC774 \uBA3C\uC800\uACE0 \uAC00\uACA9\uC740 \uADF8 \uB2E4\uC74C\uC774\uB2E4.",
      completedAt: "2026-01-01T00:00:00.000Z",
      canonicalStatus: "verified",
      rtOnlyExcluded: false,
      structuralBasis: ["original_post"],
    });
    return store;
  }

  it("parses triage callback data", () => {
    expect(parseTriageCallbackData("triage:min-001:internalize")).toEqual({
      unitId: "min-001",
      action: "internalize",
    });
    expect(parseTriageCallbackData("bad:min-001:internalize")).toBeNull();
  });

  it("parses internalization control callback data", () => {
    expect(parseInternalizationCallbackData("internalization:min-001:hint")).toEqual({
      unitId: "min-001",
      action: "hint",
    });
    expect(parseInternalizationCallbackData("internalization:min-001:mastery_check")).toEqual({
      unitId: "min-001",
      action: "mastery_check",
    });
    expect(parseInternalizationCallbackData("internalization:min-001:complete")).toEqual({
      unitId: "min-001",
      action: "complete",
    });
    expect(parseInternalizationCallbackData("triage:min-001:hint")).toBeNull();
    expect(parseInternalizationCallbackData("internalization:min-001:explain_with_ai")).toBeNull();
  });

  it("records skip and answers the callback without sending internalization", async () => {
    const store = await seededStore();
    const calls: string[] = [];
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async (callbackQueryId, text) => {
        calls.push(`answer:${callbackQueryId}:${text}`);
      },
      sendMessage: async () => {
        calls.push("send");
        return { message_id: 1 };
      },
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-1",
      chatId: "1000000001",
      data: "triage:min-001:skip",
    });

    expect(result).toMatchObject({
      handled: true,
      unitId: "min-001",
      action: "skip",
      decision: "\uCCB4\uD654_\uC548\uD574\uB3C4_\uB428",
      internalizationSent: false,
      callbackAnswerOk: true,
    });
    expect((await store.getContextUnit("min-001"))?.triageDecision).toBe(
      "\uCCB4\uD654_\uC548\uD574\uB3C4_\uB428",
    );
    expect(calls).toEqual(["answer:cb-1:\uC800\uC7A5\uB428"]);
  });

  it("records internalize and sends an original-first internalization message", async () => {
    const store = await seededStore();
    const calls: Array<{ kind: string; text?: string; callbacks?: string[] }> = [];
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => {
        calls.push({ kind: "answer" });
      },
      sendMessage: async (_chatId, payload) => {
        calls.push({
          kind: "send",
          text: payload.text,
          callbacks: payload.replyMarkup?.inline_keyboard.flat().map((button) => button.callback_data),
        });
        return { message_id: 2 };
      },
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-2",
      chatId: "1000000001",
      data: "triage:min-001:internalize",
    });

    expect(result).toMatchObject({
      handled: true,
      unitId: "min-001",
      action: "internalize",
      decision: "\uCCB4\uD654",
      internalizationSent: true,
    });
    expect(calls.find((call) => call.kind === "send")?.text).toContain("\uBA3C\uC800 \uC6D0\uBB38 \uBCF4\uAE30");
    expect(calls.find((call) => call.kind === "send")?.text).not.toContain("AI \uD574\uC11D");
    expect(calls.find((call) => call.kind === "send")?.callbacks).toEqual([
      "internalization:min-001:hint",
      "internalization:min-001:retry",
      "internalization:min-001:mastery_check",
      "internalization:min-001:reschedule",
      "internalization:min-001:complete",
    ]);
  });

  it("handles internalization hint locally without paid AI", async () => {
    const store = await seededStore();
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    const sends: string[] = [];
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => undefined,
      sendMessage: async (_chatId, payload) => {
        sends.push(payload.text);
        return { message_id: 5 };
      },
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-hint",
      chatId: "1000000001",
      data: "internalization:min-001:hint",
    });

    expect(result).toMatchObject({
      handled: true,
      unitId: "min-001",
      action: "hint",
      controlMessageSent: true,
      requiresPaidModel: false,
    });
    expect(sends[0]).toContain("\uAC04\uB2E8 \uD78C\uD2B8");
    expect(sends[0]).not.toContain("AI \uD574\uC11D");
    expect(sends[0]).not.toContain("deterministic_local_hint");
  });

  it("handles retry, mastery check, and reschedule controls as local guidance", async () => {
    const store = await seededStore();
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    const sends: string[] = [];
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => undefined,
      sendMessage: async (_chatId, payload) => {
        sends.push(payload.text);
        return { message_id: sends.length };
      },
    };

    for (const action of ["retry", "mastery_check", "reschedule"] as const) {
      const result = await handleTelegramCallback({
        store,
        client,
        callbackQueryId: `cb-${action}`,
        chatId: "1000000001",
        data: `internalization:min-001:${action}`,
      });

      expect(result).toMatchObject({
        handled: true,
        action,
        requiresPaidModel: false,
        controlMessageSent: true,
      });
    }

    expect(sends[0]).toContain("\uB2E4\uC2DC \uD574\uBCF4\uAE30");
    expect(sends[1]).toContain("\uB2E4 \uC774\uD574\uD588\uB294\uC9C0 \uD655\uC778");
    expect(sends[2]).toContain("\uB098\uC911\uC5D0 \uB2E4\uC2DC \uBCF4\uAE30");
  });

  it("marks internalization complete and removes the active learning unit", async () => {
    const store = await seededStore();
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    await store.setInternalizationState("min-001", "in_progress");
    const sends: string[] = [];
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => undefined,
      sendMessage: async (_chatId, payload) => {
        sends.push(payload.text);
        return { message_id: 7 };
      },
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-complete",
      chatId: "1000000001",
      data: "internalization:min-001:complete",
    });

    expect(result).toMatchObject({
      handled: true,
      unitId: "min-001",
      action: "complete",
      internalizationState: "completed",
      requiresPaidModel: false,
    });
    expect((await store.getContextUnit("min-001"))?.internalizationState).toBe("completed");
    expect(await store.findActiveInternalizationUnit()).toBeNull();
    expect(sends[0]).toContain("\uD559\uC2B5 \uC644\uB8CC");
  });

  it("records internalization control state on the unit", async () => {
    const store = await seededStore();
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => undefined,
      sendMessage: async () => ({ message_id: 6 }),
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-mastery",
      chatId: "1000000001",
      data: "internalization:min-001:mastery_check",
    });

    expect(result).toMatchObject({
      handled: true,
      internalizationState: "mastery_check_requested",
    });
    expect((await store.getContextUnit("min-001"))?.internalizationState).toBe(
      "mastery_check_requested",
    );
  });

  it("does not fail processing when callback answer is too old", async () => {
    const store = await seededStore();
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => {
        throw new Error("Bad Request: query is too old");
      },
      sendMessage: async () => ({ message_id: 3 }),
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "expired-cb",
      chatId: "1000000001",
      data: "triage:min-001:skip",
    });

    expect(result).toMatchObject({
      handled: true,
      decision: "\uCCB4\uD654_\uC548\uD574\uB3C4_\uB428",
      callbackAnswerOk: false,
    });
  });

  it("does not send duplicate internalization when decision was already recorded", async () => {
    const store = await seededStore();
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    let sendCount = 0;
    const client: CallbackTelegramClient = {
      answerCallbackQuery: async () => undefined,
      sendMessage: async () => {
        sendCount += 1;
        return { message_id: 4 };
      },
    };

    const result = await handleTelegramCallback({
      store,
      client,
      callbackQueryId: "cb-dup",
      chatId: "1000000001",
      data: "triage:min-001:internalize",
    });

    expect(result).toMatchObject({
      handled: true,
      internalizationSent: false,
      alreadyRecorded: true,
    });
    expect(sendCount).toBe(0);
  });
});
