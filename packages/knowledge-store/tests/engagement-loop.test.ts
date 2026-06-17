// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/tests/engagement-loop`
 * Purpose: Integration test for the `metric:engagement` resolver path — the
 *   growth-loop VERIFIER. Mirrors `edo-loop.test.ts` but drives the
 *   `metric:`-strategy bridge: file a campaign hypothesis with
 *   `resolution_strategy = 'metric:engagement:<id>'`, ingest LOW then RISING
 *   cached snapshots, run the resolver path (`pendingResolutions('metric:')` →
 *   `computeEngagementKpi` → `resolveHypothesis(edge)`), and assert the loop
 *   closes: `validates`, confidence recomputes, a `beacon-post-performance`
 *   finding is filed with an `evidence_for` (`op:cite`) edge to the campaign.
 * Scope: Tests only. Uses the in-memory fakes (parity with Doltgres adapters)
 *   + the real pure `computeEngagementKpi`. The Postgres `post_metrics` read is
 *   represented directly as `PostMetricSnapshot[]` (the bridge job's reduction).
 * Invariants:
 *   - KPI_NEVER_SELF_CITED: the edge derives solely from the snapshots.
 *   - RESOLVER_DELEGATES_IDEMPOTENT: outcome rows only via resolveHypothesis.
 *   - METRIC_STRATEGY_RESOLVABLE: a `metric:engagement:*` hypothesis is visible
 *     to `pendingResolutions('metric:')` and resolvable through the same port.
 * Side-effects: none (in-memory fakes)
 * Links: docs/spec/beacon-growth-loop-v0.md §6, .context/specs/pr3-verifier.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  FakeEdoResolverAdapter,
  FakeKnowledgeStoreAdapter,
} from "../src/adapters/fake/index.js";
import {
  computeEngagementKpi,
  type PostMetricSnapshot,
} from "../src/domain/engagement-kpi.js";
import { createEdoCapability } from "../src/edo-capability.js";

const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const DOMAIN_POST_PERFORMANCE = "beacon-post-performance";
const DOMAIN_BRAND_VOICE = "beacon-brand-voice";

async function bootstrap() {
  const store = new FakeKnowledgeStoreAdapter();
  for (const id of [
    DOMAIN_CAMPAIGNS,
    DOMAIN_POST_PERFORMANCE,
    DOMAIN_BRAND_VOICE,
  ]) {
    await store.registerDomain({ id, name: id, description: "growth v0" });
  }
  const resolver = new FakeEdoResolverAdapter(store);
  const capability = createEdoCapability(store, resolver);
  return { store, resolver, capability };
}

/**
 * Re-implements the bridge job's finding + brand-voice + evidence_for write
 * surface against any KnowledgeStorePort. Kept in lockstep with
 * `app/src/bootstrap/jobs/resolveEngagementCampaigns.job.ts`; the app job
 * adds Postgres I/O the package layer can't reach.
 */
async function fileFindingAndRule(
  store: FakeKnowledgeStoreAdapter,
  args: {
    campaignId: string;
    hypothesisId: string;
    score: number;
    edge: "validates" | "invalidates";
    observedRate: number;
    basis: string;
    snapshotCount: number;
  }
): Promise<void> {
  const findingId = `finding:perf:${args.campaignId}`;
  if (!(await store.knowledgeExists(findingId))) {
    await store.addKnowledge({
      id: findingId,
      domain: DOMAIN_POST_PERFORMANCE,
      title: `Campaign ${args.campaignId} engagement ${args.score}/100 (${args.edge})`,
      content: `Independent KPI for campaign '${args.campaignId}': ${args.score}/100, rate ${args.observedRate.toFixed(4)} (${args.basis}) over ${args.snapshotCount} snapshot(s).`,
      entryType: "finding",
      sourceType: "analysis_signal",
      sourceRef: `broadcast:campaign:${args.campaignId}`,
      tags: ["growth-loop", "engagement", args.basis],
      confidencePct: null,
    });
    await store.addCitation({
      citingId: findingId,
      citedId: args.hypothesisId,
      citationType: "evidence_for",
      context: `engagement KPI ${args.score}/100 (${args.edge})`,
    });
  }
  if (args.edge === "validates") {
    const ruleId = `rule:brand-voice:${args.campaignId}`;
    if (!(await store.knowledgeExists(ruleId))) {
      await store.addKnowledge({
        id: ruleId,
        domain: DOMAIN_BRAND_VOICE,
        title: `Winning angle — campaign ${args.campaignId}`,
        content: `Validated angle for '${args.campaignId}'.`,
        entryType: "rule",
        sourceType: "derived",
        sourceRef: `campaign:${args.campaignId}`,
        tags: ["growth-loop", "brand-voice", "validated"],
        confidencePct: null,
      });
    }
    await store.addCitation({
      citingId: ruleId,
      citedId: args.hypothesisId,
      citationType: "supports",
      context: `distilled brand-voice rule from validated campaign ${args.campaignId}`,
    });
  }
  await store.commit(
    `growth: file ${DOMAIN_POST_PERFORMANCE} finding for ${args.campaignId} (${args.edge})`
  );
}

