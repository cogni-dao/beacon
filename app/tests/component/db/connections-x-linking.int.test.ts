// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/connections-x-linking.int.test`
 * Purpose: Prove migration-0032 (`x` provider + display columns + COALESCE-guarded
 *   active-uniqueness index) is real on a live Postgres — not green-on-empty.
 * Scope: Exercises the schema additions for per-tenant X linking against a real DB:
 *   (a) an `x` connection with handle/status persists and reads back, (b) the
 *   COALESCE unique index allows multiple X handles per tenant but still blocks a
 *   second active NULL-external-id provider (openai) — the regression guard,
 *   (c) revoke-then-relink is allowed, (d) connections RLS isolates by
 *   created_by_user_id, fail-closed without tenant context. App-layer OAuth is
 *   covered by the connector unit test, not here.
 * Invariants:
 *   - X_PROVIDER_ACCEPTED: provider='x' passes the connections_provider_check.
 *   - MULTI_HANDLE_OK: two active X rows with distinct external_account_id coexist.
 *   - NULL_EXTERNAL_ID_SINGLETON: a second active openai connection (NULL external
 *     id) violates the unique index — proves COALESCE(...,'') guard.
 *   - TENANT_ISOLATED / FAIL_CLOSED: created_by_user_id RLS, zero rows w/o context.
 * Side-effects: IO (database operations via testcontainers).
 * Notes: getAppDb() = app_user (FORCE RLS); getSeedDb() = app_service (BYPASSRLS).
 * Links: app/src/adapters/server/db/migrations/0032_mighty_maelstrom.sql,
 *        packages/db-schema/src/connections.ts, docs/spec/platform-connections.md
 * @public
 */

import { randomUUID } from "node:crypto";
import { connections } from "@cogni/db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/adapters/server/db/client";
import { getAppDb } from "@/adapters/server/db/client";
import { billingAccounts, users } from "@/shared/db/schema";

interface TestAccount {
  userId: string;
  accountId: string;
}

const DUMMY_BLOB = Buffer.from("ciphertext-not-decrypted-in-this-test");

/** Minimal valid connections row; overrides merge on top. */
function connectionRow(
  acct: TestAccount,
  overrides: Partial<typeof connections.$inferInsert>
): typeof connections.$inferInsert {
  return {
    billingAccountId: acct.accountId,
    provider: "x",
    credentialType: "oauth2",
    encryptedCredentials: DUMMY_BLOB,
    encryptionKeyId: "v1",
    createdByUserId: acct.userId,
    ...overrides,
  };
}

async function withTenantScope<T>(
  db: Database,
  userId: string,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_user_id = '${sql.raw(userId)}'`);
    return fn(tx);
  });
}

describe("connections — per-tenant X linking schema (migration 0032)", () => {
  let db: Database;
  let accountA: TestAccount;
  let accountB: TestAccount;

  beforeAll(async () => {
    db = getAppDb();
    const seedDb = getSeedDb();
    accountA = { userId: randomUUID(), accountId: randomUUID() };
    accountB = { userId: randomUUID(), accountId: randomUUID() };

    for (const [acct, tag] of [
      [accountA, "a"],
      [accountB, "b"],
    ] as const) {
      await seedDb.insert(users).values({
        id: acct.userId,
        name: `Account ${tag.toUpperCase()}`,
        walletAddress: `0x${tag.repeat(40)}`.slice(0, 42),
      });
      await seedDb.insert(billingAccounts).values({
        id: acct.accountId,
        ownerUserId: acct.userId,
        balanceCredits: 1000n,
      });
    }
  });

  afterAll(async () => {
    const seedDb = getSeedDb();
    const ids = [accountA.accountId, accountB.accountId];
    await seedDb
      .delete(connections)
      .where(sql`billing_account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(billingAccounts)
      .where(sql`id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(users)
      .where(sql`id IN (${accountA.userId}, ${accountB.userId})`);
  });

  describe("schema additions", () => {
    it("persists an X connection with handle + status and reads it back", async () => {
      const seedDb = getSeedDb();
      const id = randomUUID();
      await seedDb.insert(connections).values(
        connectionRow(accountA, {
          id,
          externalAccountId: "x-acct-persist",
          externalHandle: "@acme",
          displayLabel: "Acme (@acme)",
        })
      );

      const [row] = await seedDb
        .select()
        .from(connections)
        .where(eq(connections.id, id));

      expect(row?.provider).toBe("x");
      expect(row?.externalHandle).toBe("@acme");
      expect(row?.status).toBe("active"); // column default
    });
  });

  describe("COALESCE-guarded active-uniqueness index", () => {
    it("allows two active X accounts for one tenant (distinct external_account_id)", async () => {
      const seedDb = getSeedDb();
      await seedDb.insert(connections).values(
        connectionRow(accountB, {
          externalAccountId: "x-handle-1",
          externalHandle: "@one",
        })
      );
      // Second active X row, different external id → must NOT collide.
      await expect(
        seedDb.insert(connections).values(
          connectionRow(accountB, {
            externalAccountId: "x-handle-2",
            externalHandle: "@two",
          })
        )
      ).resolves.toBeDefined();
    });

    it("rejects a second active NULL-external-id connection (openai) — proves COALESCE guard", async () => {
      const seedDb = getSeedDb();
      await seedDb.insert(connections).values(
        connectionRow(accountA, {
          provider: "openai-chatgpt",
          // external_account_id intentionally omitted (NULL)
        })
      );

      let caught: unknown;
      try {
        await seedDb.insert(connections).values(
          connectionRow(accountA, {
            provider: "openai-chatgpt",
          })
        );
      } catch (e) {
        caught = e;
      }
      const code = (caught as { cause?: { code?: string } })?.cause?.code;
      expect(code).toBe("23505"); // unique_violation
    });

    it("allows re-link of the same handle after the prior is revoked", async () => {
      const seedDb = getSeedDb();
      const first = randomUUID();
      await seedDb.insert(connections).values(
        connectionRow(accountB, {
          id: first,
          externalAccountId: "x-relink",
          externalHandle: "@relink",
        })
      );
      // Revoke, then insert the same handle again → partial index (WHERE revoked_at IS NULL) permits it.
      await seedDb
        .update(connections)
        .set({ revokedAt: new Date() })
        .where(eq(connections.id, first));

      await expect(
        seedDb.insert(connections).values(
          connectionRow(accountB, {
            externalAccountId: "x-relink",
            externalHandle: "@relink",
          })
        )
      ).resolves.toBeDefined();
    });
  });

  describe("RLS isolation (created_by_user_id)", () => {
    beforeAll(async () => {
      const seedDb = getSeedDb();
      await seedDb.insert(connections).values(
        connectionRow(accountA, {
          externalAccountId: "x-rls-a",
          externalHandle: "@rls_a",
        })
      );
    });

    it("a tenant sees only connections it created", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(connections)
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.createdByUserId).toBe(accountA.userId);
      }
    });

    it("a tenant cannot see another tenant's connections", async () => {
      const rows = await withTenantScope(db, accountB.userId, (tx) =>
        tx
          .select()
          .from(connections)
          .where(eq(connections.createdByUserId, accountA.userId))
      );
      expect(rows).toHaveLength(0);
    });

    it("no tenant context returns zero rows (fail-closed)", async () => {
      const rows = await db.transaction((tx) =>
        tx.select().from(connections)
      );
      expect(rows).toHaveLength(0);
    });
  });
});
