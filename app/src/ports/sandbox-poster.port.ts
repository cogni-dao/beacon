// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/sandbox-poster.port`
 * Purpose: Data-plane port for the fake "sandbox" platform — records a post from a
 *   broker-resolved per-tenant token without any external call. Lets the posting
 *   pipeline be exercised end-to-end (connect → resolve → post) with no real send.
 * Invariants:
 * - NO_NETWORK: implementations never make an HTTP request.
 * - DETERMINISTIC: the same (token, text) yields the same externalId (idempotency demo).
 * Side-effects: none (the reference impl logs via Pino only).
 * Links: docs/spec/platform-connections.md
 * @public
 */

/** Result of a fake sandbox "post". */
export interface SandboxPostResult {
  readonly externalId: string;
  readonly postedAt: string;
  readonly text: string;
}

/** Records a post from a resolved sandbox token. Bound to one tenant's token. */
export interface SandboxPosterPort {
  post(text: string): Promise<SandboxPostResult>;
}
