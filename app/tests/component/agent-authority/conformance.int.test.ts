// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Published authority suites over Beacon migrations, with a genuine non-bypass app role. */
import { randomBytes, randomUUID } from "node:crypto";
import {
  type AgentGrantsStore,
  createPostgresAgentGrantsStore,
} from "@cogni/agent-grants";
import {
  type ConformanceFacts,
  runCredentialConformance,
} from "@cogni/agent-grants/conformance";
import {
  agentRolesHasRoles,
  type CredentialStore,
  createPostgresCredentialStore,
} from "@cogni/agent-grants/credentials";
import {
  runAgentWalletGuardConformance,
  runGrantConformance,
} from "@cogni/agent-grants/grants-conformance";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

// The component global setup provisions a throwaway database, migrates as its
// app owner, and verifies ENABLE+FORCE RLS. No externally supplied database.
if (!process.env.DATABASE_URL || !process.env.DATABASE_SERVICE_URL)
  throw new Error("Run with vitest.component.config.mts");
const app = postgres(process.env.DATABASE_URL, { max: 1 });
const service = postgres(process.env.DATABASE_SERVICE_URL, { max: 1 });
let created: string[] = [];
let touched: string[] = [];
let approver: string;
const grants = () => createPostgresAgentGrantsStore(service);
const credentials = () =>
  createPostgresCredentialStore(service, {
    hasRoles: agentRolesHasRoles(service),
  });

function required(ids: Record<string, string>, name: string): string {
  const id = ids[name];
  if (!id) throw new Error(`Missing fixture user: ${name}`);
  return id;
}
async function user(name: string) {
  const id = randomUUID();
  await service`INSERT INTO users (id, name) VALUES (${id}, ${name})`;
  created.push(id);
  touched.push(id);
  return id;
}
async function role(id: string) {
  await service`INSERT INTO agent_roles (principal_user_id, scope, approved_by, granted_at)
    VALUES (${id}, 'work_item:transition', ${approver}, now())`;
}
async function setup(users: Record<string, ConformanceFacts>) {
  approver = await user("fixture-approver");
  const ids: Record<string, string> = {};
  for (const [name, facts] of Object.entries(users)) {
    ids[name] = await user(name);
    if (!facts.human)
      await service`INSERT INTO agent_principals (user_id, kind, slug)
      VALUES (${required(ids, name)}, ${facts.internal ? "internal" : "external"}, ${facts.internal ? `fixture-${required(ids, name)}` : null})`;
    if (facts.wallet) {
      const wallet = `0x${randomBytes(20).toString("hex")}`;
      await service`UPDATE users SET wallet_address = ${wallet} WHERE id = ${required(ids, name)}`;
      await service`INSERT INTO user_bindings (id, user_id, provider, external_id) VALUES (${randomUUID()}, ${required(ids, name)}, 'wallet', ${wallet})`;
    }
    if (facts.github)
      await service`INSERT INTO user_bindings (id, user_id, provider, external_id) VALUES (${randomUUID()}, ${required(ids, name)}, 'github', ${String(BigInt(`0x${randomBytes(8).toString("hex")}`))})`;
    if (facts.roles) await role(ids[name]);
  }
  return { store: credentials(), ids };
}
afterEach(async () => {
  if (!touched.length) return;
  await service`DELETE FROM agent_credentials WHERE user_id IN ${service(touched)}`;
  await service`DELETE FROM agent_roles WHERE principal_user_id IN ${service(touched)} OR approved_by IN ${service(touched)}`;
  await service`DELETE FROM user_bindings WHERE user_id IN ${service(created)}`;
  await service`DELETE FROM billing_accounts WHERE owner_user_id IN ${service(created)}`;
  await service`DELETE FROM agent_principals WHERE user_id IN ${service(created)}`;
  await service`DELETE FROM users WHERE id IN ${service(created)}`;
  created = [];
  touched = [];
});
afterAll(async () => {
  await Promise.all([app.end(), service.end()]);
});

