// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/ai-tools/social-x`
 * Purpose: Unit-test Moltbook payload derivation at the package boundary used by the app.
 * Scope: Pure text-to-payload helpers only; no transport or app UI.
 * Invariants:
 *   - MOLTBOOK_TITLE_BODY_SPLIT: generated payloads expose a title and body
 *   - MOLTBOOK_DESTINATION_SEED: the default destination is selectable from seed options
 * Side-effects: none
 * Links: packages/ai-tools/src/capabilities/social-x.ts
 * @internal
 */

import {
  DEFAULT_MOLTBOOK_SUBMOLT,
  deriveMoltbookPayloadFromDraft,
  deriveMoltbookPayloadFromText,
  MOLTBOOK_SUBMOLT_OPTIONS,
} from "@cogni/ai-tools";
import { describe, expect, it } from "vitest";

describe("deriveMoltbookPayloadFromText", () => {
  it("uses draft metadata for the title instead of copying the opening sentence", () => {
    const text =
      "Beacon should turn social publishing into a compounding review loop that compounds every week.";

    const payload = deriveMoltbookPayloadFromDraft({
      text,
      title: "Compounding Review Loops",
      angle: "Beacon should turn social publishing into a compounding review loop.",
      topic: "review loops",
    });

    expect(payload.submoltName).toBe(DEFAULT_MOLTBOOK_SUBMOLT);
    expect(payload.title).toBe("Compounding Review Loops");
    expect(payload.content).toBe(text);
    expect(payload.title).not.toBe("Beacon should turn social publishing into a compounding review loop.");
  });

  it("rejects copied title candidates and falls back to angle/topic metadata", () => {
    const text =
      "Beacon owns the loop.\nApproved posts should publish with a clean title/body split.";

    const payload = deriveMoltbookPayloadFromDraft({
      text,
      submoltName: "ai",
      title: "Beacon owns the loop.",
      angle: "Title-body separation",
      topic: "publishing",
    });

    expect(payload).toEqual({
      submoltName: "ai",
      title: "Title-body separation",
      content: text,
      type: "text",
    });
  });

  it("rejects titles copied from the opening words of the post", () => {
    const text =
      "Beacon should turn social publishing into a compounding review loop. The rest of the post explains why.";

    const payload = deriveMoltbookPayloadFromDraft({
      text,
      title: "Beacon should turn social publishing",
      angle: "Compounding Review Loops",
      topic: "review loops",
    });

    expect(payload.title).toBe("Compounding Review Loops");
    expect(payload.content).toBe(text);
  });

  it("does not derive text-only titles from the opening sentence", () => {
    const text =
      "Beacon should turn social publishing into a compounding review loop. The body explains why.";

    const payload = deriveMoltbookPayloadFromText(text);

    expect(payload.title).toBe("Moltbook update");
    expect(payload.title).not.toBe(
      "Beacon should turn social publishing into a compounding review loop."
    );
    expect(payload.content).toBe(text);
  });

  it("includes the default submolt in the initial destination options", () => {
    expect(MOLTBOOK_SUBMOLT_OPTIONS).toContain(DEFAULT_MOLTBOOK_SUBMOLT);
  });
});
