# The marketing-campaign playbook — canonical component list (v0 seed)

> domain refs: `beacon-brand-voice` · `beacon-campaigns` · `beacon-post-performance`
> status: draft · source_type: human · spike: beacon-growth-e2e
> Cites: [`marketing-platforms-landscape.md`](../marketing-platforms-landscape.md) (evidence),
> [`agentic-marketing-spine-validated.md`](./agentic-marketing-spine-validated.md) (sequencing).
> Encoded as seed atoms in `packages/knowledge-base/src/seeds/growth-playbook.ts`.

## Why this exists

beacon's growth loop grounds every GENERATE/RESEARCH pass by recalling a "playbook"
from Doltgres. Today recall returns **nothing** — the three growth domains were created
but never seeded — so generation has no compounding memory. This doc defines the
**composable template** a campaign chooses from, and is the canonical source for the
concise seed atoms. Keep it high-signal: the agents consuming these atoms are easily
confused. Don't over-pollute.

## How recall consumes it (the constraint that shapes the seed)

Both the RESEARCH and GENERATE routes recall **only the `beacon-brand-voice` domain**
(`searchKnowledge("beacon-brand-voice", query, { limit: 5 })`), and feed each hit to the
LLM as a `"${title}: ${content}"` string (truncated to 500 chars). Two consequences:

1. **Anything that must reach generation today lives in `beacon-brand-voice`.** That
   includes the example campaign playbooks — they are encoded in `beacon-brand-voice` so
   step 2 ("compare against existing playbooks, choose one") has choosable templates the
   live loop can actually recall.
2. **Title + content must be self-contained and short.** The recall string is
   `title: content` truncated at 500 chars. Front-load the signal; no preamble.

`beacon-campaigns` and `beacon-post-performance` are seeded with the durable
strategy/measurement rubrics that the LEARN/ANALYZE stages and future planning recall —
not consumed by today's two routes, but they are the compounding memory those stages read.

## The five components of a campaign playbook

A "campaign playbook" is the composable template a new campaign **chooses and customizes**.
It bundles five components. An example playbook (see below) is one coherent choice across
all five.

| # | Component | What it fixes | Domain it seeds into |
|---|-----------|---------------|----------------------|
| 1 | **Funnel structure** | The TOFU/MOFU/BOFU weighting (`funnel_targets` shape) the campaign generates toward. MOFU is deliberately over-weighted. | `beacon-campaigns` |
| 2 | **Brand voice** | The durable voice stance auto-injected into every downstream prompt — tone, person, do/don't. | `beacon-brand-voice` |
| 3 | **Content / hook examples** | Reusable hook + Hook–Body–CTA patterns per layer. Generic templates, never a real post. | `beacon-brand-voice` |
| 4 | **Cadence** | Steady posting rhythm + the hub-and-spoke repurposing ratio (1 hub → N spokes). | `beacon-campaigns` |
| 5 | **Per-layer metric / rubric** | Which KPI judges each layer (TOFU=reach, MOFU=trust, BOFU=conversion) + the REFINE scoring rubric. | `beacon-post-performance` |

### 1. Funnel structure
TOFU/MOFU/BOFU is a **metric taxonomy, not just a content tag**. Reach judges TOFU,
trust/lead-quality judges MOFU, conversion judges BOFU. ~68% of B2B deals stall in a
chronically-starved MOFU, so a playbook **deliberately over-weights MOFU** in its
`funnel_targets`. A playbook names a weight per layer; the campaign's `funnel_targets`
derive volume from it (never a hardcoded N).

### 2. Brand voice
A durable, **injected artifact** — a persistent object auto-injected into every
downstream prompt, not a per-post field (the quality moat every incumbent ships: Jasper
Brand Voice/IQ, Typefully). A voice atom states tone, person/POV, and 2–3 hard do/don't
rules so generation stays on-voice across thousands of drafts.

### 3. Content / hook examples
**Hook–Body–CTA is the atomic unit**; the first 2–3 seconds decide engagement (~65% who
pass 3s reach 10s). Encode hook-type + CTA-type **per layer**. Examples are generic
*templates* (e.g. "contrarian take", "before/after", "specific-number proof") — never a
real post, account, or campaign name (the hard Dolt rule).

### 4. Cadence
**Consistency ≈ 5× engagement**; gains front-load then diminish, and one missed week
resets momentum — so steady cadence beats bursty dumps. **Volume = repurposing one hub,
never N one-offs** (1 long-form → 6–12 posts; the same hub-and-spoke engine as vNext
video clipping). A cadence atom names a sustainable per-week rhythm + the hub→spoke ratio.

### 5. Per-layer metric / rubric
ANALYZE resolves KPI **per funnel layer** with layer-appropriate metrics, never one
global rate. REFINE scores drafts on a **named rubric** — Hormozi's Value Equation
(dream outcome × likelihood ÷ time × effort) is the canonical lever. Day-one
**propensity logging** `(context, action, reward, p)` is non-negotiable for later LEARN
rigor (cannot be backfilled).

## Example campaign playbooks (the choosable templates)

Two full, choosable bundles are seeded as `beacon-brand-voice` atoms (so the live loop
recalls them). Each is one coherent choice across all five components:

- **founder-led-b2b-thought-leadership** — MOFU-heavy funnel · candid expert-peer voice ·
  contrarian/lesson hooks · 4–5×/week steady · MOFU judged by saves+replies. For B2B SaaS
  / services selling to a considered buyer.
- **creator-audience-growth** — TOFU-heavy funnel · energetic relatable voice ·
  curiosity/listicle hooks · daily + hub-repurpose · TOFU judged by reach+follows. For
  audience-first creators monetizing attention later.

A new campaign recalls these, **picks the closest**, then customizes the funnel weights,
voice specifics, hooks, cadence, and metric focus to its niche (the v0 of "compare against
existing playbooks, choose one").

## Atom inventory (what got seeded)

All atoms are **generic** — they apply to any tenant and name no real account, campaign,
or post. Counts and per-domain rationale live in the PR body; the atoms themselves are in
`packages/knowledge-base/src/seeds/growth-playbook.ts`, registered via the package index
the same way `BASE_KNOWLEDGE_SEEDS` is.
