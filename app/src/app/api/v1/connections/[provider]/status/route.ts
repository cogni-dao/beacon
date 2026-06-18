// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/status`
 * Purpose: Report whether the authenticated tenant has an active connection for a platform.
 * Scope: GET. Returns { connected, accounts: [{ handle, displayLabel, status }] } from non-secret
 *   columns only. Generic across providers.
 * Invariants:
 *   - NEVER_DECRYPTS: reads display columns only, never the credential blob.
 *   - TENANT_SCOPED: only the caller's billing-account connections.
 * Side-effects: IO (DB query).
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ connected: false, accounts: [] });
  }

  try {
    const container = getContainer();
    const accountService = container.accountsForUser(session.id as UserId);
    const billingAccount = await getOrCreateBillingAccountForUser(
      accountService,
      { userId: session.id }
    );

    const db = resolveAppDb();
    const rows = await withTenantScope(
      db,
      userActor(session.id as UserId),
      async (tx) =>
        tx
          .select({
            id: connections.id,
            handle: connections.externalHandle,
            displayLabel: connections.displayLabel,
            status: connections.status,
          })
          .from(connections)
          .where(
            and(
              eq(connections.billingAccountId, billingAccount.id),
              eq(connections.provider, provider),
              isNull(connections.revokedAt)
            )
          )
    );

    return NextResponse.json({ connected: rows.length > 0, accounts: rows });
  } catch {
    return NextResponse.json({ connected: false, accounts: [] });
  }
}
