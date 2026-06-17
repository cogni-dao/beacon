<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
<!-- SPDX-FileCopyrightText: 2025 Cogni-DAO -->

# Connect X (Twitter) — node operator setup

This walks a **node operator** through the one-time setup that lets **every tenant**
link their own X account to this node. See `docs/spec/platform-connections.md` for the
architecture.

## Mental model (read this first)

- You register **ONE** X app for the whole node. It is **not** per-tenant.
- That one app has a single `client_id` + `client_secret` (→ `X_OAUTH_CLIENT_ID` /
  `X_OAUTH_CLIENT_SECRET`).
- **Each tenant authorizes against that one app** and grants access to *their own*
  X account. We store each tenant's **user-context token** encrypted in the
  `connections` table (per-tenant, AEAD-encrypted, RLS-isolated).
- One OAuth app → many per-user authorizations. This is standard OAuth; you do **not**
  create an app per tenant.

> The node posts/reads **as the tenant's linked account**, using that tenant's token.
> There is no shared "node bearer token" — X app-only bearer tokens **cannot post**
> (`POST /2/tweets` requires user context), so per-tenant OAuth is the only viable model.

## 1. Create the X app (once)

1. Go to the [X Developer Portal](https://developer.x.com) → your Project → **+ Add App**
   (or use an existing app).
2. Open **User authentication settings** → **Set up**:
   - **App permissions:** Read and write (needed to post).
   - **Type of App:** **Web App, Automated App or Bot** (confidential client — it has a secret).
   - **Callback URI / Redirect URL:** `<APP_BASE_URL>/api/v1/connections/x/callback`
     (e.g. `https://your-node.example.com/api/v1/connections/x/callback`). Must match exactly.
   - **Website URL:** your node's URL.
3. Save. Under **Keys and tokens → OAuth 2.0 Client ID and Client Secret**, copy both.

## 2. Set the secrets

The shapes are declared in `.cogni/secrets-catalog.yaml`; you set the **values** out-of-band
(never commit them). Per `docs/guides/add-secret.md` §3:

```bash
# ops path (per env + node slug):
pnpm secrets:set <env> <node-slug> CONNECTIONS_ENCRYPTION_KEY
pnpm secrets:set <env> <node-slug> X_OAUTH_CLIENT_ID
pnpm secrets:set <env> <node-slug> X_OAUTH_CLIENT_SECRET
# self-serve path (node owner): POST /api/v1/nodes/<id>/secrets
```

`CONNECTIONS_ENCRYPTION_KEY` must be 64 hex chars. Generate it with:

```bash
openssl rand -hex 32
```

If it is unset, the connect route fails fast with a 500 and stores nothing.

## 3. Verify

1. Deploy (the migrate initContainer applies migration `0033`, adding the `x` provider).
2. Sign in, open **Profile → Social Accounts → X → Connect**.
3. You are redirected to X, approve, and land back on `/profile?connected=x` showing your `@handle`.
4. The encrypted token is now in `connections`; the broker auto-refreshes it.

## Troubleshooting

- **Redirected back with `?error=connect_failed`:** callback URL mismatch, expired/tampered
  state cookie (>5 min), or token exchange failed. Check the app's callback URL matches
  `<APP_BASE_URL>/api/v1/connections/x/callback` exactly.
- **`Provider not available: x`:** `X_OAUTH_CLIENT_ID`/`SECRET` not set in this env.
- **Server configuration error (500) on Connect:** `CONNECTIONS_ENCRYPTION_KEY` not set.
