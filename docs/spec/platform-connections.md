# Design: Platform Connections (Tenant ↔ Social Account Linking)

> Status: **proposal** · Author: agent research spike · Extends: `docs/spec/tenant-connections.md`
> Goal: a standardized, Pareto-optimal way for a tenant (user v0) to link X / Instagram / TikTok / … so the node can analyze → generate → post → measure → repeat.

## TL;DR

We already own 80% of this. The `connections` subsystem (encrypted, tenant-scoped credential store + broker with token refresh) is the correct primitive. The model backend already proves the dependency-inversion shape: a **provider registry** (`ModelProviderPort`) where each provider declares `requiresConnection` and turns a `ResolvedConnection` into a usable client (`createLlmService`).

**The keystone move is to extend that exact shape to a second axis — platforms — via a `PlatformConnectorPort` registry.** Every messy per-platform reality (PKCE, app-review gates, draft-only posting, token quirks) is isolated inside one swappable connector. The OAuth routes, the broker, the posting tools, and the scheduler all become thin generic shells that delegate to the registry.

This is *not* a new subsystem. It is one new port + one schema delta + a generic 3-route OAuth shell, reusing four mechanisms that already exist and are tested.

## What already exists (reuse, do not rebuild)

| Mechanism | Where | Reuse for social |
|---|---|---|
| Encrypted credential store, AAD-bound, soft-delete, RLS tenant scope | `packages/db-schema/src/connections.ts` | Store X/IG/TikTok tokens — same table |
| Credential broker: resolve + expiry check + **injectable per-provider `refreshFns`** + per-connection mutex | `app/src/adapters/server/connections/drizzle-broker.adapter.ts` | Token refresh for every platform, for free |
| AEAD helpers (AES-256-GCM, AAD = `{billing_account_id, connection_id, provider}`) | `packages/node-shared/src/crypto/aead.ts` | Encrypt platform tokens identically |
| Write pattern: resolve billing acct → revoke prior active → `aeadEncrypt` → insert, in `withTenantScope` | `app/src/app/api/v1/auth/openai-*/…` | Template for connect/callback |
| Fail-closed OAuth link-intent (DB `linkTransactions` + signed cookie + atomic consume) | `packages/db-schema/src/identity.ts`, `app/src/auth.ts` | Template for OAuth state/PKCE |
| Provider registry pattern (`requiresConnection`, `createLlmService(connection)`) | `app/src/ports/model-provider.port.ts` | **The shape to mirror** |
| Temporal **Schedules** → `GraphRunWorkflow` → HTTP activity, tenant via `ExecutionGrant` | `packages/scheduler-core`, `docs/spec/temporal-patterns.md` | The "…repeat" loop |
| LangGraph catalog + tool registry (`CORE_TOOL_BUNDLE`) | `packages/langgraph-graphs`, `packages/ai-tools` | The agent that analyzes/generates/posts |

### Don't confuse the two identity axes

- **Identity bindings** (`user_bindings`, `identity_events`, providers: wallet/discord/github/google) answer *"who is this tenant?"* — login/auth. **Not** the social primitive.
- **Connections** answer *"what external accounts may the node act on behalf of this tenant?"* — authorization to act. **This is social linking.** Keep them separate; do not bolt X/IG/TikTok onto `user_bindings`.

## The four gaps (the 20% to build)

1. **Schema can't hold multiple accounts per platform.** Unique index is `(billing_account_id, provider) WHERE revoked_at IS NULL` — one X handle per tenant. Real users link two X accounts, an IG + its FB page, etc. Also, the external handle/avatar is buried inside the encrypted blob, so the UI can't render "you linked @acme" without decrypting.
2. **The broker is read-only and model-only.** No tool-side path resolves a tenant connection; only the LLM model backend does. Posting tools need a sanctioned resolution path.
3. **No platform connectors.** `bluesky` is in the enum with zero code. No X/IG/TikTok. No generic OAuth connect/callback/disconnect routes (each LLM provider has a bespoke route).
4. **Data plane exists but is app-account-only.** PR #9 shipped `SocialXCapability` + a `content` graph + a metrics-ingest job — but they post from a single app-level `X_API_BEARER_TOKEN`, not from a tenant's linked account. The gap is the *per-tenant credential path* (resolve a tenant's `connections` row via the broker), plus wiring a per-tenant Schedule. See the convergence note under the data plane below.

