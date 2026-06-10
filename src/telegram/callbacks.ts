import type { ContextUnitRecord, Phase1Store } from "../db/index.js";
import type { TriageDecision } from "../domain/index.js";
import { buildTelegramInternalizationMessage, type TelegramMessagePayload } from "./client.js";

export type TriageCallbackAction = "internalize" | "skip" | "hold";
export type InternalizationCallbackAction = "hint" | "retry" | "mastery_check" | "reschedule" | "complete";

export interface ParsedTriageCallback {
  unitId: string;
  action: TriageCallbackAction;
}

export interface ParsedInternalizationCallback {
  unitId: string;
  action: InternalizationCallbackAction;
}

export interface CallbackTelegramClient {
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
  sendMessage(chatId: string, payload: TelegramMessagePayload): Promise<{ message_id: number }>;
}

const DECISION_BY_ACTION: Record<TriageCallbackAction, TriageDecision> = {
  internalize: "\uCCB4\uD654",
  skip: "\uCCB4\uD654_\uC548\uD574\uB3C4_\uB428",
  hold: "\uBCF4\uB958",
};

const INTERNALIZATION_STATE_BY_ACTION: Record<
  InternalizationCallbackAction,
  NonNullable<ContextUnitRecord["internalizationState"]>
> = {
  hint: "hint_requested",
  retry: "retry_requested",
  mastery_check: "mastery_check_requested",
  reschedule: "rescheduled",
  complete: "completed",
};

export function parseTriageCallbackData(data: string): ParsedTriageCallback | null {
  const [scope, unitId, action] = data.split(":");
  if (scope !== "triage" || !unitId) return null;
  if (action !== "internalize" && action !== "skip" && action !== "hold") return null;
  return { unitId, action };
}

export function parseInternalizationCallbackData(data: string): ParsedInternalizationCallback | null {
  const [scope, unitId, action] = data.split(":");
  if (scope !== "internalization" || !unitId) return null;
  if (
    action !== "hint" &&
    action !== "retry" &&
    action !== "mastery_check" &&
    action !== "reschedule" &&
    action !== "complete"
  ) {
    return null;
  }
  return { unitId, action };
}

async function answerCallbackSafely(
  client: CallbackTelegramClient,
  callbackQueryId: string,
  text: string,
): Promise<boolean> {
  try {
    await client.answerCallbackQuery(callbackQueryId, text);
    return true;
  } catch {
    return false;
  }
}

function buildInternalizationControlText(input: {
  action: InternalizationCallbackAction;
  originalText: string;
}): string {
  if (input.action === "hint") {
    return [
      "\uAC04\uB2E8 \uD78C\uD2B8",
      "\uC6D0\uBB38\uC5D0\uC11C \uC911\uC694\uD55C \uB9D0\uC744 \uBA3C\uC800 \uCC3E\uACE0, \uB0B4 \uB2F5\uBCC0\uC5D0 \uADF8 \uB9D0\uC774 \uB4E4\uC5B4\uAC14\uB294\uC9C0 \uBCF4\uC138\uC694.",
      `\uC6D0\uBB38: ${input.originalText}`,
    ].join("\n");
  }

  if (input.action === "retry") {
    return [
      "\uB2E4\uC2DC \uD574\uBCF4\uAE30",
      "\uC6D0\uBB38\uC744 \uB2E4\uC2DC \uBCF4\uACE0 \uB0B4 \uB2F5\uBCC0\uC744 \uC0C8\uB85C \uC368\uBCF4\uC138\uC694. \uC65C \uADF8\uB807\uAC8C \uC0DD\uAC01\uD588\uB294\uC9C0\uB97C \uBA3C\uC800 \uC801\uC73C\uBA74 \uB3FC\uC694.",
      `\uC6D0\uBB38: ${input.originalText}`,
    ].join("\n");
  }

  if (input.action === "mastery_check") {
    return [
      "\uB2E4 \uC774\uD574\uD588\uB294\uC9C0 \uD655\uC778",
      "1. \uC6D0\uBB38\uC744 \uB0B4 \uB9D0\uB85C \uC124\uBA85\uD560 \uC218 \uC788\uB098\uC694?",
      "2. \uC65C \uADF8\uB807\uAC8C \uC0DD\uAC01\uD588\uB294\uC9C0 \uC21C\uC11C\uB300\uB85C \uB9D0\uD560 \uC218 \uC788\uB098\uC694?",
      "3. \uC5B4\uB5A4 \uB54C\uC5D0 \uD2C0\uB9B4 \uC218 \uC788\uB294\uC9C0 \uC801\uC5C8\uB098\uC694?",
      "4. \uB2E4\uB978 \uC885\uBAA9\uC5D0 \uC4F8 \uB54C \uC870\uC2EC\uD560 \uC810\uC744 \uCC3E\uC558\uB098\uC694?",
    ].join("\n");
  }

  if (input.action === "complete") {
    return [
      "\uD559\uC2B5 \uC644\uB8CC",
      "\uC774 \uCE74\uB4DC\uB294 \uC644\uB8CC\uB85C \uD45C\uC2DC\uD588\uC2B5\uB2C8\uB2E4. \uD544\uC694\uD558\uBA74 \uB098\uC911\uC5D0 \uB2E4\uC2DC \uBD10\uB3C4 \uB429\uB2C8\uB2E4.",
    ].join("\n");
  }

  return [
    "\uB098\uC911\uC5D0 \uB2E4\uC2DC \uBCF4\uAE30",
    "\uC774 \uCE74\uB4DC\uB97C \uB2E4\uC74C\uC5D0 \uB2E4\uC2DC \uBCFC \uBAA9\uB85D\uC5D0 \uB0A8\uACA8\uB458\uAC8C\uC694. \uC9C0\uAE08\uC740 \uB3C8 \uB4DC\uB294 \uC608\uC57D \uAE30\uB2A5\uC740 \uC4F0\uC9C0 \uC54A\uC544\uC694.",
  ].join("\n");
}

