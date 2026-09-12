// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/connection-broker.port`
 * Purpose: Port interface for encrypted credential resolution from the connections table.
 * Scope: Resolves connectionId to decrypted credentials. Handles tenant verification, expiry check, and refresh.
 *   Used by BYOExecutorDecorator (model backend) and future toolRunner (tool auth).
 * Invariants:
 * - BROKER_RESOLVES_ALL: Single credential resolution path. Adapters never do direct DB reads + decrypt.
 * - TENANT_SCOPED: Verifies connection belongs to the caller's billing account.
 * - TOKENS_NEVER_LOGGED: Resolved credentials must not appear in logs or error messages.
 * Side-effects: none (interface only)
 * Links: docs/spec/tenant-connections.md, nodes/operator/app/src/adapters/server/connections/drizzle-broker.adapter.ts
 * @public
 */

/**
 * Resolved connection credentials returned by the broker.
 * Provider-agnostic — the caller decides how to use the credentials
 * based on the `provider` field.
 */
export interface ResolvedConnection {
  readonly connectionId: string;
  readonly provider: string;
  readonly credentialType: string;
  readonly credentials: {
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly accountId?: string;
    readonly idToken?: string;
  };
  readonly expiresAt: Date | null;
  readonly scopes: readonly string[];
}

/** Security scope for connection resolution — defines the trust boundary. */
export interface ConnectionScope {
  /** The actor requesting access */
  readonly actorId: string;
  /** The tenant boundary — connection must belong to this tenant */
  readonly tenantId: string;
}

/**
 * Connection broker port.
 * Resolves a connectionId to decrypted credentials with tenant verification.
 */
export interface ConnectionBrokerPort {
  /**
   * Resolve a connection by ID with tenant + actor verification.
   * @throws if connection not found, revoked, or belongs to a different tenant.
   */
  resolve(
    connectionId: string,
    scope: ConnectionScope
  ): Promise<ResolvedConnection>;

  /**
   * Resolve the single ACTIVE connection for a (billing account, provider)
   * pair — the tool-side resolution path the data plane needs. Finds the
   * active, non-revoked connection within the caller's tenant scope, then
   * resolves it (decrypt + expiry refresh) exactly like {@link resolve}.
   *
   * @returns the resolved connection, or null when the tenant has none active.
   * @throws if a found connection cannot be decrypted or fails verification.
   */
  resolveActive(
    billingAccountId: string,
    provider: string,
    scope: ConnectionScope
  ): Promise<ResolvedConnection | null>;

  /**
   * Read the cached read-state for a (billing account, provider) pair WITHOUT
   * decrypting credentials or making any platform call. Returns the most recent
   * non-revoked connection regardless of status — so a `needs_billing` /
   * `rate_limited` row still surfaces its last-known snapshot. This is the
   * zero-cost path the data plane serves on passive views (read-cost governance).
   *
   * @returns the read-state, or null when the tenant has no connection.
   */
  getReadState(
    billingAccountId: string,
    provider: string,
    scope: ConnectionScope
  ): Promise<ConnectionReadState | null>;

  /**
   * Persist the result of a paid read: the snapshot (which also stamps
   * `fetched_at`) and/or a status transition (the read-cost circuit-breaker
   * marks `needs_billing` / `rate_limited` / re-arms to `active`). Never touches
   * credentials. Tenant-scoped via RLS.
   */
  recordRead(
    connectionId: string,
    update: ConnectionReadUpdate,
    scope: ConnectionScope
  ): Promise<void>;
}

/** Circuit-breaker-relevant connection statuses the data plane sets. */
export type ConnectionReadStatus = "active" | "needs_billing" | "rate_limited";

/** Cached read-state for a connection — no credentials, safe to serve to the UI. */
export interface ConnectionReadState {
  readonly connectionId: string;
  /** Health/circuit-breaker status, legible without decryption. */
  readonly status: string;
  /** Last cached read payload (public metrics only), or null if never read. */
  readonly snapshot: unknown;
  /** When the snapshot was last refreshed, or null if never read. */
  readonly fetchedAt: Date | null;
}

/** Write to a connection's read-state. Either field may be omitted. */
export interface ConnectionReadUpdate {
  /** New snapshot to cache; supplying it also stamps `fetched_at = now`. */
  readonly snapshot?: unknown;
  /** Status transition (circuit-breaker mark or re-arm). */
  readonly status?: ConnectionReadStatus;
}
