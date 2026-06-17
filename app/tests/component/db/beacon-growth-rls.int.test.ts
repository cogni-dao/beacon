// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/beacon-growth-rls.int.test`
 * Purpose: Prove the beacon-growth `tenant_isolation` RLS policies actually
 *   isolate the beacon-growth tables (`campaigns`, `broadcasts`, `post_metrics`,
 *   `channel_accounts`) by `account_id` at the database layer — not green-on-empty.
 * Scope: Seeds TWO accounts with real rows, then asserts (a) an account sees its
 *   own rows, (b) it cannot see the other account's rows, (c) a forgotten
 *   `SET LOCAL` returns zero rows (fail-closed), and (d) a cross-account INSERT
 *   is rejected by WITH CHECK. Does not test application-layer auth.
 * Invariants:
 *   - ACCOUNT_A_CANNOT_READ_B: every beacon-growth table filters to the GUC's account.
 *   - FAIL_CLOSED: no tenant context (no SET LOCAL) → zero rows.
 *   - WITH_CHECK_ENFORCED: writing a row for another account raises 42501.
 * Side-effects: IO (database operations via testcontainers)
 * Notes: getAppDb() connects as app_user (FORCE RLS via provision.sh). getSeedDb()
 *        connects as app_service (BYPASSRLS) for seed/cleanup.
 * Links: app/src/adapters/server/db/migrations/0031_glorious_warlock.sql,
 *        packages/db-schema/src/beacon-growth.ts, docs/spec/database-rls.md
 * @public
 */

import { randomUUID } from "node:crypto";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/adapters/server/db/client";
import { getAppDb } from "@/adapters/server/db/client";
import {
  billingAccounts,
  broadcasts,
  campaigns,
  channelAccounts,
  postMetrics,
  users,
} from "@/shared/db/schema";

interface TestAccount {
  userId: string;
  accountId: string;
  broadcastId: string;
}

/**
 * Helper: run a callback inside a transaction with RLS active.
 * app_user already has FORCE RLS via provision.sh — only tenant context needed.
 */
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

/**
 * Helper: run a callback as app_user WITHOUT setting tenant context.
 * Simulates a forgotten SET LOCAL — should return zero rows under RLS.
 */
async function withoutTenantScope<T>(
  db: Database,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx);
  });
}

const CAMPAIGN_ID = "rls-isolation-test";

