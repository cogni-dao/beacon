CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_from" text NOT NULL,
	"predecessor_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"renew_until" timestamp with time zone NOT NULL,
	"pending_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by" text,
	CONSTRAINT "agent_credentials_created_from_canonical" CHECK ("agent_credentials"."created_from" IN ('spawn_grant','rotation','key_upgrade','binding_recovery','recovery_grant')),
	CONSTRAINT "agent_credentials_renew_after_expiry" CHECK ("agent_credentials"."renew_until" > "agent_credentials"."expires_at")
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slug" text,
	"owner_source_kind" text,
	"owner_source_ref" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_principals_kind_canonical" CHECK ("agent_principals"."kind" IN ('internal','external','org')),
	CONSTRAINT "agent_principals_org_has_owner_source" CHECK ("agent_principals"."kind" <> 'org' OR ("agent_principals"."owner_source_kind" IS NOT NULL AND "agent_principals"."owner_source_ref" IS NOT NULL)),
	CONSTRAINT "agent_principals_internal_has_slug" CHECK ("agent_principals"."kind" <> 'internal' OR "agent_principals"."slug" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agent_principals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_user_id" text NOT NULL,
	"scope" text NOT NULL,
	"approved_by" text,
	"granted_at" timestamp with time zone,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"resource" text DEFAULT 'node' NOT NULL,
	"account_id" text,
	"expires_at" timestamp with time zone,
	"link_hash" text,
	"link_expires_at" timestamp with time zone,
	"link_consumed_at" timestamp with time zone,
	CONSTRAINT "agent_roles_resource_canonical" CHECK ("agent_roles"."resource" IN ('node','account')),
	CONSTRAINT "agent_roles_node_shape" CHECK ("agent_roles"."resource" <> 'node' OR ("agent_roles"."account_id" IS NULL AND "agent_roles"."expires_at" IS NULL)),
	CONSTRAINT "agent_roles_account_live_shape" CHECK ("agent_roles"."resource" <> 'account' OR "agent_roles"."approved_by" IS NULL OR ("agent_roles"."account_id" IS NOT NULL AND "agent_roles"."granted_at" IS NOT NULL AND ("agent_roles"."expires_at" IS NULL OR "agent_roles"."expires_at" > "agent_roles"."granted_at"))),
	CONSTRAINT "agent_roles_no_self_approval" CHECK ("agent_roles"."approved_by" IS NULL OR "agent_roles"."approved_by" <> "agent_roles"."principal_user_id"),
	CONSTRAINT "agent_roles_link_consumed_has_no_hash" CHECK ("agent_roles"."link_consumed_at" IS NULL OR "agent_roles"."link_hash" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "agent_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_item_leases" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"lease_token" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_command" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_predecessor_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."agent_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_principal_user_id_users_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_token_hash_unique" ON "agent_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_one_pending_successor" ON "agent_credentials" USING btree ("predecessor_id") WHERE "agent_credentials"."confirmed_at" IS NULL AND "agent_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "agent_credentials_user_idx" ON "agent_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_principals_slug_unique" ON "agent_principals" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_principals_user_id_unique" ON "agent_principals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_principals_org_source_unique" ON "agent_principals" USING btree ("owner_source_kind","owner_source_ref") WHERE "agent_principals"."kind" = 'org';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_roles_live_unique" ON "agent_roles" USING btree ("principal_user_id","scope") WHERE "agent_roles"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_roles_link_hash_unique" ON "agent_roles" USING btree ("link_hash");--> statement-breakpoint
CREATE INDEX "agent_roles_principal_idx" ON "agent_roles" USING btree ("principal_user_id");--> statement-breakpoint
CREATE POLICY "agent_principals_read" ON "agent_principals" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "agent_roles_account_self_read" ON "agent_roles" AS PERMISSIVE FOR SELECT TO public USING ("agent_roles"."resource" = 'account' AND "agent_roles"."principal_user_id" = current_setting('app.current_user_id', true));
--> statement-breakpoint
-- agent_authority: the SQL TAIL for `agent_principals` and `agent_roles`, plus the seed of the node's two internal principals (node-template 0036 + 0037 + 0038).
-- The table part is NOT here: `defineAgentAuthoritySchema` (`@cogni-dao/agent-grants/schema`) owns it, and the node's own `db:generate` writes it, with the
-- account and org columns, their CHECKs and the two select policies. Append this file after that generated SQL. See README.md; never copy a snapshot.
-- FORCE RLS and the seed are outside Drizzle's DDL scope.
-- agent_roles has NO policy: ENABLE + FORCE = deny-all for the app role. Only a connection that bypasses row-level security reads or writes it
-- (the guard, the role routes). agent_principals is readable by all roles, writable only by that connection.
ALTER TABLE "agent_principals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Seed (idempotent): each internal principal is a `users` row with NO wallet and NO credential, plus an `agent_principals` row of kind 'internal'.
-- Ids and slugs match `INTERNAL_AGENT_PRINCIPALS` in `@cogni-dao/agent-grants`. No role rows are seeded: a node-admin turns each role On.
-- `users` has FORCE RLS (self_isolation): set the RLS context to each principal before its insert (transaction-local).
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-0000000a0001', true);--> statement-breakpoint
INSERT INTO "users" ("id", "name", "wallet_address") VALUES ('00000000-0000-4000-a000-0000000a0001', 'node-ai', NULL) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-0000000a0002', true);--> statement-breakpoint
INSERT INTO "users" ("id", "name", "wallet_address") VALUES ('00000000-0000-4000-a000-0000000a0002', 'prioritizer', NULL) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- agent_principals is FORCE RLS with a select-only policy, so even its owner cannot INSERT: lift FORCE for the seed only, inside the migration transaction.
ALTER TABLE "agent_principals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "agent_principals" ("kind", "slug", "user_id") VALUES ('internal', 'node-ai', '00000000-0000-4000-a000-0000000a0001') ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "agent_principals" ("kind", "slug", "user_id") VALUES ('internal', 'prioritizer', '00000000-0000-4000-a000-0000000a0002') ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "agent_principals" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- agent_account_grants: the SQL TAIL for account-resource grants on `agent_roles` (`authorizeAccount`, `approveAccountAsk`). node-template keeps it as 0041 + 0042.
-- The column, CHECK, index and select-policy part is NOT here: `defineAgentAuthoritySchema` owns it (`resource`, `account_id`, `expires_at`, `link_*`, the five CHECKs,
-- the unique `link_hash` index and `agent_roles_account_self_read`), and the node's own `db:generate` writes it. Append this file after that generated SQL.
-- DURABLE: an account row has no end date (it lasts until Off, like a node row); `expires_at` stays nullable and a row that carries an end keeps the expired state.
-- Keep `agent_roles_live_unique` (principal, scope) and the old ON CONFLICT targets: a pod on the previous release keeps working. The contract migration (task.5484) replaces it.
-- Functions and grants are outside Drizzle's DDL scope.
-- The one select policy above shows an app-role connection only the account rows that name it as the principal; the policy alone grants nothing, so the
-- table privilege is stated too. CURRENT_USER is the app role BY CONSTRUCTION: scripts/db/migrate.mjs connects with DATABASE_URL, the very URL the app's
-- RLS-subject client uses; the service role (DATABASE_SERVICE_URL) never migrates. Keep that true in a fork, or grant to the app role by name.
-- agent_roles stays ENABLE + FORCE RLS; there is no write policy.
GRANT SELECT ON "agent_roles" TO CURRENT_USER;--> statement-breakpoint
-- The ONE live predicate for an account grant, in SQL. SECURITY INVOKER (it sees only what the agent_roles policy lets the caller see).
-- `hasLiveAccountGrant` in the package uses the same test, so the app check and row-level security cannot disagree.
CREATE OR REPLACE FUNCTION agent_has_scope(p_account_id text, p_scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_roles r
    WHERE r.resource = 'account'
      AND r.principal_user_id = current_setting('app.current_user_id', true)
      AND r.scope = p_scope
      AND r.account_id = p_account_id
      AND r.approved_by IS NOT NULL
      AND r.revoked_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at > now())
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_has_scope(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_has_scope(text, text) TO CURRENT_USER;

-- Delegated reads (select only) are the node's own: add one policy for every table of the node that holds an account's data and may be read with `account:read`,
-- after this file. Permissive policies OR together, so the owner policies stay as they are. node-template's two, as the shape to copy:
--   CREATE POLICY "agent_delegated_read" ON "billing_accounts" AS PERMISSIVE FOR SELECT TO public USING (agent_has_scope("id", 'account:read'));
--   CREATE POLICY "agent_delegated_read" ON "credit_ledger" AS PERMISSIVE FOR SELECT TO public USING (agent_has_scope("billing_account_id", 'account:read'));

--> statement-breakpoint
-- agent_credentials: the SQL TAIL for the revocable agent keys (`@cogni-dao/agent-grants/credentials`). The table part is NOT here: `defineAgentAuthoritySchema`
-- owns it and the node's own `db:generate` writes it. Append this file after that generated SQL (and after `agent_authority.sql`: the trigger reads `agent_principals`).
-- node-template keeps it as 0039 + 0040 (`agent_credentials` rows belong only to a user with an `external` principal row).
-- FORCE RLS, a function and a trigger are outside Drizzle's DDL scope.
-- agent_credentials has NO policy: ENABLE + FORCE = deny-all for the app role. Only the BYPASSRLS service role reads or writes it.
ALTER TABLE "agent_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- STATE_IS_DERIVED: the one derivation of a credential's state from its timestamps, against the DATABASE clock. Never stored.
CREATE OR REPLACE FUNCTION agent_credential_state(c agent_credentials)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN c.revoked_at IS NOT NULL THEN 'revoked'
    WHEN c.confirmed_at IS NULL THEN CASE WHEN c.pending_expires_at > now() THEN 'pending' ELSE 'pending_expired' END
    WHEN c.expires_at > now() THEN 'active'
    WHEN c.renew_until > now() THEN 'renew_only'
    ELSE 'expired'
  END
$$;--> statement-breakpoint
-- CREDENTIALS_ONLY_ON_AGENT_PRINCIPALS: a credential may belong only to a user with an EXTERNAL agent_principals row. An internal
-- principal (this node's AI) never holds a key, and a plain user has no agent row until `upgrade` writes one.
CREATE OR REPLACE FUNCTION agent_credentials_require_external_principal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_principals ap WHERE ap.user_id = NEW.user_id AND ap.kind = 'external') THEN
    RAISE EXCEPTION 'agent credential for % requires an external agent principal', NEW.user_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agent_credentials_external_principal_only';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "agent_credentials_external_principal_only"
  BEFORE INSERT OR UPDATE OF user_id ON "agent_credentials"
  FOR EACH ROW EXECUTE FUNCTION agent_credentials_require_external_principal();

--> statement-breakpoint
ALTER TABLE "work_item_leases" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Beacon owns these existing payout tables. Internal agent identities must never become payees.
CREATE FUNCTION agent_wallet_is_not_a_payee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM agent_principals ap JOIN users u ON u.id = ap.user_id
    WHERE lower(u.wallet_address) = lower(NEW.account_lower)
      OR EXISTS (SELECT 1 FROM user_bindings b
        WHERE b.user_id = ap.user_id AND b.provider = 'wallet'
          AND lower(b.external_id) = lower(NEW.account_lower))
  ) THEN
    RAISE EXCEPTION 'Agent-owned wallet cannot be a payee'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agent_wallet_is_not_a_payee';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER epoch_distribution_leaves_agent_wallet_is_not_a_payee
BEFORE INSERT ON epoch_distribution_leaves
FOR EACH ROW EXECUTE FUNCTION agent_wallet_is_not_a_payee();
--> statement-breakpoint
CREATE TRIGGER distribution_settlement_leaves_agent_wallet_is_not_a_payee
BEFORE INSERT ON distribution_settlement_leaves
FOR EACH ROW EXECUTE FUNCTION agent_wallet_is_not_a_payee();