## Design

### 1. Two ports, split by plane (control vs data)

The control plane (OAuth) and data plane (publish/metrics) have **different consumers, runtimes, and lifecycles** — bundling them produces a fat interface and a boundary violation (tools in `packages/ai-tools` would transitively import app-runtime OAuth code). Split:

**Control plane — `PlatformConnectorPort`** (app-runtime: needs secrets, HTTP, redirect URIs). Lives in `app/src/ports/platform-connector.port.ts`, alongside the precedent `ConnectionBrokerPort` and `ModelProviderPort`.

```ts
export interface PlatformConnectorPort {
  readonly provider: string;                 // 'x' | 'instagram' | 'tiktok'
  readonly credentialType: CredentialType;   // 'oauth2'

  /** Honest declaration of platform app-review reality (see "Platform truth"). */
  readonly gating: {
    postScope: 'public' | 'self_only' | 'unavailable'; // TikTok unaudited => 'self_only'
    requiresExternalReview: boolean;                    // IG/TikTok => true
    accountKind?: 'business_required';                  // Instagram
  };

  /** Build the provider authorize URL + the PKCE/state to carry across the redirect. */
  buildAuthorizeUrl(p: { redirectUri: string }): { url: string; state: string; codeVerifier: string };
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }):
    Promise<{ blob: CredentialBlob; scopes: string[]; expiresAt: Date | null }>;
  /** Non-secret account identity for display columns. */
  fetchAccount(accessToken: string): Promise<{ externalAccountId: string; handle: string; displayLabel: string }>;
  refresh(refreshToken: string): Promise<RefreshResult>;   // wired into broker.refreshFns[provider]
}
```

**Data plane — `PlatformClient`** (used by tools; package-resident, e.g. `packages/ai-tools` or a `platform-core` package). Built lazily from a `ResolvedConnection` the broker hands back. *Out of scope for the connect prototype; specified here for completeness.*

```ts
export interface PlatformClient {
  publish(c: PublishInput): Promise<{ externalPostId: string; permalink?: string }>;
  fetchMetrics(p: { externalPostIds: string[] }): Promise<PostMetric[]>;
}
```

> **ONE credential model — per-tenant OAuth tokens in `connections`. No app-level bearer token.**
>
> The data plane already exists as #14's `SocialXCapability` (`packages/ai-tools/src/capabilities/social-x.ts` + `app/src/adapters/server/social/x.adapter.ts`). Its `postContent`/`readMetrics` **shape is good and is kept** — but its credential source (`X_API_BEARER_TOKEN`, an app-only token) is **wrong and non-functional**: `new TwitterApi(bearerToken)` is an app-only client, and `POST /2/tweets` (`x.adapter.ts:76`) requires **user-context** auth, so it returns **403 in production**. It only passes today because the growth-loop tests use `FakeXSocialAdapter`.
>
> There is therefore exactly one viable model, and it is this spec's: each tenant links their own account via OAuth (user-context token, encrypted per-tenant in `connections`), and the node posts/reads **as that tenant** using the broker-resolved token.
>
> **Convergence (required, not optional):**
> - This PR adds the **control plane** (`PlatformConnectorPort` + OAuth connect flow) — the only way real X tokens enter the system.
> - `SocialXCapability` is re-sourced from `ConnectionBrokerPort`: given a tenant (`billingAccountId`/`createdByUserId`) + provider, resolve that tenant's connection and use its user-context access token.
> - **Purge `X_API_BEARER_TOKEN`** and the app-only `TwitterApi(bearerToken)` construction. The "node's own broadcast account" becomes just another linked connection (owned by the operator/system tenant).
> - Do **not** introduce a second poster — `PlatformClient` above is the shape; fold it into `SocialXCapability`.
>
> ⚠️ This convergence edits #14's merged growth-loop code that #13 (campaigns CRUD) is stacked on — it must be coordinated with that work, not landed unilaterally.

