---
name: dolt-human-visuals
description: Use whenever authoring a Cogni knowledge entry whose primary consumer is a HUMAN reviewing it visually (design diagrams, status scorecards, roadmaps, PR review summaries, anything where a paragraph would lose to a picture). Routes the author toward `entryType: html` for human-facing visuals. Trigger when posting to /api/v1/knowledge/contributions and the content is for human review.
---

# dolt-human-visuals

This file is only the trigger. The knowledge hub is the authoritative, refinable contract.

Read this operator-owned entry, then follow it:
- `GET https://cognidao.org/api/v1/knowledge/knowledge-human-visuals`

Do not reconstruct or preserve a fallback copy in this repository.
