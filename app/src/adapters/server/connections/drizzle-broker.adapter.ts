// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/drizzle-broker.adapter`
 * Purpose: Drizzle-based implementation of ConnectionBrokerPort.
 * Scope: Reads connections table, verifies tenant, decrypts AEAD blob, checks expiry, refreshes if needed.
 * Invariants:
 * - BROKER_RESOLVES_ALL: Single credential resolution path.
 * - TENANT_SCOPED: Verifies billing_account_id matches before decryption.
 * - ENCRYPTED_AT_REST: AEAD decrypt with AAD binding.
 * - TOKENS_NEVER_LOGGED: Never logs credential values.
 * Side-effects: IO (database read, optional token refresh + write)
 * Links: docs/spec/tenant-connections.md, src/ports/connection-broker.port.ts
 * @internal
 */

import { withTenantScope } from "@cogni/db-client";
import { connections } from "@cogni/db-schema";
import type { ActorId } from "@cogni/ids";
import { type AeadAAD, aeadDecrypt, aeadEncrypt } from "@cogni/node-shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type {
  ConnectionBrokerPort,
  ConnectionReadState,
  ConnectionReadUpdate,
  ResolvedConnection,
} from "@/ports";

/** Parsed credential blob shape (provider-agnostic) */
interface CredentialBlob {
  access_token: string;
  refresh_token?: string;
  account_id?: string;
  id_token?: string;
  expires_at?: string;
}

/** Token refresh function signature — provider-specific implementations injected */
export type TokenRefreshFn = (refreshToken: string) => Promise<{
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}>;

/** Configuration for the broker adapter */
export interface DrizzleConnectionBrokerConfig {
  db: NodePgDatabase;
  encryptionKey: Buffer;
  encryptionKeyId: string;
  log: Logger;
  /** Provider-specific refresh functions. Key = provider name. */
  refreshFns?: Record<string, TokenRefreshFn>;
}

