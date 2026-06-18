// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs`
 * Purpose: Barrel export for graph factories and shared types.
 * Scope: Graph creation functions and type definitions. Does NOT include runners (those live in src/).
 * Invariants:
 *   - Graphs are pure factories — no side effects, no env reads
 *   - All LangChain graph creation code lives here
 *   - Shared types prevent per-graph interface duplication
 * Side-effects: none
 * Links: LANGGRAPH_AI.md, AGENT_DEVELOPMENT_GUIDE.md
 * @public
 */

// Autoresearch graphs (Karpathy-style experiment loops)
export {
  AUTORESEARCH_REGISTRY_SWARM_GRAPH_NAME,
  AUTORESEARCH_SINGLE_LANE_GRAPH_NAME,
  AUTORESEARCH_SYNTROPY_LOOP_GRAPH_NAME,
  createAutoresearchGraph,
} from "./autoresearch/graph";
// Brain graph (code-aware assistant with repo access)
export { BRAIN_GRAPH_NAME, createBrainGraph } from "./brain/graph";
// Browser graph (web browsing via Playwright MCP)
export { BROWSER_GRAPH_NAME, createBrowserGraph } from "./browser/graph";
// Frontend tester graph (QA agent via Playwright MCP)
export {
  createFrontendTesterGraph,
  FRONTEND_TESTER_GRAPH_NAME,
} from "./frontend-tester/graph";
// Poet graph (poetic AI assistant)
export { createPoetGraph, POET_GRAPH_NAME } from "./poet/graph";
// Ponderer graph (philosophical thinker)
export { createPondererGraph, PONDERER_GRAPH_NAME } from "./ponderer/graph";
// PR Review graph (single-call structured output, no tools)
export { createPrReviewGraph, PR_REVIEW_GRAPH_NAME } from "./pr-review/graph";
export { buildReviewUserMessage } from "./pr-review/prompts";
// Research graph (deep research with web search)
export { createResearchGraph, RESEARCH_GRAPH_NAME } from "./research/graph";
// Growth-research workflow (beacon growth loop RESEARCH activity — pure, on-demand;
// NOT a catalog graph: invoked directly by the research route, no Temporal).
export {
  RESEARCH_FINDING_KINDS,
  RESEARCH_PROMPT,
  type ResearchFindingKind,
} from "./growth-research/prompts";
export {
  type CampaignStrategy,
  type CompleteFn,
  parseFindings,
  type RecallPlaybookFn,
  type ResearchFinding,
  runGrowthResearch,
  type RunGrowthResearchInput,
} from "./growth-research/workflow";
// Growth-generate workflow (beacon growth loop GENERATE activity — pure, on-demand;
// NOT a catalog graph: invoked directly by the generate route, no Temporal).
export {
  FUNNEL_LAYER_GUIDANCE,
  FUNNEL_LAYERS,
  type FunnelLayer,
  GENERATE_PROMPT,
} from "./growth-generate/prompts";
export {
  type DraftPost,
  type FunnelTargets,
  type GenerateFinding,
  parseDraftPosts,
  resolveLayerCount,
  runGrowthGenerate,
  type RunGrowthGenerateInput,
} from "./growth-generate/workflow";
// Shared graph types
export type {
  CreateReactAgentGraphOptions,
  GraphInvokeOptions,
  InvokableGraph,
  MessageGraphInput,
  MessageGraphOutput,
} from "./types";
