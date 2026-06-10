import type { Phase1Store } from "../db/index.js";
import { LOCAL_FEEDBACK_PROMPT } from "./labels.js";
import type { TelegramMessagePayload } from "./client.js";

export interface AttemptTelegramClient {
  sendMessage(chatId: string, payload: TelegramMessagePayload): Promise<{ message_id: number }>;
}

export function buildLocalAttemptFeedback(input: { unitId: string; attemptText: string }) {
  return {
    unitId: input.unitId,
    requiresPaidModel: false,
    feedbackMode: "deterministic_local_prompt" as const,
    text: [
      "\uAC04\uB2E8 \uD53C\uB4DC\uBC31",
      LOCAL_FEEDBACK_PROMPT,
      "",
      `\uB0B4 \uB2F5\uBCC0: ${input.attemptText}`,
    ].join("\n"),
  };
}

export async function handleTelegramTextAttempt(input: {
  store: Phase1Store;
  client: AttemptTelegramClient;
  chatId: string;
  text: string;
}) {
  const cleanText = input.text.trim();
  if (!cleanText) {
    return { handled: false, reason: "empty_text" as const };
  }

  const unit = await input.store.findActiveInternalizationUnit();
  if (!unit) {
    return { handled: false, reason: "no_active_internalization" as const };
  }

  await input.store.addChairmanAttempt({
    unitId: unit.unitId,
    attemptText: cleanText,
    attemptedAt: new Date().toISOString(),
  });
  const attemptCount = (await input.store.listChairmanAttempts(unit.unitId)).length;
  const feedback = buildLocalAttemptFeedback({
    unitId: unit.unitId,
    attemptText: cleanText,
  });
  await input.client.sendMessage(input.chatId, { text: feedback.text });

  return {
    handled: true,
    unitId: unit.unitId,
    attemptCount,
    feedbackSent: true,
  };
}
