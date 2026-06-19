// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/moltbook.connector`
 * Purpose: Moltbook implementation of CredentialPlatformConnector — API-key (Bearer) auth.
 * Scope: Validate a tenant-supplied Moltbook agent API key against `GET /agents/me`
 *   and return the stored blob + non-secret display account. Moltbook is API-key, not
 *   OAuth (https://www.moltbook.com/developers): no redirect, no PKCE, no refresh.
 * Invariants:
 * - SINGLE_ROUND_TRIP: one authenticated `GET /agents/me` both validates the key and
 *   fetches identity (the endpoint 401s with "No API key provided" when absent).
 * - TOKENS_NEVER_LOGGED: the API key never appears in logs, errors, or display columns.
 * - DISPLAY_IS_NONSECRET: only name/karma/id reach the display columns.
 * Side-effects: IO (HTTPS GET to the Moltbook API).
 * Links: docs/spec/platform-connections.md, src/ports/platform-connector.port.ts
 * @internal
 */

import { z } from "zod";
import type { CredentialPlatformConnector, PlatformLinkResult } from "@/ports";

/** Official Moltbook API base (live-verified: GET /agents/me requires Bearer auth). */
const DEFAULT_MOLTBOOK_API_BASE_URL = "https://moltbook.com/api/v1";

/**
 * The authenticated agent profile from `GET /agents/me`. `name` is the stable
 * agent handle (the register endpoint enforces it); id/karma are optional so a
 * minor response-shape change degrades the display rather than failing the link.
 */
const MoltbookAgentSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().min(1),
    karma: z.number().int().optional(),
  })
  .passthrough();

/** Unwrap a `{ agent: {...} }` / `{ data: {...} }` envelope, else pass through. */
function unwrapAgent(json: unknown): unknown {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (obj.agent && typeof obj.agent === "object") return obj.agent;
    if (obj.data && typeof obj.data === "object") return obj.data;
  }
  return json;
}

export interface MoltbookConnectorConfig {
  /** Override the API base (default: the official production base). */
  readonly apiBaseUrl?: string;
  /** Request timeout in milliseconds (default: 10000). */
  readonly timeoutMs?: number;
}

export class MoltbookPlatformConnector implements CredentialPlatformConnector {
  readonly provider = "moltbook";
  readonly credentialType = "api_key" as const;
  // Moltbook is a network for AI agents — agent posting is public, no app review.
  readonly gating = {
    postScope: "public",
    requiresExternalReview: false,
  } as const;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: MoltbookConnectorConfig = {}) {
    this.baseUrl = (config.apiBaseUrl ?? DEFAULT_MOLTBOOK_API_BASE_URL).replace(
      /\/$/,
      ""
    );
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  async validateAndStore(secret: string): Promise<PlatformLinkResult> {
    const apiKey = secret.trim();
    if (!apiKey) {
      throw new Error("Moltbook API key is required");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/agents/me`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // 401 = invalid/absent key. Never echo the key — only the coarse status.
      throw new Error(`Moltbook key validation failed (HTTP ${res.status})`);
    }

    const json: unknown = await res.json().catch(() => null);
    const parsed = MoltbookAgentSchema.safeParse(unwrapAgent(json));
    if (!parsed.success) {
      throw new Error("Moltbook profile response was not in the expected shape");
    }
    const agent = parsed.data;

    const externalAccountId =
      agent.id != null ? String(agent.id) : agent.name;
    const displayLabel =
      typeof agent.karma === "number"
        ? `${agent.name} (${agent.karma} karma)`
        : agent.name;

    return {
      blob: { access_token: apiKey, account_id: externalAccountId },
      account: {
        externalAccountId,
        handle: `@${agent.name}`,
        displayLabel,
      },
      scopes: [],
      expiresAt: null,
    };
  }
}
