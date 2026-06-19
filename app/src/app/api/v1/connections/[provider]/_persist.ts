// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/connections/[provider]/_persist`
 * Purpose: Shared connection persistence — encrypt the credential blob (AEAD) and
 *   insert a connections row, revoking any prior active one for the same handle.
 *   Used by both the OAuth callback and the credential connect (POST) flows so
 *   there is one storage path, not two.
 * Invariants:
 *   - ENCRYPTED_AT_REST: AEAD with AAD binding {billing_account_id, connection_id, provider}.
 *   - TENANT_SCOPED: written inside withTenantScope for the caller's user.
 *   - RELINK_REPLACES: a re-link revokes the prior active row for the same external account.
 * Side-effects: IO (DB update + insert).
 * Links: docs/spec/platform-connections.md
 * @internal
 */

import { randomUUID } from "node:crypto";
import { withTenantScope } from "@cogni/db-client";
import { connections } from "@cogni/db-schema";
import { type UserId, userActor } from "@cogni/ids";
import { aeadEncrypt, decodeAeadKey } from "@cogni/node-shared";
import { and, eq, isNull } from "drizzle-orm";
import { resolveAppDb } from "@/bootstrap/container";
import type { PlatformLinkResult } from "@/ports";

export async function persistPlatformConnection(params: {
  provider: string;
  credentialType: string;
  userId: string;
  billingAccountId: string;
  link: PlatformLinkResult;
  /** Raw CONNECTIONS_ENCRYPTION_KEY (64-hex dev or base64-of-32-bytes). */
  encKeyHex: string;
}): Promise<{ connectionId: string }> {
  const { provider, credentialType, userId, billingAccountId, link, encKeyHex } =
    params;

  const connectionId = randomUUID();
  // Persist the stable external id inside the blob (matches openai-codex) so the
  // broker surfaces it as credentials.accountId for the per-tenant data plane.
  const storedBlob = {
    ...link.blob,
    account_id: link.account.externalAccountId,
  };
  const encrypted = aeadEncrypt(
    JSON.stringify(storedBlob),
    {
      billing_account_id: billingAccountId,
      connection_id: connectionId,
      provider,
    },
    decodeAeadKey(encKeyHex)
  );

  const db = resolveAppDb();
  await withTenantScope(db, userActor(userId as UserId), async (tx) => {
    // Revoke any prior active connection for this exact handle (re-link replaces).
    await tx
      .update(connections)
      .set({ revokedAt: new Date(), revokedByUserId: userId })
      .where(
        and(
          eq(connections.billingAccountId, billingAccountId),
          eq(connections.provider, provider),
          eq(connections.externalAccountId, link.account.externalAccountId),
          isNull(connections.revokedAt)
        )
      );

    await tx.insert(connections).values({
      id: connectionId,
      billingAccountId,
      provider,
      credentialType,
      encryptedCredentials: encrypted,
      encryptionKeyId: "v1",
      scopes: [...link.scopes],
      externalAccountId: link.account.externalAccountId,
      externalHandle: link.account.handle,
      displayLabel: link.account.displayLabel,
      status: "active",
      createdByUserId: userId,
      ...(link.expiresAt ? { expiresAt: link.expiresAt } : {}),
    });
  });

  return { connectionId };
}