Register connectors in a `PLATFORM_CONNECTORS` map exactly like `LANGGRAPH_CATALOG` / model providers. `refresh` is fed into the broker's existing `refreshFns` config → **token refresh is solved the day a connector is registered.** Everything platform-specific lives in one file per platform; the rest of the system never branches on provider name.

### 2. Schema delta (one migration)

```
ALTER TABLE connections
  -- non-secret display columns (so UI never decrypts)
  ADD COLUMN external_account_id text,      -- platform's stable user id
  ADD COLUMN external_handle    text,       -- @handle / username
  ADD COLUMN display_label      text,       -- "Acme on X"
  ADD COLUMN avatar_url         text,
  ADD COLUMN status             text NOT NULL DEFAULT 'active';
                                            -- active | needs_reauth | expired | review_pending

-- allow multiple accounts per platform per tenant — WITHOUT regressing
-- existing providers whose external_account_id is NULL. COALESCE collapses
-- NULL to '' so openai-* stays "one active per (account, provider)", while
-- social providers get one active per (account, provider, handle).
DROP INDEX connections_billing_account_provider_active_idx;
CREATE UNIQUE INDEX connections_billing_provider_account_active_idx
  ON connections (billing_account_id, provider, COALESCE(external_account_id, ''))
  WHERE revoked_at IS NULL;

-- extend CHECK enums: provider += 'x','instagram','tiktok'; credential_type already has 'oauth2'
```

> **Index regression guard:** a naïve `UNIQUE (…, external_account_id)` would let a tenant hold N active `openai-chatgpt` connections (Postgres treats NULLs as distinct). The `COALESCE(…, '')` expression is load-bearing.

`status` makes broken connections legible without decryption — the UI shows a re-auth banner; the scheduler skips `needs_reauth` accounts instead of failing a run. Follow `/schema-update` (mandatory before touching schema).

### 3. Generic OAuth shell (3 routes, all providers)

Replace bespoke per-provider routes with `/api/v1/connections/[provider]/{connect,callback,disconnect,status}`, driven by the registry:

- **connect** (`GET`) → auth'd session → **fail-fast 500 if `CONNECTIONS_ENCRYPTION_KEY` unset** (never proceed toward storing plaintext) → `connector.buildAuthorizeUrl()` → carry `{state, codeVerifier}` across the redirect in a **signed, HttpOnly, 5-min cookie** (the proven `link_intent` pattern at `app/src/app/api/auth/link/[provider]/route.ts:50-70`, signed via `next-auth/jwt` `encode`) → 302 to platform.
- **callback** (`GET`) → read + verify the signed cookie → **constant-time compare** returned `state` (fail-closed; reject expired/tampered/mismatch) → `connector.exchangeCode()` → `connector.fetchAccount()` → `aeadEncrypt(blob)` → revoke prior active for `(account, provider, externalAccountId)` → insert connection with display columns → 302 `/profile?connected=<provider>`.
- **disconnect** (`POST`) → soft-delete (`revoked_at`), best-effort platform token revocation.
- **status** (`GET`) → `{ connected, handle }` read from non-secret columns — **never decrypts**.

> Why a cookie, not `link_transactions`: that table's CHECK is `provider IN ('github','discord','google')` and it has no `state`/`code_verifier` columns. The signed cookie carries PKCE state across the redirect with no schema change and the same fail-closed guarantee.

