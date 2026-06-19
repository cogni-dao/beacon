// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-base/seeds/growth-playbook`
 * Purpose: v0 marketing-campaign playbook seeds for the beacon growth loop. Fills the
 *   three growth domains (beacon-brand-voice / beacon-campaigns / beacon-post-performance)
 *   with CONCISE, GENERIC atoms so RESEARCH/GENERATE recall returns compounding memory
 *   instead of nothing. Includes 2 choosable EXAMPLE CAMPAIGN PLAYBOOKS so the loop's
 *   "compare against existing playbooks, choose one" step has templates to choose from.
 * Scope: Seed data definitions only. Does not perform I/O — the provisioning path applies
 *   these the same way it applies `BASE_KNOWLEDGE_SEEDS`. Re-exported from the package index.
 * Invariants:
 *   - GENERIC_ONLY: every atom applies to any tenant; names NO real account/campaign/post.
 *   - RECALL_LIVES_IN_BRAND_VOICE: RESEARCH + GENERATE recall ONLY `beacon-brand-voice`
 *     (`searchKnowledge("beacon-brand-voice", q)`) and feed each hit as `"${title}: ${content}"`
 *     truncated at 500 chars — so anything that must reach generation today (incl. the
 *     example playbooks) is encoded in beacon-brand-voice with self-contained, short text.
 *   - HIGH_SIGNAL_NO_BLOAT: ~12-18 atoms + 2 example playbooks. Don't over-pollute.
 *   - Append-only catalogue; IDs are stable (`beacon-pb-*`).
 * Side-effects: none
 * Links: docs/research/_knowledge/dolt-playbook-seed.md (canonical component list),
 *         docs/research/marketing-platforms-landscape.md (evidence),
 *         packages/langgraph-graphs/src/graphs/growth-{research,generate}/workflow.ts (consumers)
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";

const DOMAIN_BRAND_VOICE = "beacon-brand-voice";
const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const DOMAIN_POST_PERFORMANCE = "beacon-post-performance";

/**
 * v0 marketing-campaign playbook seeds.
 *
 * Layout (by component → domain):
 *   - Funnel structure      → beacon-campaigns
 *   - Brand voice           → beacon-brand-voice  (recalled live)
 *   - Content/hook examples → beacon-brand-voice  (recalled live)
 *   - Cadence               → beacon-campaigns
 *   - Per-layer metric/rubric → beacon-post-performance
 *   - Example playbooks (×2) → beacon-brand-voice  (recalled live — choosable templates)
 */
