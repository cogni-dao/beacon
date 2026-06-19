// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/metrics`
 * Purpose: Read-only live metrics for the authenticated tenant's linked platform
 *   account, resolved per-tenant through the connection broker (the account's own
 *   user-context token — NO app-level bearer).
 * Scope: GET. Resolves the caller's active connection via ConnectionBrokerPort,
 *   then reads profile + recent-post public_metrics via the platform adapter.
 *   X only in v0 (the only provider with a data plane).
 * Invariants:
 *   - TENANT_SCOPED: resolves only the caller's own active connection (RLS scope).
 *   - TOKENS_NEVER_LOGGED: the resolved token is used, never logged or returned.
 *   - READ_ONLY: never posts or mutates; reads live metrics only.
 *   - BROKER_RESOLVES_ALL: credentials come from the broker, never direct decrypt.
 * Side-effects: IO (DB read via broker, HTTPS read to the platform API).
 * Links: docs/spec/platform-connections.md, src/ports/connection-broker.port.ts
 * @public
 */

import type { UserId } from "@cogni/ids";
import { NextResponse } from "next/server";
import { getContainer } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = makeLogger({ component: "ConnectionsMetricsRoute" });

/** Recent posts to surface on the profile insights card. */
const RECENT_POST_LIMIT = 10;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ linked: false }, { status: 401 });
  }

  // X is the only provider with a per-tenant read data plane in v0.
  if (provider !== "x") {
    return NextResponse.json(
      { linked: false, reason: "unsupported_provider" },
      { status: 400 }
    );
  }

  const container = getContainer();
  const broker = container.connectionBroker;
  if (!broker) {
    return NextResponse.json(
      { linked: false, reason: "broker_unavailable" },
      { status: 503 }
    );
  }

  try {
    const accountService = container.accountsForUser(session.id as UserId);
    const billingAccount = await getOrCreateBillingAccountForUser(
      accountService,
      { userId: session.id }
    );

    const resolved = await broker.resolveActive(billingAccount.id, provider, {
      actorId: session.id,
      tenantId: billingAccount.id,
    });
    if (!resolved) {
      return NextResponse.json({ linked: false });
    }

    // Adapter construction stays in the composition root (app routes must not
    // import adapters/server); we receive a package-typed XInsightsCapability.
    const insights = container.xInsightsForToken(
      resolved.credentials.accessToken
    );
    const metrics = await insights.readAccountMetrics({
      limit: RECENT_POST_LIMIT,
    });

    return NextResponse.json({ linked: true, metrics });
  } catch (error) {
    logger.error(
      {
        provider,
        reasonCode: "metrics_read_failed",
        err: error instanceof Error ? error.message : "unknown",
      },
      "connection metrics read failed"
    );
    return NextResponse.json(
      { linked: true, error: "metrics_read_failed" },
      { status: 502 }
    );
  }
}
