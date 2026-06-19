// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/slug`
 * Purpose: Pure campaign-id derivation for the New-campaign form. Turns a
 *   free-text title into a slug that is UNIQUE per submit so two campaigns with
 *   the SAME title no longer collide on the per-account `(account_id,
 *   campaign_id)` unique index (the only collision that ever mattered —
 *   cross-account same-name is correctly allowed by RLS).
 * Scope: Pure string helpers; no React, no IO (so they're trivially unit-testable
 *   and the form stays a thin client component).
 * Invariants:
 *   - SLUG_FITS_PATTERN: every derived id matches `^[a-z0-9][a-z0-9-]{0,63}$`
 *     (base truncated to leave room for the `-<suffix>`).
 *   - HIDDEN_FROM_UX: the slug is machine plumbing — derived, never shown or asked.
 * Side-effects: none (reads crypto.getRandomValues only).
 * Links: ./NewCampaignSheet.tsx, ../../../api/v1/growth/campaigns/route.ts (CAMPAIGN_ID_RE)
 * @internal
 */

/** Campaign-id charset — mirrors the server's `CAMPAIGN_ID_RE`. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Length of the random uniqueness suffix appended to a derived slug (hex chars). */
const SLUG_SUFFIX_LEN = 4;
/** Room for the `-<suffix>` we append, leaving the whole slug ≤ 64 chars. */
const SLUG_BASE_MAX = 64 - (SLUG_SUFFIX_LEN + 1);

/** Slugify a free-text title into a campaign-id base (hidden from the user). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX);
}

/** Short lowercase-hex token that makes same-titled slugs collision-proof. */
function randomSuffix(): string {
  const bytes = new Uint8Array(SLUG_SUFFIX_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 16).toString(16)).join("");
}

/**
 * Derive a UNIQUE campaign-id from the title: slugified base + a random suffix.
 * Two campaigns with the SAME title no longer collide on the per-account
 * `(account_id, campaign_id)` unique index. Always satisfies `ID_PATTERN`.
 */
export function deriveCampaignId(title: string): string {
  const base = slugify(title);
  const suffix = randomSuffix();
  return base ? `${base}-${suffix}` : suffix;
}