/** One bridge tick: pendingResolutions('metric:') → KPI → resolve + finding. */
async function runResolveTick(
  store: FakeKnowledgeStoreAdapter,
  resolver: FakeEdoResolverAdapter,
  now: Date,
  snapshotsByCampaign: Record<string, PostMetricSnapshot[]>
): Promise<{ resolved: number }> {
  const due = await resolver.pendingResolutions(now, { strategy: "metric:" });
  let resolved = 0;
  for (const h of due) {
    const prefix = "metric:engagement:";
    if (!h.resolutionStrategy?.startsWith(prefix)) continue;
    const campaignId = h.resolutionStrategy.slice(prefix.length);
    const snapshots = snapshotsByCampaign[campaignId] ?? [];
    const m = h.content.match(/target[_\s-]?rate["\s:=]+([0-9]*\.?[0-9]+)/i);
    const rate = m?.[1] ? Number(m[1]) : 0.02;
    const kpi = computeEngagementKpi(snapshots, { rate });
    const resolution = await resolver.resolveHypothesis({
      hypothesisId: h.id,
      domain: h.domain,
      outcomeId: `outcome:${h.id}`,
      outcomeTitle: `Engagement KPI ${kpi.score0to100}/100 (${kpi.edge})`,
      outcomeContent: `KPI=${kpi.score0to100}/100; rate ${kpi.observedRate.toFixed(4)} (${kpi.basis}); ${snapshots.length} snapshot(s).`,
      edge: kpi.edge,
      sourceType: "analysis_signal",
      sourceRef: `kpi:engagement:${campaignId}`,
      sourceNode: "growth-resolver",
    });
    if (!resolution.alreadyResolved) {
      resolved++;
      await fileFindingAndRule(store, {
        campaignId,
        hypothesisId: h.id,
        score: kpi.score0to100,
        edge: kpi.edge,
        observedRate: kpi.observedRate,
        basis: kpi.basis,
        snapshotCount: snapshots.length,
      });
    }
  }
  return { resolved };
}

describe("growth metric:engagement loop — ingest low → rising → resolve", () => {
  it("closes the loop: validates + recomputed confidence + finding + evidence_for cite", async () => {
    const { store, resolver, capability } = await bootstrap();
    const campaignId = "spring-awareness";
    const hypothesisId = `campaign:${campaignId}`;
    const evaluateAt = new Date("2026-06-30T00:00:00Z");

    // PLAN — file the campaign hypothesis, opted into the metric: resolver.
    await capability.hypothesize({
      id: hypothesisId,
      domain: DOMAIN_CAMPAIGNS,
      title: "Awareness angle A hits 3% engagement by end of June",
      content: "Audience: builders. Angle A. target_rate=0.03",
      evaluateAt,
      resolutionStrategy: `metric:engagement:${campaignId}`,
      sourceType: "human",
      confidencePct: 30,
    });

    // The hypothesis is invisible to the metric: cron before its deadline...
    const beforeDeadline = new Date("2026-06-01T00:00:00Z");
    const notYet = await resolver.pendingResolutions(beforeDeadline, {
      strategy: "metric:",
    });
    expect(notYet.find((r) => r.id === hypothesisId)).toBeUndefined();

    // ...and IS visible after it (METRIC_STRATEGY_RESOLVABLE).
    const afterDeadline = new Date("2026-07-01T00:00:00Z");
    const due = await resolver.pendingResolutions(afterDeadline, {
      strategy: "metric:",
    });
    expect(due.find((r) => r.id === hypothesisId)).toBeDefined();

    // MEASURE round 1 — LOW engagement (1% vs 3% target). Below target.
    const lowSnapshots: PostMetricSnapshot[] = [
      {
        impressions: 1000,
        likes: 6,
        reposts: 2,
        replies: 2,
        followersAtCapture: null,
      },
    ];
    const lowKpi = computeEngagementKpi(lowSnapshots, { rate: 0.03 });
    expect(lowKpi.edge).toBe("invalidates");
    expect(lowKpi.score0to100).toBeLessThan(100);

    // MEASURE round 2 — RISING engagement (append-only): now hits/clears target.
    const risingSnapshots: PostMetricSnapshot[] = [
      ...lowSnapshots,
      {
        impressions: 1000,
        likes: 40,
        reposts: 15,
        replies: 10,
        followersAtCapture: null,
      },
    ];
    // Aggregate weighted: (10 + 65) / 2000 = 0.0375 ≥ 0.03 → validates.
    const risingKpi = computeEngagementKpi(risingSnapshots, { rate: 0.03 });
    expect(risingKpi.edge).toBe("validates");
    expect(risingKpi.score0to100).toBeGreaterThanOrEqual(100);

    // RESOLVE — the bridge tick reads the RISEN ground-truth and closes the loop.
    const tick = await runResolveTick(store, resolver, afterDeadline, {
      [campaignId]: risingSnapshots,
    });
    expect(tick.resolved).toBe(1);

    // Loop closure: an outcome + validates citation now resolve the hypothesis.
    const incoming = await store.listCitationsByCitedId(hypothesisId);
    expect(
      incoming.find((c) => c.citationType === "validates")
    ).toBeDefined();

    const outcome = await store.getKnowledge(`outcome:${hypothesisId}`);
    expect(outcome?.entryType).toBe("outcome");

    // Recomputed confidence rose above the agent/human baseline (supports +
    // validates + evidence_for all bump it).
    const resolvedHypothesis = await store.getKnowledge(hypothesisId);
    expect(resolvedHypothesis?.confidencePct).not.toBeNull();
    expect(resolvedHypothesis?.confidencePct ?? 0).toBeGreaterThan(30);

    // A beacon-post-performance finding exists with an evidence_for (op:cite)
    // edge to the campaign hypothesis.
    const finding = await store.getKnowledge(`finding:perf:${campaignId}`);
    expect(finding?.entryType).toBe("finding");
    expect(finding?.domain).toBe(DOMAIN_POST_PERFORMANCE);
    const findingEdges = await store.listCitationsByCitingId(
      `finding:perf:${campaignId}`
    );
    expect(
      findingEdges.find(
        (c) => c.citationType === "evidence_for" && c.citedId === hypothesisId
      )
    ).toBeDefined();

    // On validate, a durable brand-voice rule was distilled.
    const rule = await store.getKnowledge(`rule:brand-voice:${campaignId}`);
    expect(rule?.entryType).toBe("rule");
    expect(rule?.domain).toBe(DOMAIN_BRAND_VOICE);

    // After resolution the hypothesis leaves the pending set (idempotent).
    const stillPending = await resolver.pendingResolutions(afterDeadline, {
      strategy: "metric:",
    });
    expect(stillPending.find((r) => r.id === hypothesisId)).toBeUndefined();
  });

  it("a campaign with no posted metrics at deadline invalidates (failed appointment)", async () => {
    const { store, resolver, capability } = await bootstrap();
    const campaignId = "empty-budget";
    const hypothesisId = `campaign:${campaignId}`;
    await capability.hypothesize({
      id: hypothesisId,
      domain: DOMAIN_CAMPAIGNS,
      title: "Angle B hits 2% — but nothing shipped",
      content: "target_rate=0.02",
      evaluateAt: new Date("2026-01-01T00:00:00Z"),
      resolutionStrategy: `metric:engagement:${campaignId}`,
      sourceType: "human",
      confidencePct: 30,
    });

    const tick = await runResolveTick(
      store,
      resolver,
      new Date("2026-02-01T00:00:00Z"),
      { [campaignId]: [] } // no snapshots
    );
    expect(tick.resolved).toBe(1);

    const incoming = await store.listCitationsByCitedId(hypothesisId);
    expect(
      incoming.find((c) => c.citationType === "invalidates")
    ).toBeDefined();
    // No brand-voice rule distilled on an invalidation.
    expect(await store.getKnowledge(`rule:brand-voice:${campaignId}`)).toBeNull();
  });

  it("double-resolve is a no-op (RESOLVER_DELEGATES_IDEMPOTENT)", async () => {
    const { store, resolver, capability } = await bootstrap();
    const campaignId = "idem";
    const hypothesisId = `campaign:${campaignId}`;
    await capability.hypothesize({
      id: hypothesisId,
      domain: DOMAIN_CAMPAIGNS,
      title: "h",
      content: "target_rate=0.03",
      evaluateAt: new Date("2026-01-01T00:00:00Z"),
      resolutionStrategy: `metric:engagement:${campaignId}`,
      sourceType: "human",
      confidencePct: 30,
    });
    const snapshots: PostMetricSnapshot[] = [
      { impressions: 1000, likes: 30, reposts: 0, replies: 0, followersAtCapture: null },
    ];

    const now = new Date("2026-02-01T00:00:00Z");
    const first = await runResolveTick(store, resolver, now, {
      [campaignId]: snapshots,
    });
    expect(first.resolved).toBe(1);
    const second = await runResolveTick(store, resolver, now, {
      [campaignId]: snapshots,
    });
    expect(second.resolved).toBe(0);

    const resolving = (await store.listCitationsByCitedId(hypothesisId)).filter(
      (c) => c.citationType === "validates" || c.citationType === "invalidates"
    );
    expect(resolving).toHaveLength(1);
  });
});
