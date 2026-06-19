// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/campaign-slug`
 * Purpose: Lock the New-campaign slug derivation: same-titled campaigns must get
 *   DISTINCT, pattern-valid ids so they no longer collide on the per-account
 *   `(account_id, campaign_id)` unique index (the 409-on-2nd-create bug).
 * Scope: Pure helpers in `slug.ts`; no React, no IO.
 * Invariants: SLUG_FITS_PATTERN, UNIQUE_PER_DERIVE.
 * Side-effects: none.
 * Links: src/app/(app)/growth/_components/slug.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  deriveCampaignId,
  ID_PATTERN,
  slugify,
} from "@/app/(app)/growth/_components/slug";

describe("campaign slug derivation", () => {
  it("slugifies a free-text title into a lowercase dash slug", () => {
    expect(slugify("Cogni owns its AI")).toBe("cogni-owns-its-ai");
  });

  it("derives an id that satisfies the server's ID_PATTERN", () => {
    expect(ID_PATTERN.test(deriveCampaignId("Cogni owns its AI"))).toBe(true);
  });

  it("appends a random suffix so same-titled campaigns get DISTINCT ids", () => {
    const a = deriveCampaignId("Cogni owns its AI");
    const b = deriveCampaignId("Cogni owns its AI");
    expect(a).not.toBe(b);
    expect(a.startsWith("cogni-owns-its-ai-")).toBe(true);
    expect(b.startsWith("cogni-owns-its-ai-")).toBe(true);
  });

  it("keeps a very long title within the 64-char ID_PATTERN bound", () => {
    const long = "a".repeat(200);
    const id = deriveCampaignId(long);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(ID_PATTERN.test(id)).toBe(true);
  });

  it("still yields a valid id when the title has no slug-safe characters", () => {
    const id = deriveCampaignId("!!! ??? ###");
    expect(ID_PATTERN.test(id)).toBe(true);
    expect(id.length).toBeGreaterThanOrEqual(1);
  });

  it("produces practically-unique ids across many derivations", () => {
    const ids = new Set(
      Array.from({ length: 500 }, () => deriveCampaignId("Same Title"))
    );
    // 4 hex chars ⇒ 65k space; 500 draws should not all collide.
    expect(ids.size).toBeGreaterThan(450);
  });
});
