<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
<!-- SPDX-FileCopyrightText: 2025 Cogni-DAO -->

# Connect X (Twitter) — node operator setup

One-time setup so **every tenant** can link their own X account. Architecture:
`docs/spec/platform-connections.md`.

## Mental model

- You register **ONE** X app for the whole node (not per-tenant). Its `client_id` +
  `client_secret` become `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET`.
- Each tenant authorizes against that one app and grants access to *their own* account;
  we store each tenant's user-context token encrypted per-tenant in `connections`.
- The node posts/reads **as the tenant's account**. There is no app-level bearer token —
  an app-only X token cannot `POST /2/tweets`.

## 1. Create the X app — the callback is the part that bites

X Developer Portal → your Project → **+ Add App** (or use an existing one) →
**User authentication settings → Set up / Edit**. A new or cloned app has **no OAuth
configured** (and may ship junk placeholder callbacks like `integromat.com/...` from a
Make/Zapier template). **You must set all of this yourself:**

| Field | Value |
|---|---|
| **App permissions** | **Read and write** (needed to post; don't add Direct Messages) |
| **Type of App** | **Web App, Automated App or Bot** (confidential client → issues a Client Secret) |
| **Callback URI / Redirect URL** | **delete any existing/placeholder URLs**, then add the **exact** URL for the env you're testing (see below) |
| **Website URL** | the node URL (e.g. `https://beacon-test.cognidao.org`) |

**Callback URL — must match character-for-character (scheme + host + path, no trailing slash):**

- candidate-a (testing): `https://beacon-test.cognidao.org/api/v1/connections/x/callback`
- production: `https://beacon.cognidao.org/api/v1/connections/x/callback`

> ⚠️ If the registered callback doesn't exactly match what the node sends, X aborts on its
> **own** authorize page with *"Something went wrong — You weren't able to give access to the
> App"* — **before** it ever returns to the node. 99% of first-time failures are this field.

Save → **Keys and tokens → OAuth 2.0 Client ID and Client Secret** → copy both.

## 2. Set the secrets

Only two secrets are node-owned: **`X_OAUTH_CLIENT_ID`** and **`X_OAUTH_CLIENT_SECRET`**.
`CONNECTIONS_ENCRYPTION_KEY` is **substrate-minted per env — do not set it** (see `bug.5039`).

The value-write path depends on the env, because the node is registered against production:

- **production:** self-serve via the operator — granted `secrets_manager`, `POST
  https://cognidao.org/api/v1/nodes/<node-id>/secrets {key,value,op:"set"}` with your API key
  (`docs/guides/add-secret.md` §3).
- **candidate-a / preview:** the self-serve writer can't reach these for a prod-registered node,
  so use the operator-admin CLI against that env's OpenBao (needs the env kubeconfig):

  ```bash
  export KUBECONFIG=<cogni-template>/.local/candidate-a-kubeconfig.yaml
  kubectl -n openbao port-forward svc/openbao 8200:8200 &
  export BAO_ADDR=http://127.0.0.1:8200
  export BAO_TOKEN=$(bao write -field=token auth/kubernetes/login \
    role=candidate-a-writer jwt=$(kubectl create token openbao-operator -n default))
  printf '%s' "$CLIENT_ID"     | pnpm secrets:set candidate-a beacon X_OAUTH_CLIENT_ID
  printf '%s' "$CLIENT_SECRET" | pnpm secrets:set candidate-a beacon X_OAUTH_CLIENT_SECRET
  ```

  `beacon-env-secrets` extracts the whole `cogni/<env>/beacon` path, so new keys flow in with
  no operator-side change; Reloader rolls the pod. (`docs/guides/secrets-add-new.md` §3–8.)

## 3. Verify

1. Deploy/flight (the migrate initContainer applies the connections migration adding the `x` provider).
2. Sign in → **Profile → Social Accounts → X → Connect**.
3. You're redirected to X, approve, and land on `/profile?connected=x` showing your `@handle`.

## Troubleshooting

- **X's own page: *"Something went wrong — You weren't able to give access to the App"*** →
  the X app's **Callback URI doesn't match** the node's (wrong/placeholder URL, trailing slash,
  http vs https, or wrong env). Fix the callback in §1. This is the most common failure.
- **Back on the node with `?error=connect_failed`** → state cookie expired (>5 min) or the
  token exchange failed (wrong Client Secret, or app permissions not "Read and write").
- **`Provider not available: x`** → `X_OAUTH_CLIENT_ID`/`SECRET` not set in this env.
- **`Server configuration error` (500) on Connect** → `CONNECTIONS_ENCRYPTION_KEY` missing in
  the env (substrate should mint it; check it's present in the pod).
