# Dolt playbook seed — generic growth skills (no tenant data)

> **dolt is the playbook, postgres is the game.** `generate`/`research`/`refine` recall
> the `beacon-brand-voice` (+ `beacon-campaigns`, `beacon-post-performance`) domains from
> Doltgres to ground every run — but those domains were only *created* by the foundation
> self-heal, never *seeded*. Today recall returns **nothing** (fail-open → no grounding).
> This file is the seed: load each atom into Doltgres so the loop has a playbook to
> compound on. Every atom is **generic** (applies to any tenant) — that is the rule for
> Dolt; nothing here names an account/campaign/post. Distilled from
> [`marketing-platforms-landscape.md`](../marketing-platforms-landscape.md) + Welsh/Hormozi.
> Shape mirrors the EDO knowledge atom: `{domain, entry_type, title, content, status, tags}`.
> Promotion: seed as `status: established` for canon (funnel/cadence) and `candidate` for
> the more opinionated rubrics — analytics later validates/demotes them.

## domain: `beacon-brand-voice` (how to write)

### rule — Hook–Body–CTA is the atomic unit; the first 2–3 seconds decide everything
Every post is one Hook (0–3s, a pattern-interrupt — contrarian claim, bold promise, or
sharp question), Body (the proof/payoff/story), CTA (exactly one ask). ~65% who pass the
3-second hook reach 10s; a weak hook caps the post regardless of body quality. Score the
hook first.

### rule — One CTA per post
Multiple asks split attention and lower action. Pick the single most valuable next step
for the post's funnel layer (follow/save at TOFU; reply/subscribe at MOFU; click/convert
at BOFU).

### guide — Brand voice is a durable artifact, injected every run
Voice = the campaign's persistent editorial DNA (tone, vocabulary, stance, do/don't).
It is set once at DEFINE and injected into every research/generate/refine prompt — never
re-decided per post. On-brand-without-babysitting is the quality moat.

### rule — Don't engagement-bait or over-claim (brand safety)
No fabricated stats, no "comment X for the link", no manufactured outrage. Over-claiming
wins a post and loses the audience. This rule outranks any short-term engagement lever.

## domain: `beacon-campaigns` (how to plan & generate)

### rule — Fill the funnel; never ship one-off
Volume comes from repurposing ONE hub idea into many spokes (1 long-form → 6–12 posts),
not N unrelated ideas. Generation lays out a plan across TOFU/MOFU/BOFU and drafts to fill
per-layer `funnel_targets` — coverage, not a hardcoded count.

### rule — Over-weight MOFU
The middle of the funnel (trust/proof/nurture) is chronically starved (~68% of B2B deals
stall there). Default `funnel_targets` should weight MOFU above TOFU/BOFU until analytics
says otherwise.

### guide — Funnel layer = a content stance AND a metric
TOFU = reach/give-value (broad, no ask-heavy CTA). MOFU = trust/proof (case, contrarian
take, framework). BOFU = conversion (one clear ask). Each layer is written differently
*and judged by a different metric* (see post-performance).

### guide — Value Equation as the offer lens (Hormozi)
Perceived value = (Dream Outcome × Perceived Likelihood) ÷ (Time Delay × Effort/Sacrifice).
Lift any lever: make the outcome vivid, raise believability with proof, shrink time-to-
result, reduce effort. Use it to sharpen MOFU/BOFU angles.

### guide — Consistency beats raw volume
Regular cadence ≈ 5× engagement vs sporadic; the biggest lift is minimal→moderate, with
diminishing returns at extreme volume. Prefer a steady drumbeat over bursty dumps; a
missed stretch resets momentum.

## domain: `beacon-post-performance` (how to measure & refine)

### rule — Judge each funnel layer by its own metric, never one global rate
TOFU = reach/impressions; MOFU = trust/engagement-depth & saves/replies; BOFU =
conversion. A single blended "engagement rate" is meaningless across a funnel and hides
where it is thin.

### rule — Refine is critique→revise→score on a named rubric
Multi-pass: an LLM judge emits structured critique (hook strength, CTA clarity, Value-
Equation levers, on-voice), the generator revises (bumps revision), re-score, promote best
→ approved / prune → rejected. The rubric is itself a playbook artifact analytics tunes.

### rule — Calibrate predicted score against realized engagement
Track refine's predicted score vs the post's actual KPI. A shrinking gap = the playbook
models reality (promote skills). A self-consistent-but-reality-divergent score = the judge
is eating its own tail (demote, widen exploration). This calibration gap is the master
learning signal and the over-exploitation tripwire.

### rule — Promote a skill only on evidence, never vibes
A candidate skill enters canon only when it beats the incumbent on logged history
(off-policy evaluation over the post-decision/propensity log). Anything that stops
predicting engagement decays and is pruned — the playbook stays small and high-signal.
</content>
