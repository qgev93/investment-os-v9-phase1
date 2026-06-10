import { describe, expect, it } from "vitest";
import {
  INTERNALIZATION_NEXT_BUTTONS,
  ORIGINAL_CONTEXT_LABEL,
  TRIAGE_ACTION_BUTTONS,
  TRIAGE_NAV_BUTTONS,
} from "../src/telegram/labels.js";
import {
  renderInternalizationStart,
  renderTriageCard,
  submitChairmanAttempt,
} from "../src/telegram/simulator.js";

describe("Telegram channel simulator", () => {
  const unit = {
    unitId: "min-001",
    expertHandle: "@min_anko38",
    originalText: "\uD604\uAE08\uD750\uB984\uC774 \uBA3C\uC800\uACE0 \uAC00\uACA9\uC740 \uADF8 \uB2E4\uC74C\uC774\uB2E4.",
    sourceStimulus: { status: "absent" as const },
    elitePosts: [
      "\uD604\uAE08\uD750\uB984\uC774 \uBA3C\uC800\uACE0 \uAC00\uACA9\uC740 \uADF8 \uB2E4\uC74C\uC774\uB2E4.",
    ],
    mediaItems: [{ status: "MEDIA_PENDING", mediaType: "chart" }],
  };

  it("renders zero-AI triage cards with buttons only", () => {
    const card = renderTriageCard(unit);

    expect(card.channel).toBe("triage");
    expect(card.text).toContain("@min_anko38");
    expect(card.text).toContain("\uD655\uC778: \uB05D\uB0A8");
    expect(card.text).not.toContain("\uAC80\uC99D");
    expect(card.text).not.toContain("canonical:");
    expect(card.text).not.toContain("source:");
    expect(card.aiSummary).toBeNull();
    expect(card.aiRecommendation).toBeNull();
    expect(card.buttons).toEqual([...TRIAGE_ACTION_BUTTONS, ...TRIAGE_NAV_BUTTONS]);
  });

  it("starts internalization with original context before AI explanation", () => {
    const start = renderInternalizationStart(unit);

    expect(start.channel).toBe("internalization");
    expect(start.originalPresentedFirst).toBe(true);
    expect(start.aiPreExplanationBlocked).toBe(true);
    expect(start.text.indexOf(ORIGINAL_CONTEXT_LABEL)).toBeLessThan(start.text.indexOf("\uB0B4 \uB2F5\uBCC0"));
    expect(start.text).not.toContain("AI \uD574\uC11D");
    expect(start.text).not.toContain("\uC18C\uC2A4 \uC790\uADF9");
    expect(start.text).not.toContain("\uC804\uBB38\uAC00");
    expect(start.text).not.toContain("source stimulus:");
    expect(start.text).not.toContain("elite post:");
  });

  it("accepts chairman attempt before deterministic feedback", () => {
    const feedback = submitChairmanAttempt({
      unitId: "min-001",
      attemptText:
        "\uAC00\uACA9\uBCF4\uB2E4 \uD604\uAE08\uD750\uB984\uC744 \uBA3C\uC800 \uBCF4\uB77C\uB294 \uC0AC\uACE0\uBC29\uC2DD\uC774\uB2E4.",
    });

    expect(feedback.acceptedAttemptFirst).toBe(true);
    expect(feedback.requiresPaidModel).toBe(false);
    expect(feedback.nextButtons).toEqual(INTERNALIZATION_NEXT_BUTTONS);
  });
});
