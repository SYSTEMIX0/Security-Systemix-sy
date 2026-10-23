import { describe, expect, it } from "vitest";
import { canReviewSuggestion, normalizeSuggestionContent, publicAuthorLabel, SUGGESTION_CONTENT_MAX } from "./suggestions";

describe("suggestion pure helpers", () => {
  it("normalizes line endings and trims content while enforcing a safe maximum", () => {
    expect(normalizeSuggestionContent("  hello\r\nworld  ")).toBe("hello\nworld");
    expect(SUGGESTION_CONTENT_MAX).toBe(1800);
  });

  it("never reveals the stored author ID in the public anonymous label", () => {
    expect(publicAuthorLabel(true, "12345678901234567")).toBe("مجهول");
    expect(publicAuthorLabel(false, "12345678901234567")).toBe("<@12345678901234567>");
  });

  it("permits review only when a configured reviewer role is held", () => {
    expect(canReviewSuggestion(["member", "reviewer"], ["reviewer"])).toBe(true);
    expect(canReviewSuggestion(["member"], ["reviewer"])).toBe(false);
    expect(canReviewSuggestion(["reviewer"], [])).toBe(false);
  });
});
