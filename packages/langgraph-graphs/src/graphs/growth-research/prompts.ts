// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-research/prompts`
 * Purpose: System prompt for the growth-research workflow — the RESEARCH activity
 *   of the beacon growth loop. One pass: given a campaign's strategy (voice/core
 *   topic/ICP/objective) plus recalled generic Dolt playbook, produce a handful of
 *   structured tenant `findings` (insight / pain_point / angle).
 * Scope: Pure string constants. Does NOT implement logic or import from src/.
 * Invariants:
 *   - PACKAGES_NO_SRC_IMPORTS: this package cannot import from src/
 *   - GRAPH_OWNS_MESSAGES: the workflow defines its own prompts
 *   - V0_FINDING_KINDS_ONLY: the v0 pass emits insight/pain_point/angle (exemplar/
 *     reference are collected by a deferred web-search pass — see schema CHECK).
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §2.2/§3/§7
 * @public
 */

/**
 * RESEARCH: synthesize a small set of grounded findings for ONE campaign.
 * The model is handed the campaign strategy + recalled generic playbook and must
 * return ONLY a JSON array of `{kind, content}` — kinds restricted to the three
 * v0 synthesized kinds (exemplar/reference need real sources, deferred in v0).
 */
export const RESEARCH_PROMPT = `
You are a growth-marketing researcher for the beacon node.
You are given ONE campaign's strategy (brand voice, core topic, ideal-customer
profile, objective) and, optionally, recalled generic playbook notes that worked
on OTHER campaigns. Ground your research in the strategy; apply the playbook,
customized — never copy it verbatim.

Produce a SMALL set of sharp, campaign-specific findings (aim for 5-7 total):
- "insight"     — a non-obvious truth about the audience or topic that should shape content.
- "pain_point"  — a concrete frustration/need the ideal customer feels.
- "angle"       — a content hook/framing that would land with this audience.

Rules:
- Each finding is one tight sentence. No preamble, no numbering, no markdown.
- Cover all three kinds; skew toward angles last so generation has hooks.
- Do NOT invent URLs, handles, statistics, or named competitors.

Return ONLY a JSON array, e.g.:
[{"kind":"insight","content":"..."},{"kind":"pain_point","content":"..."},{"kind":"angle","content":"..."}]
` as const;

/**
 * The three finding kinds the v0 research pass synthesizes. `exemplar`/`reference`
 * are reserved in the schema CHECK for the deferred web-search collection pass.
 */
export const RESEARCH_FINDING_KINDS = ["insight", "pain_point", "angle"] as const;
export type ResearchFindingKind = (typeof RESEARCH_FINDING_KINDS)[number];
