// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/disconnect`
 * Purpose: Soft-delete the active platform connection(s) for the authenticated tenant + provider.
 * Scope: POST. Sets revoked_at on active rows for the user's billing account. Generic per provider.
 * Invariants:
 *   - SOFT_DELETE: sets revoked_at, never hard-deletes.
 *   - TENANT_SCOPED: only the caller's billing-account connections.
 * Side-effects: IO (DB update).
 * Links: docs/spec/platform-connections.md
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { connections } from "@cogni/db-schema";
import { type UserId, userActor } from "@cogni/ids";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";

const log = makeLogger({ component: "platform-connect-disconnect" });

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const container = getContainer();
  const accountService = container.accountsForUser(session.id as UserId);
  const billingAccount = await getOrCreateBillingAccountForUser(accountService, {
    userId: session.id,
  });

  const db = resolveAppDb();
  try {
    await withTenantScope(db, userActor(session.id as UserId), async (tx) =>
      tx
        .update(connections)
        .set({ revokedAt: new Date(), revokedByUserId: session.id })
        .where(
          and(
            eq(connections.billingAccountId, billingAccount.id),
            eq(connections.provider, provider),
            isNull(connections.revokedAt)
          )
        )
    );
    log.info(
      { provider, billingAccountId: billingAccount.id },
      "Platform connection disconnected"
    );
  } catch (err) {
    log.error(
      { provider, error: err instanceof Error ? err.message : String(err) },
      "Failed to disconnect platform connection"
    );
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
