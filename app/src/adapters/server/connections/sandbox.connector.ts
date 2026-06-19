// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/sandbox.connector`
 * Purpose: Fake platform connector for exercising the connect→persist→resolve→post
 *   pipeline with NO external calls. Lets a tenant "link" a sandbox account and
 *   send test posts through the real code paths (broker resolution included),
 *   without claiming agents, OAuth, paid tiers, or real social posting.
 * Scope: Control-plane CredentialPlatformConnector. The data-plane fake poster is
 *   SandboxPoster (sandbox.poster.ts).
 * Invariants:
 * - NO_NETWORK: validateAndStore never makes an HTTP request — it is deterministic.
 * - DETERMINISTIC_IDENTITY: the submitted label maps 1:1 to a stable fake account so
 *   multiple sandbox handles can be linked per tenant (multi-account exercise).
 * Side-effects: none.
 * Links: docs/spec/platform-connections.md
 * @internal
 */

import type {
  CredentialPlatformConnector,
  PlatformLinkResult,
} from "@/ports";

/** Sanitize a submitted label into a stable, display-safe handle fragment. */
function toHandle(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  return cleaned.length > 0 ? cleaned : "sandbox";
}

export class SandboxPlatformConnector implements CredentialPlatformConnector {
  readonly provider = "sandbox";
  readonly credentialType = "api_key" as const;
  // Fully fake: posting is "available" but never leaves the node.
  readonly gating = {
    postScope: "public",
    requiresExternalReview: false,
  } as const;

  async validateAndStore(secret: string): Promise<PlatformLinkResult> {
    // The submitted string is both the label and the stored "token" — no network.
    // Storing a real blob exercises the genuine encrypt + broker-resolve path.
    const handle = toHandle(secret);
    const externalAccountId = `sandbox-${handle}`;
    return {
      blob: {
        access_token: secret.trim() || "sandbox-token",
        account_id: externalAccountId,
      },
      account: {
        externalAccountId,
        handle: `@${handle}`,
        displayLabel: `Sandbox (${handle})`,
      },
      scopes: [],
      expiresAt: null,
    };
  }
}