### 4. Data plane: tools + graph + schedule

- **Broker for tools.** Add a tool-callable `PlatformClientPort` (thin: `getClient(connectionId, scope)` → `broker.resolve` → `connector.createClient`). Tools get tenant scope from the execution context (`billingAccountId` already flows via ALS / `ExecutionGrant`); they never see raw tokens (`TOKENS_NEVER_LOGGED`).
- **Two generic tools** in `CORE_TOOL_BUNDLE`: `social__publish` and `social__fetch_metrics` (effect: `state_change` / read). They take `{ connectionId, … }`, resolve via the connector — no per-platform tool.
- **One graph** `social-agent` (LangGraph catalog) implementing analyze → generate → (human-approve?) → publish → record. Metrics gathering is a second lighter graph/tool run.
- **The loop** = a Temporal **Schedule** per (tenant, platform) → `GraphRunWorkflow(graphId='social-agent')` with an `ExecutionGrant` scoped to `billingAccountId`. Idempotency `{scheduleId}:{scheduledFor}` already handled.

## Platform truth (this dominates rollout cost, not the code)

The abstraction is uniform; the per-platform *gates* are not. Design for graceful degradation via `connector.gating`:

- **X (Twitter):** OAuth2 + PKCE, `offline.access` for refresh (tokens rotate). Post = `POST /2/tweets`. Cleanest API, but **write access is paid** (Free tier ~negligible; Basic ≈ $200/mo). Cheapest to *build*, has a $ gate to *operate*.
- **Instagram:** No personal posting. Requires an IG **Business/Creator** account + linked Facebook Page, via Instagram Graph API. Publish is two-step (create media container → publish). Needs Meta **app review** for `instagram_content_publish`. Long-lived tokens (~60d, refreshable). Heaviest lift (`accountKind: 'business_required'`, `requiresExternalReview`).
- **TikTok:** Content Posting API, OAuth2. **Unaudited apps can only post `SELF_ONLY`/draft**; public direct-post needs audit. `postScope` starts `'self_only'` until approved.

Implication: ship **X first** (simplest auth, validates the whole pipeline end-to-end), keep IG/TikTok connectors behind `review_pending` status until external approval lands. The registry lets you do this without touching shared code.

## Pareto path forward (phased)

1. **P0 — Prove the spine with X.** Schema delta + `PlatformConnectorPort` + `XConnector` + generic OAuth shell + `PlatformClientPort` + `social__publish` tool. Manual graph run, no schedule. → a tenant links X and the node posts once. *This validates the entire architecture; everything after is "register another connector."*
2. **P1 — Close the loop.** `social__fetch_metrics`, `social-agent` graph (analyze→generate→post), per-tenant Temporal Schedule + `ExecutionGrant`. → autonomous cadence for X.
3. **P2 — Multi-account + UI.** Surface `external_handle`/`status` in the profile/connections UI; re-auth flow; link a 2nd handle.
4. **P3 — Breadth behind gates.** `TikTokConnector` (self_only → audit), `InstagramConnector` (business-account onboarding + Meta review). No shared-code change — just new registry entries.

## Why this is the top-0.1% choice

- **One new concept, maximal reuse.** Mirrors a dependency-inversion the codebase already trusts for model providers; reuses encrypted store, broker refresh, AEAD, fail-closed OAuth, Temporal schedules, LangGraph catalog.
- **Isolates the only genuinely hard part** (per-platform auth + review/tier gates) into a single swappable unit with an honest `gating` declaration, so the platform messiness never leaks into routes, tools, or the scheduler.
- **Security stays where it already is.** Tenant scope via RLS + AAD binding; tokens never logged; soft-delete revocation; fail-closed OAuth consume. No new trust boundary invented.
- **Scales by registration, not by branching.** Adding a platform = one connector file + one secrets-catalog entry; the generic shell already knows how to drive it.
```
