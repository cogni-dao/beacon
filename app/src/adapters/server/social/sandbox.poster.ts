// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/social/sandbox.poster`
 * Purpose: Fake data-plane poster for the "sandbox" platform — records a post from a
 *   broker-resolved per-tenant token with NO external call. Exercises the posting
 *   pipeline (resolve → post) without really posting anywhere.
 * Invariants:
 *   - NO_NETWORK: never makes an HTTP request.
 *   - DETERMINISTIC: externalId = hash(token, text) so retries dedupe identically.
 *   - NO_SECRETS_IN_LOGS: the resolved token is never logged.
 * Side-effects: emits one structured Pino line per post (observability of the exercise).
 * Links: docs/spec/platform-connections.md, src/ports/sandbox-poster.port.ts
 * @internal
 */

import { createHash } from "node:crypto";
import type { SandboxPosterPort, SandboxPostResult } from "@/ports";
import { makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "SandboxPoster" });

export class SandboxPoster implements SandboxPosterPort {
  /** The broker-resolved per-tenant token (fake, but resolved through the real path). */
  private readonly resolvedToken: string;

  constructor(resolvedToken: string) {
    this.resolvedToken = resolvedToken;
  }

  async post(text: string): Promise<SandboxPostResult> {
    const externalId = `sandbox-${createHash("sha256")
      .update(`${this.resolvedToken}:${text}`)
      .digest("hex")
      .slice(0, 12)}`;
    const result: SandboxPostResult = {
      externalId,
      postedAt: new Date().toISOString(),
      text,
    };
    // Token never logged — only the recorded (non-secret) outcome.
    logger.info(
      { event: "sandbox_post_recorded", externalId, textLength: text.length },
      "sandbox post recorded (no external send)"
    );
    return result;
  }
}
