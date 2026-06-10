import { describe, expect, it } from "vitest";
import { MemoryPhase1Store } from "../src/db/index.js";
import {
  handleTelegramTextAttempt,
  buildLocalAttemptFeedback,
  type AttemptTelegramClient,
} from "../src/telegram/internalization.js";

describe("Chairman-first internalization attempts", () => {
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
    await store.setTriageDecision("min-001", "\uCCB4\uD654");
    return store;
  }

  it("builds deterministic no-paid feedback for an attempt", () => {
    expect(
      buildLocalAttemptFeedback({
        unitId: "min-001",
        attemptText: "\uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uB77C\uB294 \uB73B\uC774\uB2E4.",
      }),
    ).toMatchObject({
      requiresPaidModel: false,
      feedbackMode: "deterministic_local_prompt",
    });
  });

  it("records a Chairman attempt and sends local feedback", async () => {
    const store = await seededStore();
    const sent: string[] = [];
    const client: AttemptTelegramClient = {
      sendMessage: async (_chatId, payload) => {
        sent.push(payload.text);
        return { message_id: 99 };
      },
    };

    const result = await handleTelegramTextAttempt({
      store,
      client,
      chatId: "1000000001",
      text: "\uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uB77C\uB294 \uB73B\uC774\uB2E4.",
    });

    expect(result).toEqual({
      handled: true,
      unitId: "min-001",
      attemptCount: 1,
      feedbackSent: true,
    });
    expect(await store.listChairmanAttempts("min-001")).toHaveLength(1);
    expect(sent[0]).toContain("\uAC04\uB2E8 \uD53C\uB4DC\uBC31");
    expect(sent[0]).not.toContain("AI \uD574\uC11D");
    expect(sent[0]).not.toContain("deterministic_local_prompt");
  });

  it("ignores text when there is no active internalization unit", async () => {
    const store = new MemoryPhase1Store();
    const client: AttemptTelegramClient = {
      sendMessage: async () => ({ message_id: 1 }),
    };

    await expect(
      handleTelegramTextAttempt({
        store,
        client,
        chatId: "1000000001",
        text: "hello",
      }),
    ).resolves.toEqual({ handled: false, reason: "no_active_internalization" });
  });
});
