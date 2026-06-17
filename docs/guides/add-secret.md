---
id: guide.add-secret
type: guide
title: Add a Node Secret
status: draft
trust: draft
summary: How a node's secrets get set — who does what, and why no human edits files or touches the cluster.
read_when: Adding a credential or API key this node's app consumes (e.g. X OAuth app creds).
owner: cogni-dev
created: 2026-06-05
verified: null
tags: [secrets, nodes]
---

# Add a Node Secret

Three roles. **Humans never edit files and never touch the cluster.** A human, at
most, pastes a secret *value* once — securely, through the operator.

| Who | Does | How |
| --- | --- | --- |
| **Node-dev (agent)** | declares the secret's *shape* | one PR editing `.cogni/secrets-catalog.yaml` |
| **Node owner (human)** | approves access + provides a *value* | one click + one secure paste, through the operator |
| **Operator (CI/CD)** | writes the value to OpenBao with its **own** identity, syncs to the pod | automatic |

No `kubectl`, no OpenBao token, no `pnpm secrets:set`, no editing k8s Secrets, no
secret values in files / PRs / chat, and **never anyone else's credentials.**

## 1. Declare the shape — node-dev, one PR

Edit `.cogni/secrets-catalog.yaml`. Declare *shape only*, never a value:

```yaml
secrets:
  - name: CONNECTIONS_ENCRYPTION_KEY
    tier: A2
    appliesTo: web
    source: agent              # auto-generated — nobody ever types it
    required: true
    generate: { kind: hex, bytes: 32 }
  - name: X_OAUTH_CLIENT_ID
    tier: A2
    appliesTo: web
    source: human              # a human provides the value (step 3)
    required: false            # false → deploy succeeds before the value exists
  - name: X_OAUTH_CLIENT_SECRET
    tier: A2
    appliesTo: web
    source: human
    required: false
```

Consume them through the typed env boundary (`process.env.X_OAUTH_CLIENT_ID`, etc.).
`source: agent` keys are generated for you — there is **no** value step for them.

## 2. Get permission — once

Your registered agent requests the `secrets_manager` role on this node:

```bash
curl -fsS -X POST "https://<operator-host>/api/v1/nodes/<node-id>/access-requests" \
  -H "Authorization: Bearer $YOUR_OPERATOR_API_KEY" \
  -H "content-type: application/json" -d '{"role":"secrets_manager"}'
```

The node owner approves it once on the node page. `$YOUR_OPERATOR_API_KEY` is *your
own* operator-registered key — never a shared or admin one.

## 3. Set a `source: human` value — secure paste, node owner

The owner provides the value through the operator. This is the **only** time a human
touches a secret, and it never lands in a file, shell history, or chat:

```bash
read -rsp "X_OAUTH_CLIENT_SECRET: " V; echo
printf '%s' "$V" | jq -Rs '{key:"X_OAUTH_CLIENT_SECRET",value:.,op:"set"}' |
  curl -fsS -X POST "https://<operator-host>/api/v1/nodes/<node-id>/secrets" \
    -H "Authorization: Bearer $YOUR_OPERATOR_API_KEY" \
    -H "content-type: application/json" --data-binary @-
unset V
```

The operator checks your `can_manage_secrets` grant, then writes
`cogni/<env>/<node>/X_OAUTH_CLIENT_SECRET` **with its own in-cluster identity** — your
key only proves you're allowed; it carries no cluster custody. ESO + Reloader roll the
value into the pod. Confirm via the `version` in the response — no `kubectl`.

> Get `503 secrets_plane_config_missing`? The operator hasn't enabled the self-serve
> writer on this env yet (a one-time per-env operator step). Ping the operator team;
> do **not** fall back to cluster tools.

## What the operator owns (not you)

ExternalSecret wiring, pod `envFrom`, DB/DNS provisioning, rollout, and the OpenBao
writer identity. A node PR never edits those.
