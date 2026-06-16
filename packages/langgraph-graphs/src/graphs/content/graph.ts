// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/graph`
 * Purpose: Content production graph — a 4-node inner content loop for the beacon
 *   growth loop: ideate → draft → critique/revise → adapt-per-platform.
 * Scope: Pure factory. Each node calls the injected LLM; emits one staged variant
 *   per enabled channel. Does NOT execute graphs, read env, or do I/O.
 * Invariants:
 *   - PURE_FACTORY: no side effects, no env reads; LLM is injected
 *   - FOUR_NODE_CONTENT_LOOP: ideate, draft, critique_revise, adapt_per_platform
 *   - ONE_VARIANT_PER_CHANNEL: adapt emits exactly one variant per enabled channel
 *   - NO_POST_METRICS_WRITE: this module never references the post_metrics writer
 *   - TYPE_TRANSPARENT_RETURN: no explicit return type for CLI schema extraction
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §1, references the `poet` graph.
 * @public
 */

import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { StateGraph } from "@langchain/langgraph";

import type { CreateReactAgentGraphOptions } from "../types";
import {
  ADAPT_PROMPT,
  CHANNEL_CONSTRAINTS,
  CRITIQUE_PROMPT,
  DEFAULT_CHANNEL_CONSTRAINTS,
  DRAFT_PROMPT,
  IDEATE_PROMPT,
} from "./prompts";
import {
  type ContentState,
  ContentStateAnnotation,
  type ContentVariant,
} from "./state";

/**
 * Graph name constant for routing.
 */
export const CONTENT_GRAPH_NAME = "content" as const;

/** Default channel when none configured (X is the v0 primary). */
const DEFAULT_ENABLED_CHANNELS = ["x"] as const;

/** Read enabled channels from RunnableConfig.configurable (graphs receive it at invoke). */
function readEnabledChannels(config: RunnableConfig): string[] {
  const raw = (config.configurable as { enabledChannels?: unknown } | undefined)
    ?.enabledChannels;
  if (Array.isArray(raw)) {
    const channels = raw.filter((c): c is string => typeof c === "string");
    if (channels.length > 0) return channels;
  }
  return [...DEFAULT_ENABLED_CHANNELS];
}

/** Extract plain-text content from an LLM response. */
function textOf(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : "";
}

/** Pull the latest human message text (the campaign brief). */
function latestBrief(messages: readonly BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.getType?.() === "human" && typeof m.content === "string") {
      return m.content;
    }
  }
  const last = messages[messages.length - 1];
  return last && typeof last.content === "string" ? last.content : "";
}

/** Best-effort parse of an angles JSON array; falls back to the raw text. */
function parseAngles(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) {
      const angles = parsed.filter((a): a is string => typeof a === "string");
      if (angles.length > 0) return angles;
    }
  } catch {
    // Not JSON — fall through.
  }
  return raw.trim().length > 0 ? [raw.trim()] : [];
}

/**
 * Create the content production graph.
 *
 * Architecture:
 * ```
 * START → ideate → draft → critique_revise → adapt_per_platform → END
 * ```
 * The adapt node emits one staged variant per enabled channel and writes the
 * final structured result as a JSON AIMessage (so callers / tests can read the
 * variants off the output messages).
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with the injected LLM (tools unused by the nodes directly)
 * @returns Compiled LangGraph ready for invoke()
 */
/**
 * Narrowed LLM surface the content nodes need: a single-shot `invoke` that
 * returns a `BaseMessage`. The catalog hands us a `LanguageModelLike` whose
 * `invoke` is intentionally broad; we narrow it (via `unknown`) at the factory
 * boundary so the nodes stay strictly typed without `any`.
 */
interface InvokableLlm {
  invoke(
    messages: BaseMessage[],
    config?: RunnableConfig
  ): Promise<BaseMessage>;
}

export function createContentGraph(opts: CreateReactAgentGraphOptions) {
  const llm = opts.llm as unknown as InvokableLlm;

  // Node 1 — IDEATE: expand the brief into distinct angles.
  async function ideate(state: ContentState, config: RunnableConfig) {
    const brief = latestBrief(state.messages);
    const response = await llm.invoke(
      [new SystemMessage(IDEATE_PROMPT), new HumanMessage(brief)],
      config
    );
    return {
      angles: parseAngles(textOf(response)),
      enabledChannels: readEnabledChannels(config),
    };
  }

  // Node 2 — DRAFT: write a first-pass core post for the strongest angle.
  async function draft(state: ContentState, config: RunnableConfig) {
    const angle = state.angles[0] ?? latestBrief(state.messages);
    const response = await llm.invoke(
      [new SystemMessage(DRAFT_PROMPT), new HumanMessage(`Angle: ${angle}`)],
      config
    );
    return { draft: textOf(response) };
  }

  // Node 3 — CRITIQUE/REVISE: one self-revise pass.
  async function critiqueRevise(state: ContentState, config: RunnableConfig) {
    const response = await llm.invoke(
      [
        new SystemMessage(CRITIQUE_PROMPT),
        new HumanMessage(`Draft:\n${state.draft}`),
      ],
      config
    );
    const revised = textOf(response) || state.draft;
    return { revised };
  }

  // Node 4 — ADAPT-PER-PLATFORM: one variant per enabled channel.
  async function adaptPerPlatform(
    state: ContentState,
    config: RunnableConfig
  ) {
    const core = state.revised || state.draft;
    const channels =
      state.enabledChannels.length > 0
        ? state.enabledChannels
        : readEnabledChannels(config);

    const variants: ContentVariant[] = [];
    for (const channel of channels) {
      const constraints =
        CHANNEL_CONSTRAINTS[channel] ?? DEFAULT_CHANNEL_CONSTRAINTS;
      const prompt = ADAPT_PROMPT.replace("{channel}", channel).replace(
        "{constraints}",
        constraints
      );
      const response = await llm.invoke(
        [new SystemMessage(prompt), new HumanMessage(`Core post:\n${core}`)],
        config
      );
      variants.push({ channel, text: textOf(response) || core });
    }

    // Emit the structured result as the final assistant message.
    const summary = JSON.stringify({ variants });
    return {
      variants,
      messages: [new AIMessage(summary)],
    };
  }

  const builder = new StateGraph(ContentStateAnnotation)
    .addNode("ideate", ideate)
    .addNode("draft", draft)
    .addNode("critique_revise", critiqueRevise)
    .addNode("adapt_per_platform", adaptPerPlatform)
    .addEdge("__start__", "ideate")
    .addEdge("ideate", "draft")
    .addEdge("draft", "critique_revise")
    .addEdge("critique_revise", "adapt_per_platform")
    .addEdge("adapt_per_platform", "__end__");

  return builder.compile();
}