export async function handleTelegramCallback(input: {
  store: Phase1Store;
  client: CallbackTelegramClient;
  callbackQueryId: string;
  chatId: string;
  data: string;
  internalizationChatId?: string;
  internalizationClient?: CallbackTelegramClient;
}) {
  const parsed = parseTriageCallbackData(input.data);
  if (!parsed) {
    const internalizationParsed = parseInternalizationCallbackData(input.data);
    if (!internalizationParsed) {
      await input.client.answerCallbackQuery(input.callbackQueryId, "\uCC98\uB9AC\uD558\uC9C0 \uC54A\uC74C");
      return { handled: false };
    }

    const unit = await input.store.getContextUnit(internalizationParsed.unitId);
    if (!unit) {
      const callbackAnswerOk = await answerCallbackSafely(
        input.client,
        input.callbackQueryId,
        "\uC720\uB2DB\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC74C",
      );
      return { handled: false, unitId: internalizationParsed.unitId, callbackAnswerOk };
    }

    const internalizationState = INTERNALIZATION_STATE_BY_ACTION[internalizationParsed.action];
    await input.store.setInternalizationState(internalizationParsed.unitId, internalizationState);
    await input.client.sendMessage(input.internalizationChatId ?? input.chatId, {
      text: buildInternalizationControlText({
        action: internalizationParsed.action,
        originalText: unit.originalText,
      }),
    });

    const callbackAnswerOk = await answerCallbackSafely(
      input.client,
      input.callbackQueryId,
      "\uC800\uC7A5\uB428",
    );

    return {
      handled: true,
      unitId: internalizationParsed.unitId,
      action: internalizationParsed.action,
      internalizationState,
      controlMessageSent: true,
      requiresPaidModel: false,
      callbackAnswerOk,
    };
  }

  const unit = await input.store.getContextUnit(parsed.unitId);
  if (!unit) {
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uC720\uB2DB\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC74C");
    return { handled: false, unitId: parsed.unitId };
  }

  const decision = DECISION_BY_ACTION[parsed.action];
  const alreadyRecorded = unit.triageDecision === decision;
  await input.store.setTriageDecision(parsed.unitId, decision);
  if (parsed.action === "internalize") {
    await input.store.setInternalizationState(parsed.unitId, "in_progress");
  }

  let internalizationSent = false;
  if (parsed.action === "internalize" && !alreadyRecorded) {
    await (input.internalizationClient ?? input.client).sendMessage(input.internalizationChatId ?? input.chatId, buildTelegramInternalizationMessage({
      unitId: unit.unitId,
      expertHandle: unit.expertHandle,
      originalText: unit.originalText,
    }));
    internalizationSent = true;
  }

  const callbackAnswerOk = await answerCallbackSafely(
    input.client,
    input.callbackQueryId,
    "\uC800\uC7A5\uB428",
  );

  return {
    handled: true,
    unitId: parsed.unitId,
    action: parsed.action,
    decision,
    internalizationSent,
    alreadyRecorded,
    callbackAnswerOk,
  };
}
