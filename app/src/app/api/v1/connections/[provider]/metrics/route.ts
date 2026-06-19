// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/metrics`
 * Purpose: Read-only metrics for the authenticated tenant's linked platform
 *   account. This route is the read-cost boundary: a plain GET serves the last
 *   cached snapshot with ZERO platform calls; only `?refresh=1` (a user action or
 *   a scheduled job) spends a paid read. Because the boundary lives here — not in
 *   the UI — every caller (card, cron, agent) is protected, not just one card.
 * Scope: GET. Reads the cached snapshot via ConnectionBrokerPort.getReadState;
 *   on explicit refresh, resolves the active connection and reads live metrics
 *   through the platform adapter, then persists the snapshot. X only in v0.
 * Invariants:
 *   - NO_CALL_ON_PASSIVE_READ: a GET without `?refresh=1` never hits the platform.
 *   - CIRCUIT_BREAK: a 402/403/429 marks the connection needs_billing/rate_limited
 *     and stops calling until re-armed; the last snapshot is still served.
 *   - TENANT_SCOPED / TOKENS_NEVER_LOGGED / BROKER_RESOLVES_ALL (unchanged).
 *   - ADAPTER_STAYS_DUMB: the adapter is a stateless fetcher; caching lives here.
 * Side-effects: IO (DB read/write via broker; HTTPS read to the platform only on refresh).
 * Links: docs/spec/platform-connections.md §Read-cost governance, src/ports/connection-broker.port.ts
 * @public
 */

import type { ConnectionReadStatus } from "@/ports";
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

/** Circuit-breaker states: while in one of these, we never call the platform. */
const COOLDOWN_STATUSES = new Set(["needs_billing", "rate_limited"]);

/**
 * Map a platform read error to a circuit-breaker status, coarsely (no token or
 * body detail). 402/403 → no credits / forbidden; 429 → rate-limited. Anything
 * else is treated as transient (no status change).
 */
function classifyReadError(error: unknown): ConnectionReadStatus | null {
  let code: number | undefined;
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; status?: unknown };
    if (typeof e.code === "number") code = e.code;
    else if (typeof e.status === "number") code = e.status;
  }
  if (code === 402 || code === 403) return "needs_billing";
  if (code === 429) return "rate_limited";
  return null;
}

export async function GET(
  req: Request,
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

  const accountService = container.accountsForUser(session.id as UserId);
  const billingAccount = await getOrCreateBillingAccountForUser(accountService, {
    userId: session.id,
  });
  const scope = { actorId: session.id, tenantId: billingAccount.id };

  // Zero-cost read-state lookup (no decrypt, no platform call).
  const readState = await broker.getReadState(billingAccount.id, provider, scope);
  if (!readState) {
    return NextResponse.json({ linked: false });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const cooldown = COOLDOWN_STATUSES.has(readState.status);

  // Passive view, or a circuit-broken connection: serve the snapshot, never call.
  if (!refresh || cooldown) {
    return NextResponse.json({
      linked: true,
      status: readState.status,
      metrics: readState.snapshot ?? null,
      ...(cooldown ? { stale: true } : {}),
    });
  }

  // Explicit refresh on a healthy connection — the ONLY path that spends a read.
  const resolved = await broker.resolveActive(billingAccount.id, provider, scope);
  if (!resolved) {
    // The active row vanished between reads (revoked/disconnected mid-flight).
    return NextResponse.json({
      linked: true,
      status: readState.status,
      metrics: readState.snapshot ?? null,
    });
  }

  try {
    // Adapter construction stays in the composition root (routes must not import
    // adapters/server); the adapter is a dumb stateless fetcher — caching is ours.
    const insights = container.xInsightsForToken(resolved.credentials.accessToken);
    const metrics = await insights.readAccountMetrics({
      limit: RECENT_POST_LIMIT,
    });
    await broker.recordRead(
      resolved.connectionId,
      { snapshot: metrics, status: "active" },
      scope
    );
    return NextResponse.json({ linked: true, status: "active", metrics });
  } catch (error) {
    const costStatus = classifyReadError(error);
    if (costStatus) {
      // Trip the breaker and serve the last snapshot — no blank card, no re-call.
      await broker.recordRead(resolved.connectionId, { status: costStatus }, scope);
      logger.warn(
        { provider, reasonCode: "read_circuit_broken", status: costStatus },
        "platform read circuit-broken"
      );
      return NextResponse.json({
        linked: true,
        status: costStatus,
        metrics: readState.snapshot ?? null,
        stale: true,
      });
    }
    // Transient/unknown failure — don't mark the connection; serve last snapshot.
    logger.error(
      {
        provider,
        reasonCode: "metrics_read_failed",
        err: error instanceof Error ? error.message : "unknown",
      },
      "connection metrics read failed"
    );
    return NextResponse.json(
      {
        linked: true,
        status: readState.status,
        metrics: readState.snapshot ?? null,
        error: "metrics_read_failed",
      },
      { status: 502 }
    );
  }
}