describe("beacon-growth RLS account isolation", () => {
  let db: Database;
  let accountA: TestAccount;
  let accountB: TestAccount;

  beforeAll(async () => {
    db = getAppDb();
    const seedDb = getSeedDb();

    accountA = {
      userId: randomUUID(),
      accountId: randomUUID(),
      broadcastId: randomUUID(),
    };
    accountB = {
      userId: randomUUID(),
      accountId: randomUUID(),
      broadcastId: randomUUID(),
    };

    // Seed via service role (bypasses RLS).
    for (const [acct, tag] of [
      [accountA, "a"],
      [accountB, "b"],
    ] as const) {
      await seedDb.insert(users).values({
        id: acct.userId,
        name: `Account ${tag.toUpperCase()}`,
        walletAddress:
          `0x${tag.repeat(40)}${randomUUID().replace(/-/g, "").slice(0, 8)}`.slice(
            0,
            42
          ),
      });
      await seedDb.insert(billingAccounts).values({
        id: acct.accountId,
        ownerUserId: acct.userId,
        balanceCredits: 1000n,
      });
      await seedDb.insert(campaigns).values({
        accountId: acct.accountId,
        campaignId: `${CAMPAIGN_ID}-${tag}`,
        title: `Campaign ${tag.toUpperCase()}`,
        status: "draft",
      });
      await seedDb.insert(channelAccounts).values({
        accountId: acct.accountId,
        channel: "x",
        handle: `@account_${tag}`,
      });
      await seedDb.insert(broadcasts).values({
        id: acct.broadcastId,
        accountId: acct.accountId,
        campaignId: CAMPAIGN_ID,
        ideaKey: `idea-${tag}`,
        channel: "x",
        text: `post from account ${tag}`,
        status: "posted",
      });
      await seedDb.insert(postMetrics).values({
        broadcastId: acct.broadcastId,
        accountId: acct.accountId,
        channel: "x",
        impressions: 100,
        likes: 5,
      });
    }
  });

  afterAll(async () => {
    // Cleanup via service role (bypasses RLS); children before parents (FKs).
    const seedDb = getSeedDb();
    const ids = [accountA.accountId, accountB.accountId];
    await seedDb
      .delete(postMetrics)
      .where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(broadcasts)
      .where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(channelAccounts)
      .where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(campaigns)
      .where(sql`account_id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(billingAccounts)
      .where(sql`id IN (${ids[0]}, ${ids[1]})`);
    await seedDb
      .delete(users)
      .where(sql`id IN (${accountA.userId}, ${accountB.userId})`);
  });

  describe("campaigns - account isolation", () => {
    it("account A sees only its own campaign", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(campaigns)
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.accountId).toBe(accountA.accountId);
      }
    });

    it("account A cannot see account B's campaign", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(campaigns)
      );
      const owners = rows.map((r) => r.accountId);
      expect(owners).not.toContain(accountB.accountId);
    });
  });

  describe("broadcasts - account isolation", () => {
    it("account A sees its own broadcast", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(broadcasts)
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(accountA.broadcastId);
      for (const r of rows) {
        expect(r.accountId).toBe(accountA.accountId);
      }
    });

    it("account A cannot see account B's broadcast", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(broadcasts)
      );
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(accountB.broadcastId);
    });
  });

  describe("post_metrics - account isolation", () => {
    it("account A sees only its own snapshots", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(postMetrics)
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.accountId).toBe(accountA.accountId);
      }
    });

    it("account A cannot see account B's snapshots", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(postMetrics)
      );
      const owners = rows.map((r) => r.accountId);
      expect(owners).not.toContain(accountB.accountId);
    });
  });

  describe("channel_accounts - account isolation", () => {
    it("account A sees only its own channel accounts", async () => {
      const rows = await withTenantScope(db, accountA.userId, (tx) =>
        tx.select().from(channelAccounts)
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.accountId).toBe(accountA.accountId);
      }
    });
  });

  describe("missing tenant context - fail-safe deny", () => {
    it("no SET LOCAL on campaigns returns zero rows", async () => {
      const rows = await withoutTenantScope(db, (tx) =>
        tx.select().from(campaigns)
      );
      expect(rows).toHaveLength(0);
    });

    it("no SET LOCAL on broadcasts returns zero rows", async () => {
      const rows = await withoutTenantScope(db, (tx) =>
        tx.select().from(broadcasts)
      );
      expect(rows).toHaveLength(0);
    });

    it("no SET LOCAL on post_metrics returns zero rows", async () => {
      const rows = await withoutTenantScope(db, (tx) =>
        tx.select().from(postMetrics)
      );
      expect(rows).toHaveLength(0);
    });

    it("no SET LOCAL on channel_accounts returns zero rows", async () => {
      const rows = await withoutTenantScope(db, (tx) =>
        tx.select().from(channelAccounts)
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("write-path WITH CHECK enforcement", () => {
    it("cross-account campaign INSERT is rejected by RLS policy", async () => {
      let caught: unknown;
      try {
        await withTenantScope(db, accountA.userId, (tx) =>
          tx.insert(campaigns).values({
            accountId: accountB.accountId, // A writing as B
            campaignId: `xss-${randomUUID().slice(0, 8)}`,
            title: "cross-account campaign",
            status: "draft",
          })
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const cause = (caught as { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("42501"); // insufficient_privilege (RLS WITH CHECK)
    });

    it("cross-account broadcast INSERT is rejected by RLS policy", async () => {
      let caught: unknown;
      try {
        await withTenantScope(db, accountA.userId, (tx) =>
          tx.insert(broadcasts).values({
            accountId: accountB.accountId, // A writing as B
            campaignId: CAMPAIGN_ID,
            ideaKey: `xss-${randomUUID().slice(0, 8)}`,
            channel: "x",
            text: "cross-account write",
            status: "drafted",
          })
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const cause = (caught as { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("42501"); // insufficient_privilege (RLS WITH CHECK)
    });
  });
});
