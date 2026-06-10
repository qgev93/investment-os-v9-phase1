import {
  CHAIRMAN_ATTEMPT_PROMPT,
  INTERNALIZATION_BUTTONS,
  INTERNALIZATION_NEXT_BUTTONS,
  LOCAL_FEEDBACK_PROMPT,
  ORIGINAL_CONTEXT_LABEL,
  TRIAGE_ACTION_BUTTONS,
  TRIAGE_NAV_BUTTONS,
} from "./labels.js";

interface SourceStimulus {
  status: "present" | "absent" | "unavailable";
  sourceText?: string;
  availabilityReason?: string;
}

interface UnitView {
  unitId: string;
  expertHandle: string;
  originalText: string;
  canonicalStatus?: "verified" | "pending" | "quarantined";
  sourceStimulus: SourceStimulus;
  elitePosts: string[];
  mediaItems: Array<{ status: string; mediaType: string }>;
}

function sourceStatusLabel(status: SourceStimulus["status"]): string {
  if (status === "present") return "\uC788\uC74C";
  if (status === "absent") return "\uC5C6\uC74C";
  return "\uC0AC\uC6A9 \uBD88\uAC00";
}

function canonicalStatusLabel(status: UnitView["canonicalStatus"]): string {
  if (status === "pending") return "\uAE30\uB2E4\uB9AC\uB294 \uC911";
  if (status === "quarantined") return "\uBA48\uCDA4";
  return "\uB05D\uB0A8";
}

export function renderTriageCard(unit: UnitView) {
  const mediaLine = unit.mediaItems
    .map((item) => `${item.mediaType}: ${item.status}`)
    .join(", ");

  return {
    channel: "triage" as const,
    text: [
      `\uCE74\uB4DC: ${unit.unitId}`,
      `\uC4F4 \uC0AC\uB78C: ${unit.expertHandle}`,
      `\uD655\uC778: ${canonicalStatusLabel(unit.canonicalStatus)}`,
      `\uC2DC\uC791 \uB2E8\uC11C: ${sourceStatusLabel(unit.sourceStimulus.status)}`,
      `\uC6D0\uBB38: ${unit.originalText}`,
      `\uBBF8\uB514\uC5B4: ${mediaLine || "\uC5C6\uC74C"}`,
    ].join("\n"),
    aiSummary: null,
    aiRecommendation: null,
    buttons: [...TRIAGE_ACTION_BUTTONS, ...TRIAGE_NAV_BUTTONS],
  };
}

export function renderInternalizationStart(unit: UnitView) {
  const source =
    unit.sourceStimulus.status === "present"
      ? unit.sourceStimulus.sourceText
      : sourceStatusLabel(unit.sourceStimulus.status);

  return {
    channel: "internalization" as const,
    originalPresentedFirst: true,
    aiPreExplanationBlocked: true,
    text: [
      ORIGINAL_CONTEXT_LABEL,
      `\uC2DC\uC791 \uB2E8\uC11C: ${source}`,
      `\uC4F4 \uC0AC\uB78C: ${unit.expertHandle}`,
      ...unit.elitePosts.map((post) => `\uC6D0\uBB38: ${post}`),
      `\uBBF8\uB514\uC5B4: ${unit.mediaItems.map((item) => item.status).join(", ") || "\uC5C6\uC74C"}`,
      CHAIRMAN_ATTEMPT_PROMPT,
    ].join("\n"),
    buttons: INTERNALIZATION_BUTTONS,
  };
}

export function submitChairmanAttempt(input: { unitId: string; attemptText: string }) {
  if (!input.attemptText.trim()) {
    throw new Error("\uB0B4 \uB2F5\uBCC0\uC744 \uBA3C\uC800 \uC791\uC131\uD574\uC57C \uD53C\uB4DC\uBC31\uC744 \uBC1B\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  }

  return {
    unitId: input.unitId,
    acceptedAttemptFirst: true,
    requiresPaidModel: false,
    feedbackMode: "deterministic_local_prompt" as const,
    prompt: LOCAL_FEEDBACK_PROMPT,
    nextButtons: INTERNALIZATION_NEXT_BUTTONS,
  };
}
