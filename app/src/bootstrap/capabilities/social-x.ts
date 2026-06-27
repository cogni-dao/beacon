// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/social-x`
 * Purpose: Factory for SocialXCapability — bridges the ai-tools capability
 *   interface to the X adapter (real) + X/Moltbook fakes, routed per channel.
 * Scope: Creates SocialXCapability from server environment. Does not implement transport.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: social bearer tokens resolved from env, never passed to tools
 *   - FAKE_IN_CI: APP_ENV=test → deterministic fakes (X + Moltbook)
 *   - ENV_GATED_REAL: real X adapter only constructed when its bearer key is set
 *   - MOLTBOOK_TENANT_ONLY: real Moltbook publishing uses broker-resolved
 *     connection credentials in the publish job, never an app-level env key
 *   - CHANNEL_ROUTED: postContent/readMetrics dispatch by channel
 * Side-effects: none (factory only)
 * Links: docs/spec/beacon-growth-loop-v0.md §2/§5.
 * @internal
 */

import type {
  PostContentInput,
  PostContentResult,
  PostMetricSnapshot,
  SocialXCapability,
} from "@cogni/ai-tools";

import { XSocialAdapter } from "@/adapters/server";
import { FakeMoltbookAdapter, FakeXSocialAdapter } from "@/adapters/test";
import type { ServerEnv } from "@/shared/env";

/**
 * Stub SocialXCapability that throws when the channel has no configured backend.
 * Used when a channel's real backend is not configured.
 */
function makeStub(reason: string): SocialXCapability {
  return {
    postContent: async () => {
      throw new Error(reason);
    },
    readMetrics: async () => {
      throw new Error(reason);
    },
  };
}

/**
 * Route a SocialXCapability call to the right per-channel backend.
 * `readMetrics` ids are channel-native; v0 assumes a single channel per ingest
 * batch (the ingest job groups broadcasts by channel before reading).
 */
function routeByChannel(
  backends: Readonly<Record<string, SocialXCapability>>
): SocialXCapability {
  const pick = (channel: string): SocialXCapability => {
    const backend = backends[channel];
    if (!backend) {
      throw new Error(`SocialXCapability has no backend for channel "${channel}"`);
    }
    return backend;
  };
  return {
    postContent: (input: PostContentInput): Promise<PostContentResult> =>
      pick(input.channel).postContent(input),
    readMetrics: (ids: readonly string[]): Promise<PostMetricSnapshot[]> => {
      // External ids are channel-prefixed by every adapter ("x-...", "moltbook-...").
      // Group by inferred channel so a mixed batch still routes correctly.
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const channel = id.startsWith("moltbook") ? "moltbook" : "x";
        const bucket = groups.get(channel) ?? [];
        bucket.push(id);
        groups.set(channel, bucket);
      }
      return Promise.all(
        [...groups.entries()].map(([channel, group]) =>
          pick(channel).readMetrics(group)
        )
      ).then((results) => results.flat());
    },
  };
}

/**
 * Create SocialXCapability from server environment.
 *
 * - APP_ENV=test: fakes for both X and Moltbook (deterministic, monotonic-rising)
 * - X_API_BEARER_TOKEN present: real X adapter for `x`
 * - Moltbook production container path: stub; publish job constructs the real
 *   adapter from tenant-linked credentials
 * - Not configured: stubs that throw on use
 *
 * @param env - Server environment with X configuration
 * @returns SocialXCapability routed per channel
 */
export function createSocialXCapability(env: ServerEnv): SocialXCapability {
  // Test mode: deterministic fakes for both channels.
  if (env.isTestMode) {
    const fakeX = new FakeXSocialAdapter();
    const fakeMoltbook = new FakeMoltbookAdapter();
    return routeByChannel({ x: fakeX, moltbook: fakeMoltbook });
  }

  const bearerToken = env.X_API_BEARER_TOKEN;
  // X: real adapter when configured, else a stub that throws on use.
  // NOTE: the container path still sources the app-level token here (posting +
  // metrics-ingest). The per-tenant read path (profile insights) builds its own
  // XSocialAdapter from a broker-resolved user token — see
  // app/src/app/api/v1/connections/[provider]/metrics/route.ts. Re-sourcing this
  // container path off the bearer is the deferred SA4 ripple.
  const xBackend: SocialXCapability = bearerToken
    ? new XSocialAdapter({ accessToken: bearerToken, timeoutMs: 10000 })
    : makeStub(
        "SocialXCapability (x) not configured. Set X_API_BEARER_TOKEN environment variable."
      );

  const moltbookBackend: SocialXCapability = makeStub(
    "SocialXCapability (moltbook) uses tenant-linked connections; call the publish-approved campaign route/job."
  );

  return routeByChannel({ x: xBackend, moltbook: moltbookBackend });
}