runGrantConformance({
  describe,
  it,
  expect,
  async setup(spec) {
    const { ids } = await setup(
      Object.fromEntries(
        [...spec.owners, ...spec.agents].map((name) => [
          name,
          { human: spec.owners.includes(name) },
        ]),
      ),
    );
    const accounts: Record<string, string> = {};
    for (const name of spec.owners) {
      accounts[name] = randomUUID();
      await service`INSERT INTO billing_accounts (id, owner_user_id, balance_credits) VALUES (${accounts[name]}, ${required(ids, name)}, 0)`;
    }
    for (const name of spec.internal) {
      const existing =
        await service`SELECT user_id FROM agent_principals WHERE kind = 'internal' AND slug = ${name}`;
      if (existing[0]) {
        ids[name] = existing[0].user_id;
        touched.push(required(ids, name));
      } else {
        ids[name] = await user(name);
        await service`INSERT INTO agent_principals (user_id, kind, slug) VALUES (${required(ids, name)}, 'internal', ${name})`;
      }
    }
    return { store: grants(), ids, accounts };
  },
  async expireGrant(id, scope) {
    await service`UPDATE agent_roles SET granted_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE principal_user_id = ${id} AND scope = ${scope} AND resource = 'account' AND approved_by IS NOT NULL`;
  },
  async expireLink(id, scope) {
    await service`UPDATE agent_roles SET link_expires_at = now() - interval '1 day' WHERE principal_user_id = ${id} AND scope = ${scope}`;
  },
  broken: () =>
    new Proxy({} as AgentGrantsStore, {
      get: () => async () => {
        throw new Error("fixture outage");
      },
    }),
});
runCredentialConformance({
  describe,
  it,
  expect,
  setup,
  async age(id, to) {
    if (to === "pending_expired")
      await service`UPDATE agent_credentials SET pending_expires_at = now() - interval '1 day' WHERE id = ${id}`;
    else if (to === "renew_only")
      await service`UPDATE agent_credentials SET expires_at = now() - interval '1 day', renew_until = now() + interval '1 day' WHERE id = ${id}`;
    else
      await service`UPDATE agent_credentials SET expires_at = now() - interval '2 days', renew_until = now() - interval '1 day' WHERE id = ${id}`;
  },
  addRoles: role,
  broken: () =>
    new Proxy({} as CredentialStore, {
      get: () => async () => {
        throw new Error("fixture outage");
      },
    }),
  async storedHash(id) {
    const rows =
      await service`SELECT token_hash FROM agent_credentials WHERE id = ${id}`;
    return rows[0]?.token_hash ?? null;
  },
  async liveSuccessors(id) {
    const rows =
      await service`SELECT count(*)::int AS n FROM agent_credentials WHERE predecessor_id = ${id} AND confirmed_at IS NULL AND revoked_at IS NULL`;
    return rows[0]?.n ?? 0;
  },
});
runAgentWalletGuardConformance({
  describe,
  it,
  expect,
  sql: app,
  leafTables: ["epoch_distribution_leaves", "distribution_settlement_leaves"],
});

it("enforces the actual app-role RLS boundary and refuses credential-store use", async () => {
  const rows =
    await app`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
  expect(rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
  const { ids } = await setup({ agent: {} });
  const agentId = required(ids, "agent");
  await role(agentId);
  expect(await grants().hasLiveRole(agentId, "work_item:transition")).toBe(
    true,
  );
  expect(
    await createPostgresAgentGrantsStore(app).hasLiveRole(
      agentId,
      "work_item:transition",
    ),
  ).toBe(false);
  const appCredentials = createPostgresCredentialStore(app, {
    hasRoles: agentRolesHasRoles(app),
  });
  await expect(appCredentials.everConfirmed(agentId)).rejects.toThrow();
  await expect(
    app`INSERT INTO agent_roles (principal_user_id, scope) VALUES (${agentId}, 'work_item:transition')`,
  ).rejects.toThrow();
});
