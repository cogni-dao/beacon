// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/registry`
 * Purpose: Resolve a PlatformConnectorPort by provider key, configured from server env.
 * Scope: The single seam the generic /api/v1/connections/[provider] routes use to drive any
 *   platform. Adding a platform = register one connector here. Returns null when the provider is
 *   unknown OR its credentials are unconfigured (so routes fail-fast with a clear 4xx/5xx).
 * Invariants:
 * - REGISTRY_IS_THE_SWITCH: routes never branch on provider name; they ask the registry.
 * Side-effects: none (pure construction from env).
 * Links: docs/spec/platform-connections.md
 * @internal
 */

import type { PlatformConnectorPort } from "@/ports";
import { serverEnv } from "@/shared/env";
import { XPlatformConnector } from "./x.connector";

/**
 * Resolve a connector for the given provider, or null if unknown/unconfigured.
 * Memoization is unnecessary — connectors are cheap, stateless value objects.
 */
export function getPlatformConnector(
  provider: string
): PlatformConnectorPort | null {
  const env = serverEnv();
  switch (provider) {
    case "x": {
      if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) return null;
      return new XPlatformConnector({
        clientId: env.X_OAUTH_CLIENT_ID,
        clientSecret: env.X_OAUTH_CLIENT_SECRET,
      });
    }
    default:
      return null;
  }
}
