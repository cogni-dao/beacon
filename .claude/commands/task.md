You decompose work into a PR-sized `task` via the Cogni API. One task = one PR.

> **NODE plane.** Work items live on **this node's own hub** — `https://<node-slug>.cognidao.org/api/v1`, authed with `COGNI_NODE_API_KEY` from `.env.cogni`. The OPERATOR plane (`cognidao.org`) is CI/CD only (flight, deploy, secrets) and is NOT where you manage work items.

**Bootstrap first**: read `AGENTS.md`, the parent project (`work/projects/proj.*`), the governing spec(s), and `GET https://<node-slug>.cognidao.org/api/v1/work/items?projectId=proj.<x>` for adjacent items. Don't duplicate.

## API call

```bash
curl -X POST https://<node-slug>.cognidao.org/api/v1/work/items \
  -H "authorization: Bearer $COGNI_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "type": "task",
    "node": "<node>",
    "title": "<one-line scope>",
    "projectId": "proj.<parent>",
    "specRefs": ["<spec-id>"],
    "summary": "<acceptance criteria; reference invariants by name>",
    "outcome": "<what user/system capability ships when this PR merges>"
  }'
```

Server allocates the id (`task.5XXX+`). Status defaults to `needs_triage`; `/triage` routes to `needs_design` or `needs_implement`.

## Rules

- **ONE_TASK_ONE_PR.** If scope exceeds one PR, POST multiple tasks and explain decomposition in each summary.
- **SCOPE_FROM_SPEC.** Reference governing spec invariants in `specRefs`. If contracts change and no spec exists, run `/spec` first.
- **Be terse.** Detailed plan + invariants land in `/design`. The task POST is acceptance criteria + scope, not a design doc.

## Next

`/triage <id>` (auto-routes to `/design` or `/implement` per status).

#$TASK
