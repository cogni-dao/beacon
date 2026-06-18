// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/setup/run-migrations.diag`
 * Purpose: Apply drizzle migrations against the testcontainer DB and surface the
 *   FULL Postgres error if one fails. drizzle-kit's `migrate` CLI swallows the
 *   underlying error behind a spinner ("Command failed"), which hides the failing
 *   statement. This runner uses the programmatic migrator so the PostgresError
 *   (message, code, failing SQL position) reaches stderr.
 * Scope: Component-test diagnostics only. DATABASE_URL must point at the provisioned DB.
 * Side-effects: IO (DB connection, applies migrations).
 * @internal
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app/tests/component/setup -> app/src/adapters/server/db/migrations
const MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  "../../../src/adapters/server/db/migrations"
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[run-migrations.diag] migrations applied OK");
  } catch (err) {
    // postgres.js PostgresError carries severity/code/detail/position/query.
    const e = err as Record<string, unknown>;
    console.error("[run-migrations.diag] MIGRATION FAILED");
    console.error("  message :", e.message);
    console.error("  code    :", e.code);
    console.error("  severity:", e.severity);
    console.error("  detail  :", e.detail);
    console.error("  hint    :", e.hint);
    console.error("  position:", e.position);
    console.error("  where   :", e.where);
    console.error("  query   :", e.query);
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