/** Buffer window before expiry to trigger proactive refresh (5 minutes) */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class DrizzleConnectionBrokerAdapter implements ConnectionBrokerPort {
  private readonly db: NodePgDatabase;
  private readonly encryptionKey: Buffer;
  private readonly encryptionKeyId: string;
  private readonly log: Logger;
  private readonly refreshFns: Record<string, TokenRefreshFn>;
  /** Per-connection mutex to prevent concurrent refresh races */
  private readonly refreshLocks = new Map<string, Promise<CredentialBlob>>();

  constructor(config: DrizzleConnectionBrokerConfig) {
    this.db = config.db;
    this.encryptionKey = config.encryptionKey;
    this.encryptionKeyId = config.encryptionKeyId;
    this.log = config.log.child({ component: "ConnectionBroker" });
    this.refreshFns = config.refreshFns ?? {};
  }

  async resolve(
    connectionId: string,
    scope: { actorId: string; tenantId: string }
  ): Promise<ResolvedConnection> {
    // SELECT with tenant + active filters (withTenantScope sets RLS context)
    const rows = await withTenantScope(
      this
        .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
      scope.actorId as ActorId,
      async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(eq(connections.id, connectionId), isNull(connections.revokedAt))
          )
          .limit(1)
    );

    const row = rows[0];
    if (!row) {
      throw new ConnectionNotFoundError(connectionId);
    }

    // Tenant verification (defense-in-depth)
    if (row.billingAccountId !== scope.tenantId) {
      this.log.warn(
        { connectionId, expectedTenant: scope.tenantId },
        "Connection tenant mismatch"
      );
      throw new ConnectionNotFoundError(connectionId);
    }

    // AEAD decrypt with AAD binding
    const aad: AeadAAD = {
      billing_account_id: row.billingAccountId,
      connection_id: connectionId,
      provider: row.provider,
    };

    let blob: CredentialBlob;
    try {
      const plaintext = aeadDecrypt(
        row.encryptedCredentials,
        aad,
        this.encryptionKey
      );
      blob = JSON.parse(plaintext) as CredentialBlob;
    } catch {
      throw new ConnectionDecryptionError(connectionId);
    }

    // Check expiry and refresh if needed (with per-connection mutex)
    const expiresAt = blob.expires_at ? new Date(blob.expires_at) : null;
    if (
      expiresAt &&
      blob.refresh_token &&
      Date.now() > expiresAt.getTime() - REFRESH_BUFFER_MS
    ) {
      const refreshFn = this.refreshFns[row.provider];
      if (refreshFn) {
        const existing = this.refreshLocks.get(connectionId);
        if (existing) {
          // Another call is already refreshing — wait for its result
          blob = await existing;
        } else {
          const refreshPromise = this.refreshAndPersist(
            connectionId,
            row.billingAccountId,
            row.provider,
            blob,
            refreshFn,
            scope.actorId
          );
          this.refreshLocks.set(connectionId, refreshPromise);
          try {
            blob = await refreshPromise;
          } finally {
            this.refreshLocks.delete(connectionId);
          }
        }
      }
    }

    // Update last_used_at (fire-and-forget, needs RLS context)
    withTenantScope(
      this
        .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
      scope.actorId as ActorId,
      async (tx) =>
        tx
          .update(connections)
          .set({ lastUsedAt: new Date() })
          .where(eq(connections.id, connectionId))
    ).catch(() => {});

    const credentials: ResolvedConnection["credentials"] = {
      accessToken: blob.access_token,
      ...(blob.refresh_token ? { refreshToken: blob.refresh_token } : {}),
      ...(blob.account_id ? { accountId: blob.account_id } : {}),
      ...(blob.id_token ? { idToken: blob.id_token } : {}),
    };

    return {
      connectionId,
      provider: row.provider,
      credentialType: row.credentialType,
      credentials,
      expiresAt: blob.expires_at ? new Date(blob.expires_at) : null,
      scopes: row.scopes ?? [],
    };
  }

  async resolveActive(
    billingAccountId: string,
    provider: string,
    scope: { actorId: string; tenantId: string }
  ): Promise<ResolvedConnection | null> {
    // Find the active, non-revoked connection within the caller's tenant scope.
    // withTenantScope sets the RLS context; status='active' skips needs_reauth/
    // expired rows so the data plane never resolves a known-broken connection.
    const rows = await withTenantScope(
      this
        .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
      scope.actorId as ActorId,
      async (tx) =>
        tx
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(
              eq(connections.billingAccountId, billingAccountId),
              eq(connections.provider, provider),
              eq(connections.status, "active"),
              isNull(connections.revokedAt)
            )
          )
          // Deterministic when a tenant has multiple active accounts: newest link.
          .orderBy(desc(connections.createdAt))
          .limit(1)
    );

    const row = rows[0];
    if (!row) return null;

    // Delegate to resolve() so decrypt + expiry-refresh + last_used_at all run.
    return this.resolve(row.id, scope);
  }

  async getReadState(
    billingAccountId: string,
    provider: string,
    scope: { actorId: string; tenantId: string }
  ): Promise<ConnectionReadState | null> {
    // Most recent non-revoked connection for this provider — ANY status, so a
    // circuit-broken (needs_billing/rate_limited) row still serves its snapshot.
    // No decrypt, no platform call: this is the zero-cost passive-view path.
    const rows = await withTenantScope(
      this
        .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
      scope.actorId as ActorId,
      async (tx) =>
        tx
          .select({
            id: connections.id,
            status: connections.status,
            snapshot: connections.metricsSnapshot,
            fetchedAt: connections.metricsFetchedAt,
          })
          .from(connections)
          .where(
            and(
              eq(connections.billingAccountId, billingAccountId),
              eq(connections.provider, provider),
              isNull(connections.revokedAt)
            )
          )
          .orderBy(desc(connections.createdAt))
          .limit(1)
    );

    const row = rows[0];
    if (!row) return null;
    return {
      connectionId: row.id,
      status: row.status,
      snapshot: row.snapshot ?? null,
      fetchedAt: row.fetchedAt ?? null,
    };
  }

  async recordRead(
    connectionId: string,
    update: ConnectionReadUpdate,
    scope: { actorId: string; tenantId: string }
  ): Promise<void> {
    const set = {
      ...(update.snapshot !== undefined
        ? { metricsSnapshot: update.snapshot, metricsFetchedAt: new Date() }
        : {}),
      ...(update.status ? { status: update.status } : {}),
    };
    if (Object.keys(set).length === 0) return;

    await withTenantScope(
      this
        .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
      scope.actorId as ActorId,
      async (tx) =>
        tx.update(connections).set(set).where(eq(connections.id, connectionId))
    );
  }

  private async refreshAndPersist(
    connectionId: string,
    billingAccountId: string,
    provider: string,
    blob: CredentialBlob,
    refreshFn: TokenRefreshFn,
    actorId: string
  ): Promise<CredentialBlob> {
    this.log.info(
      { connectionId, provider },
      "Refreshing expired connection token"
    );

    try {
      // biome-ignore lint/style/noNonNullAssertion: caller checks blob.refresh_token exists before calling this method
      const refreshed = await refreshFn(blob.refresh_token!);
      const newBlob: CredentialBlob = {
        access_token: refreshed.access,
        refresh_token: refreshed.refresh,
        ...(refreshed.accountId
          ? { account_id: refreshed.accountId }
          : blob.account_id
            ? { account_id: blob.account_id }
            : {}),
        expires_at: new Date(refreshed.expires).toISOString(),
      };

      // Re-encrypt with same AAD binding
      const aad: AeadAAD = {
        billing_account_id: billingAccountId,
        connection_id: connectionId,
        provider,
      };
      const encrypted = aeadEncrypt(
        JSON.stringify(newBlob),
        aad,
        this.encryptionKey
      );

      await withTenantScope(
        this
          .db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase,
        actorId as ActorId,
        async (tx) =>
          tx
            .update(connections)
            .set({
              encryptedCredentials: encrypted,
              encryptionKeyId: this.encryptionKeyId,
              expiresAt: new Date(refreshed.expires),
            })
            .where(eq(connections.id, connectionId))
      );

      return newBlob;
    } catch (error) {
      this.log.error(
        {
          connectionId,
          provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "Token refresh failed"
      );
      // Return stale blob — the downstream call will fail with 401 if token is truly expired
      return blob;
    }
  }
}

export class ConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Connection not found or revoked: ${connectionId}`);
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionDecryptionError extends Error {
  constructor(connectionId: string) {
    super(`Failed to decrypt connection credentials: ${connectionId}`);
    this.name = "ConnectionDecryptionError";
  }
}
