---
work_item_id: platform-connections-readcost
status: open
branch: main
last_commit: 82cb2d0ce3b57ab189e67d0268e40e28ba1e33db
---

# Platform Connections — read-cost discipline + posting loop

## Mission

Pickup: the per-tenant social-connections spine is built and proven on candidate-a — tenants link their own X account via OAuth, credentials are AEAD-encrypted per-tenant in `connections`, and the profile shows a live X insights card sourced through the broker. You own the next increment: **make per-tenant platform reads cost-disciplined** (stop paying X on every passive page render), then extend the same broker-resolved path to **posting** (the X write path still uses the app bearer; a sandbox-only post route already proves the per-tenant connect→resolve→post pipeline). Real `moltbook` + `sandbox` connectors now exist on main.

## Goal

End state: a tenant links X once; the profile insights card renders from cached data with **zero platform calls on passive views**; a known-bad connection (no credits / rate-limited) short-circuits with a clear "needs credits" state instead of silently re-calling X; and posting runs through the same per-tenant broker token (no app-level `X_API_BEARER_TOKEN` in the write path).

E2E validation (candidate-a):
- Flight target main SHA → candidate-a; `GET https://beacon-test.cognidao.org/version` `buildSha` must equal the flighted SHA (proven pattern: `ec748a5` matched on 2026-06-19).
- Link X on Profile → Social Accounts → X → Connect (needs an X app **in a Project** with a **positive pay-per-use credit balance** — without credits the read returns **HTTP 402**, which is the current blocker, not a code bug).
- With credits: the insights card renders followers + recent-post metrics. Reload the page N times → pod logs show **far fewer than N** outbound X calls (cache working). Pull logs via `KUBECONFIG=<cogni-template>/.local/candidate-a-kubeconfig.yaml kubectl -n cogni-candidate-a logs <beacon-node-app pod>` and grep `ConnectionsMetricsRoute`.

## Start By Reading

- `docs/spec/platform-connections.md` — the master design. New section **"Read-cost governance (concern logged — keep it lean)"** is your brief; **"Cost basis … X (Twitter) — pay-per-use"** is the economics.
- `app/src/app/api/v1/connections/[provider]/metrics/route.ts` — the read route (`ConnectionsMetricsRoute`); where 402 surfaces.
- `app/src/adapters/server/social/x.adapter.ts` — `XSocialAdapter.readAccountMetrics` (`GET /2/users/me` + own timeline `public_metrics`); the paid call.
- `app/src/app/(app)/profile/view.tsx` — the insights card (~line 851) + the `useEffect [xConnected]` that fetches **on every mount** (the spam source).
- `app/src/adapters/server/connections/drizzle-broker.adapter.ts` — `ConnectionBrokerPort.resolveActive(billingAccountId, provider, scope)`; per-connection mutex precedent for single-flight.
- `app/src/ports/platform-connector.port.ts` — control-plane port; where a declarative `costClass`/`ttlSeconds` would live *if* approved (deferred — capture, don't build).
- `app/src/adapters/server/connections/{moltbook,sandbox}.connector.ts` + `registry.ts` — the live connector set (x, moltbook, sandbox); pattern for adding providers.
- `app/src/app/api/v1/connections/[provider]/post/route.ts` — **SANDBOX-ONLY** posting route proving connect→broker-resolve→post with no external send; the substrate the X write path should be re-sourced onto (Target #4).

## Current State

- **Shipped to main:** #16 (per-tenant X linking + one-credential-model purge of app-level X bearer in the connect path), #40 (per-tenant X *read* — broker-resolved insights card + `GET /connections/[provider]/metrics`), #41 (`decodeAeadKey` on the BYO-AI credential routes — closes bug.5039 on those paths; X callback already had it). All merged.
- **Deploy proof:** candidate-a flighted to `ec748a5`, `/version` buildSha matched. X link stored end-to-end (`Platform connection stored, @DerekGranito`).
- **Live blocker (not code):** metrics read → **HTTP 402 Payment Required**. The candidate X app (personal `derekg` test app) has no pay-per-use credit balance. Link/store works; only the paid read is gated. Observed exactly **2** read attempts across the pod's life (once per profile mount) — not a loop, but unbounded by design.
- **Branch note:** `codex/aead-key-decode-all-paths` (#41) is squash-merged; **start new work from `main`**.
- **Upstream:** the `decodeAeadKey` fix + the social/platform-connector extension are general-purpose and belong in node-template once hardened (bug.5039 already filed there). Operator dev owns the node-template/operator-monorepo PR; do **not** PR the operator repo from this node.
- **Moltbook / Sandbox:** main now ships real `moltbook.connector.ts` (free API-key/Bearer, rate-limited per spec) and `sandbox.connector.ts` + a sandbox-only post route. The fake-only-Moltbook framing from earlier is obsolete — verify the Profile "Connect Moltbook" button is wired before assuming a gap.

## Design / Implementation Target

Keep it lean — Derek explicitly said **do not over-engineer this yet**. Do the cheap, high-leverage items first; defer the rest.

1. **No platform call on passive render.** The insights card must serve from a stored snapshot; only refetch on an explicit user action or a scheduled job. This single change removes the per-view spend. Must not regress the existing card layout or the `connected` status flow.
2. **Circuit-break known-bad connections.** On 402/403/429 from a read, mark the connection (`needs_billing` / `rate_limited`) and stop calling until cooldown or operator re-arm; surface a "X app needs credits" state instead of a blank card. Must not log tokens; keep error grain coarse.
3. **Persist paid reads** (e.g. `connection_read_cache` keyed by connection + resource + `fetched_at`) **only if/when** reads run on a cadence — not before. RLS-scope any new table by `billing_account_id` (see `schema-update` skill, RLS-first gate).
4. **(Larger, separate)** Re-source the **posting** path (`POST /2/tweets`) onto `broker.resolveActive` per-tenant tokens and remove the app-level `X_API_BEARER_TOKEN` from the write path — coordinated with the growth `posts` owner (the metrics-ingest job + broadcast tool still use the app bearer). This is the deferred "SA4 ripple" noted in the spec; do not bundle with items 1–2.
5. **Boundaries that must hold:** adapters stay dumb stateless fetchers with a documented $ cost; tenant scope via RLS + AAD binding; no new app-level bearer tokens; the registry stays the only place a provider is added.

## Next Actions / Risks

- [ ] Item 1 (no-fetch-on-render) — smallest PR, biggest cost win. Start here.
- [ ] Item 2 (402/429 circuit-break + UX state).
- [ ] File the cost-guardrail work item via Cogni API once the substrate is reachable (it was **down** this session — `https://beacon.cognidao.org/api/v1/cognition` unreachable; register a NODE agent first).
- [ ] Smoke the `moltbook`/`sandbox` connectors + sandbox post route on candidate-a (they landed since this work started).
- **Risk — X billing gate:** you cannot prove the rendered card on candidate-a until the X app has a credit balance. That is a **human/billing decision** (add credits in the X dev console), not something the next agent can self-resolve. Validate the *cache/circuit-break* logic via logs + a mocked/funded path; don't block the whole task on X funding.
- **Gotcha — captured Playwright storageState ≠ live user.** `.local-auth/candidate-a-beacon.storageState.json` is wallet `fc8a6058…`; the linked account was under a different wallet, so `x/status` reads `connected:false` for that session. Re-capture or test under the linking user.
- **Gotcha — substrate/cognition API was unreachable** all session; work-item creation and knowledge contribution are blocked until a NODE agent is registered (`COGNI_NODE_API_KEY` in `.env.cogni`).