export const GROWTH_PLAYBOOK_SEEDS: NewKnowledge[] = [
	// ───────────────────────────── brand voice ─────────────────────────────
	{
		id: "beacon-pb-voice-injected-artifact",
		domain: DOMAIN_BRAND_VOICE,
		title: "Brand voice is a durable injected artifact, not a per-post field",
		content:
			"Treat voice as a persistent object auto-injected into EVERY downstream prompt — " +
			"tone, point-of-view, and 2-3 hard do/don't rules — so thousands of drafts stay " +
			"on-voice. Define it once in DEFINE; never re-specify per post.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 70,
		tags: ["brand-voice", "playbook", "component:voice", "generic"],
	},
	{
		id: "beacon-pb-voice-default-stance",
		domain: DOMAIN_BRAND_VOICE,
		title: "Default generic voice stance: specific, plain, peer-to-peer",
		content:
			"When no campaign voice is set, default to: concrete over abstract, plain words " +
			"over jargon, second-person and peer-to-peer (not corporate broadcast). " +
			"Do: lead with a concrete claim or number. Don't: hedge, hype, or use empty " +
			"superlatives ('revolutionary', 'game-changing').",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: ["brand-voice", "playbook", "component:voice", "generic"],
	},

	// ───────────────────────── content / hook examples ─────────────────────
	{
		id: "beacon-pb-hook-body-cta-atom",
		domain: DOMAIN_BRAND_VOICE,
		title:
			"Hook-Body-CTA is the atomic post unit; the hook earns the first 3 seconds",
		content:
			"Every post = Hook (first line earns attention) + Body (delivers the value) + CTA " +
			"(one action). The first 2-3 seconds decide engagement — ~65% who pass 3s reach 10s. " +
			"Spend the most effort on the hook; match hook-type and CTA-type to the funnel layer.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 70,
		tags: [
			"brand-voice",
			"playbook",
			"component:hooks",
			"hook-body-cta",
			"generic",
		],
	},
	{
		id: "beacon-pb-hooks-tofu",
		domain: DOMAIN_BRAND_VOICE,
		title: "TOFU hook templates: curiosity, contrarian, listicle (reach)",
		content:
			"Top-of-funnel hooks maximize reach to cold audiences. Templates: " +
			"'The {thing} nobody tells you about {topic}', " +
			"'Unpopular opinion: {contrarian claim}', " +
			"'{N} ways to {desired outcome} (most people miss #{k})'. " +
			"CTA is soft: follow / save. Generic — fill braces per niche.",
		entryType: "finding",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"brand-voice",
			"playbook",
			"component:hooks",
			"layer:tofu",
			"generic",
		],
	},
	{
		id: "beacon-pb-hooks-mofu",
		domain: DOMAIN_BRAND_VOICE,
		title: "MOFU hook templates: lesson, before/after, proof (trust)",
		content:
			"Middle-of-funnel hooks build trust with a warm audience considering you. Templates: " +
			"'I used to {old belief}. Then {turning point}. Here's what changed.', " +
			"'Before: {pain}. After: {outcome}. The {N} steps:', " +
			"'We {did specific thing} and got {specific result} — here's the breakdown'. " +
			"CTA: reply / DM / read more. Over-weight MOFU.",
		entryType: "finding",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"brand-voice",
			"playbook",
			"component:hooks",
			"layer:mofu",
			"generic",
		],
	},
	{
		id: "beacon-pb-hooks-bofu",
		domain: DOMAIN_BRAND_VOICE,
		title: "BOFU hook templates: objection-handle, specific-offer (conversion)",
		content:
			"Bottom-of-funnel hooks convert ready buyers. Templates: " +
			"'Worried about {top objection}? Here's exactly how we handle it.', " +
			"'If you {specific trigger condition}, {offer} is built for you — here's why.', " +
			"'{Concrete proof / case shape} → {clear next step}'. " +
			"CTA is direct and single: start / book / buy. Keep BOFU volume small but sharp.",
		entryType: "finding",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"brand-voice",
			"playbook",
			"component:hooks",
			"layer:bofu",
			"generic",
		],
	},

	// ──────────────── example campaign playbooks (choosable templates) ──────
	// Encoded in beacon-brand-voice so the live RESEARCH/GENERATE recall surfaces them.
	{
		id: "beacon-pb-playbook-founder-led-b2b",
		domain: DOMAIN_BRAND_VOICE,
		title:
			"PLAYBOOK founder-led-b2b-thought-leadership (MOFU-heavy, expert-peer voice)",
		content:
			"Choose for B2B SaaS/services with a considered buyer. " +
			"FUNNEL: MOFU-heavy ~ TOFU 30 / MOFU 50 / BOFU 20. " +
			"VOICE: candid expert-peer; opinionated, specific, no hype; first-person 'we learned'. " +
			"HOOKS: contrarian take, hard-won lesson, specific-number proof. " +
			"CADENCE: 4-5x/week steady; 1 long-form hub repurposed into 6-12 spokes. " +
			"METRIC FOCUS: judge MOFU by saves + meaningful replies, not raw reach. " +
			"Customize the braces to your niche; do not copy verbatim.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"brand-voice",
			"playbook",
			"example-playbook",
			"funnel:mofu-heavy",
			"audience:b2b",
			"generic",
		],
	},
	{
		id: "beacon-pb-playbook-creator-audience-growth",
		domain: DOMAIN_BRAND_VOICE,
		title:
			"PLAYBOOK creator-audience-growth (TOFU-heavy, energetic relatable voice)",
		content:
			"Choose for audience-first creators monetizing attention later. " +
			"FUNNEL: TOFU-heavy ~ TOFU 60 / MOFU 30 / BOFU 10. " +
			"VOICE: energetic, relatable, fast; second-person; short lines; high personality. " +
			"HOOKS: curiosity gap, listicle, relatable confession. " +
			"CADENCE: daily; aggressively repurpose 1 hub into many spokes across formats. " +
			"METRIC FOCUS: judge TOFU by reach + new follows; let MOFU/BOFU lag early. " +
			"Customize the braces to your niche; do not copy verbatim.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"brand-voice",
			"playbook",
			"example-playbook",
			"funnel:tofu-heavy",
			"audience:creator",
			"generic",
		],
	},

	// ─────────────────────── funnel structure (campaigns) ──────────────────
	{
		id: "beacon-pb-funnel-taxonomy",
		domain: DOMAIN_CAMPAIGNS,
		title: "TOFU/MOFU/BOFU is a metric taxonomy, not just a content tag",
		content:
			"Each funnel layer is judged by a different KPI: TOFU=reach, MOFU=trust/lead-quality, " +
			"BOFU=conversion. Classify every draft by layer at generation time so ANALYZE can " +
			"resolve KPI per layer (never one global engagement rate).",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 70,
		tags: ["campaigns", "playbook", "component:funnel", "generic"],
	},
	{
		id: "beacon-pb-funnel-overweight-mofu",
		domain: DOMAIN_CAMPAIGNS,
		title: "Deliberately over-weight MOFU in funnel_targets",
		content:
			"~68% of B2B deals stall in a chronically-starved MOFU. Default a campaign's " +
			"funnel_targets to over-weight MOFU (e.g. TOFU 30 / MOFU 50 / BOFU 20) unless the " +
			"audience is attention-first (then TOFU-heavy). Volume per layer DERIVES from " +
			"funnel_targets — never a hardcoded N.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: ["campaigns", "playbook", "component:funnel", "generic"],
	},
	{
		id: "beacon-pb-cadence-consistency",
		domain: DOMAIN_CAMPAIGNS,
		title:
			"Cadence: steady beats bursty (~5x engagement); one missed week resets momentum",
		content:
			"Consistency correlates with ~5x engagement; gains front-load then diminish, and a " +
			"missed week resets momentum. Pick a sustainable per-week rhythm and hold it — steady " +
			"cadence over bursty dumps.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: ["campaigns", "playbook", "component:cadence", "generic"],
	},
	{
		id: "beacon-pb-cadence-hub-and-spoke",
		domain: DOMAIN_CAMPAIGNS,
		title: "Volume = repurpose one hub into many spokes, never N one-offs",
		content:
			"Generate volume by repurposing a single hub asset (one long-form idea) into 6-12 " +
			"channel-shaped spokes, not by writing N unrelated one-offs. Same hub-and-spoke engine " +
			"as vNext video clipping (1 clip → N shorts).",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"campaigns",
			"playbook",
			"component:cadence",
			"hub-and-spoke",
			"generic",
		],
	},

	// ──────────────── per-layer metric / rubric (post-performance) ──────────
	{
		id: "beacon-pb-metric-per-layer",
		domain: DOMAIN_POST_PERFORMANCE,
		title: "Resolve KPI per funnel layer with layer-appropriate metrics",
		content:
			"TOFU → reach/impressions (or engagement-per-follower when impressions are null). " +
			"MOFU → trust signals: saves, meaningful replies, profile visits. " +
			"BOFU → conversion: clicks-to-action, bookings, signups. " +
			"Never collapse to one global rate — it is wrong for a funnel.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 70,
		tags: ["post-performance", "playbook", "component:metric", "generic"],
	},
	{
		id: "beacon-pb-rubric-value-equation",
		domain: DOMAIN_POST_PERFORMANCE,
		title: "REFINE rubric lever: Hormozi Value Equation",
		content:
			"Score drafts on perceived value = (dream outcome x perceived likelihood of " +
			"achievement) / (time delay x effort & sacrifice). Raise the numerator (bigger " +
			"outcome, more believable) and shrink the denominator (faster, easier). Use as a " +
			"named lever in the critique->revise->score loop.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"post-performance",
			"playbook",
			"component:rubric",
			"refine",
			"generic",
		],
	},
	{
		id: "beacon-pb-log-propensity",
		domain: DOMAIN_POST_PERFORMANCE,
		title: "Log selection propensity from day one (cannot be backfilled)",
		content:
			"For every action the policy takes, log the tuple (context, action, reward, p) where " +
			"p = probability the policy chose that action. Without p you can only correlate, never " +
			"counterfactually evaluate 'would strategy B have beaten A?'. Near-zero cost now; " +
			"impossible to backfill — skipping it permanently caps LEARN rigor.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 70,
		tags: [
			"post-performance",
			"playbook",
			"component:metric",
			"propensity",
			"generic",
		],
	},
	{
		id: "beacon-pb-evergreen-recycle",
		domain: DOMAIN_POST_PERFORMANCE,
		title:
			"LEARN tier-1: evergreen-recycle high-KPI posts before autonomous planning",
		content:
			"The proven, ship-first LEARN primitive: detect posts whose per-layer KPI beats a " +
			"threshold and requeue the winners (as Hypefury/ContentStudio ship). Autonomous " +
			"'what to post next' planning is unproven by any incumbent — sequence it AFTER " +
			"evergreen-recycle, gated by off-policy evaluation.",
		entryType: "rule",
		sourceType: "human",
		confidencePct: 60,
		tags: [
			"post-performance",
			"playbook",
			"component:metric",
			"learn",
			"generic",
		],
	},
];
