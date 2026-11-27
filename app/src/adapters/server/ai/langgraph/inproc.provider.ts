// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/langgraph/inproc.provider`
 * Purpose: LangGraph in-process graph provider for Next.js runtime.
 * Scope: Routes graph execution to package runner. Does NOT import @langchain/* directly — all LangChain in package.
 * Invariants:
 *   - NO_LANGCHAIN_IN_SRC: No @langchain imports; delegates to package runner
 *   - GRAPH_ID_NAMESPACED: graphId format is "langgraph:${graphName}"
 *   - CATALOG_SINGLE_SOURCE_OF_TRUTH: Uses catalog from @cogni/langgraph-graphs
 *   - NODE_BUNDLE_IS_CANONICAL: Resolves BoundTool from injected node bundle (CORE_TOOL_BUNDLE [+ POLY_TOOL_BUNDLE for poly]); never iterates the global TOOL_CATALOG (which is per-package and can drift behind per-node bundles).
 *   - DENY_BY_DEFAULT: Tool policy explicitly provided per graph
 *   - MCP_VIA_ASYNC_SOURCE: MCP tools resolved via async getMcpToolSource() function (shared cache with reconnect-on-error)
 * Side-effects: IO (executes graphs via package runner, MCP tool resolution via HTTP)
 * Notes: Discovery is in LangGraphInProcAgentCatalogProvider, not here.
 * Links: https://node-template.cognidao.org/knowledge/graph-execution-invariants
 * @internal
 */

import {
  type GuardDeps,
  guardTools,
  offeredToolIds,
  type TerminalDenial,
  ToolAuthorityError,
} from "@cogni/agent-grants";
import { buildRequiresById } from "@cogni/agent-grants/host";
import type { AiEvent, BoundToolRuntime, ToolSourcePort } from "@cogni/ai-core";
import {
  createStaticToolSourceFromRecord,
  createToolAllowlistPolicy,
  createToolRunner,
} from "@cogni/ai-core";
import type { CatalogBoundTool as PublishedCatalogBoundTool } from "@cogni/ai-tools";
import type { CatalogBoundTool } from "@cogni/beacon-ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/node-template-graphs";
import {
  type CompletionFn,
  type CreateGraphFn,
  createInProcGraphRunner,
  type GraphResult,
  type InProcGraphRequest,
  type InProcRunnerOptions,
  type ToolExecFn,
} from "@cogni/shared-langgraph-graphs";
import { trace } from "@opentelemetry/api";
import type { Logger } from "pino";
import {
  getExecutionScope,
  resolveExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import type {
  AiExecutionErrorCode,
  CompletionFinalResult,
  ExecutionContext,
  GraphExecutorPort,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
  LlmToolDefinition,
  Message,
} from "@/ports";
import { EVENT_NAMES, makeLogger } from "@/shared/observability";

import type { CompletionUnitParams } from "../inproc-completion-unit.adapter";

import type { LangGraphCatalog } from "./catalog";

/**
 * Provider ID for LangGraph in-process execution.
 */
export const LANGGRAPH_PROVIDER_ID = "langgraph" as const;

/**
 * Adapter interface for executing completion units.
 * Matches InProcCompletionUnitAdapter.executeCompletionUnit signature.
 */
export interface CompletionUnitAdapter {
  executeCompletionUnit(params: CompletionUnitParams): {
    stream: AsyncIterable<AiEvent>;
    final: Promise<CompletionFinalResult>;
  };
}

/**
 * Catalog entry shape (matches LangGraphCatalogEntry<CreateGraphFn>).
 * Per NODE_BUNDLE_IS_CANONICAL: tools referenced by ID, resolved from the injected node bundle.
 */
interface ProviderCatalogEntry {
  readonly program?: InProcRunnerOptions["program"];
  readonly principal?: string;
  readonly displayName: string;
  readonly description: string;
  readonly toolIds: readonly string[];
  readonly mcpServerIds?: readonly string[];
  readonly graphFactory: CreateGraphFn;
  readonly systemPrompt?: string;
}

/**
 * LangGraph in-process provider.
 *
 * Routes graph execution to package runner (createInProcGraphRunner).
 * All LangChain logic is in the package — this provider is LangChain-free.
 *
 * Per GRAPH_LLM_VIA_COMPLETION: all LLM calls go through adapter.executeCompletionUnit
 * for billing/telemetry centralization.
 *
 * Note: Discovery (listAgents) is in LangGraphInProcAgentCatalogProvider.
 */
export class LangGraphInProcProvider implements GraphExecutorPort {
  readonly providerId = LANGGRAPH_PROVIDER_ID;
  private readonly log: Logger;
  private readonly catalog: LangGraphCatalog<CreateGraphFn>;
  private readonly boundToolMap: ReadonlyMap<string, CatalogBoundTool>;

  constructor(
    private readonly adapter: CompletionUnitAdapter,
    private readonly toolSource: ToolSourcePort,
    private readonly getMcpToolSource: () => Promise<ToolSourcePort | null> = () =>
      Promise.resolve(null),
    nodeBundle: readonly CatalogBoundTool[] = [],
    private readonly identity: {
      readonly resolvePrincipal: (slug: string) => Promise<string | null>;
      readonly publishedToolIds: readonly string[];
      readonly guardDeps?: Omit<GuardDeps, "runAs">;
    } = { resolvePrincipal: async () => null, publishedToolIds: [] },
  ) {
    this.log = makeLogger({ component: "LangGraphInProcProvider" });
    this.boundToolMap = new Map(nodeBundle.map((bt) => [bt.contract.name, bt]));

    // Use catalog from package (single source of truth)
    this.catalog = LANGGRAPH_CATALOG as LangGraphCatalog<CreateGraphFn>;

    this.log.debug(
      {
        graphCount: Object.keys(this.catalog).length,
        graphs: Object.keys(this.catalog),
      },
      "LangGraphInProcProvider initialized",
    );
  }

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const { runId, messages, modelRef, graphId } = req;
    const model = modelRef.modelId;
    const scope = getExecutionScope();
    const requestId = ctx?.requestId ?? req.runId;

    // Extract graph name from graphId (e.g., "langgraph:poet" → "poet")
    const graphName = this.extractGraphName(graphId);
    if (!graphName) {
      this.log.error({ runId, graphId }, "Invalid graphId format");
      // Client error: malformed graphId
      return this.createErrorResult(runId, requestId, "invalid_request");
    }

    const entry = this.catalog[graphName] as ProviderCatalogEntry | undefined;
    if (!entry) {
      this.log.error({ runId, graphName }, "Graph not found in catalog");
      // Client error: graph doesn't exist
      return this.createErrorResult(runId, requestId, "not_found");
    }

    this.log.debug(
      { runId, graphName, model, messageCount: messages.length },
      "LangGraphInProcProvider.runGraph routing to package runner",
    );

    // Create completion function wrapping adapter
    const completionFn = this.createCompletionFn(req);

    // P0 Contract: undefined => catalog default, [] => deny-all, [...] => exact
    const catalogToolIds = entry.toolIds;
    const toolIds: readonly string[] = req.toolIds ?? catalogToolIds;
    if (req.toolIds === undefined) {
      this.log.debug(
        { runId, graphName, catalogToolIds },
        "toolIds undefined; using catalog default per P0 contract",
      );
    }

    // Resolve BoundToolRuntime from injected toolSource (per TOOL_SOURCE_RETURNS_BOUND_TOOL)
    // Per CAPABILITY_INJECTION: toolSource contains real implementations with I/O
    const runtimeTools: Record<string, BoundToolRuntime> = {};
    for (const toolId of catalogToolIds) {
      const runtime = this.toolSource.getBoundTool(toolId);
      if (runtime) {
        runtimeTools[toolId] = runtime;
      } else {
        this.log.error(
          { runId, graphName, toolId },
          "Tool not found in toolSource; graph misconfigured",
        );
      }
    }

    // Resolve MCP tools if this graph declares mcpServerIds.
    // getMcpToolSource() is async (shared cache with reconnect-on-error),
    // so we wrap the graph execution in a promise and stream from it.
    const mcpServerIds = entry.mcpServerIds ?? [];

    // Async helper: resolve MCP tools then execute graph
    const resolveMcpAndExecute = async (): Promise<{
      stream: AsyncIterable<AiEvent>;
      final: Promise<GraphResult>;
    }> => {
      const runScope = await resolveExecutionScope(
        scope,
        entry.principal,
        this.identity.resolvePrincipal,
      );

      const mcpToolIds: string[] = [];
      if (mcpServerIds.length > 0) {
        const mcpToolSource = await this.getMcpToolSource();
        if (mcpToolSource) {
          for (const serverId of mcpServerIds) {
            for (const spec of mcpToolSource.listToolSpecs()) {
              if (spec.name.startsWith(`${serverId}__`)) {
                const runtime = mcpToolSource.getBoundTool(spec.name);
                if (runtime) {
                  runtimeTools[spec.name] = runtime;
                  mcpToolIds.push(spec.name);
                }
              }
            }
          }
          if (mcpToolIds.length > 0) {
            this.log.debug(
              {
                runId,
                graphName,
                mcpServerIds,
                mcpToolCount: mcpToolIds.length,
              },
              "Resolved MCP tools for graph",
            );
          }
        }
      }

      const controller = new AbortController();
      const runSignal = scope.abortSignal
        ? AbortSignal.any([scope.abortSignal, controller.signal])
        : controller.signal;
      let denial: TerminalDenial | undefined;
      const guardScope = {
        principalId: runScope.principalId,
        subjectUserId: runScope.subjectUserId,
        payer: runScope.billing.billingAccountId,
        runId,
        // A payer is never account authority. No account-kind tools are admitted
        // until the launcher supplies an independently resolved account.
      };
      const requiresById = buildRequiresById(
        [...this.boundToolMap.values()].map(({ contract }) => ({
          id: contract.name,
          ...("requires" in contract ? { requires: contract.requires } : {}),
        })),
      );
      const guardDeps: GuardDeps = {
        ...(this.identity.guardDeps ?? {
          withStore: async () => {
            throw new Error("agent_authority_unavailable");
          },
          adminCheck: async () => "unavailable" as const,
        }),
        runAs: (_identity, fn) => runInScope(runScope, fn),
        onTerminalDenial: (receipt) => {
          denial ??= receipt;
          controller.abort(
            new ToolAuthorityError(receipt.code, receipt.tool, null),
          );
        },
      };
      // MCP has no permission declarations yet. It is never admitted, even if
      // a transport labels an MCP tool read_only.
      const nativeRuntimes = Object.fromEntries(
        Object.entries(runtimeTools).filter(([id]) => !mcpToolIds.includes(id)),
      );
      const guarded = guardTools(
        nativeRuntimes,
        requiresById,
        guardScope,
        guardDeps,
      );
      const eligible = await offeredToolIds(
        Object.values(nativeRuntimes),
        requiresById,
        guardScope,
        guardDeps,
      );
      const offered = eligible.offered.filter((id) => toolIds.includes(id));
      const allToolIds = toolIds.filter((id) => catalogToolIds.includes(id));
      const catalogTools = offered
        .map((id) => this.boundToolMap.get(id))
        .filter((bt): bt is NonNullable<typeof bt> => bt !== undefined);

      // Create tool execution function factory
      // Policy allowlist includes both native and MCP tool IDs
      const createToolExecFn = (emit: (e: AiEvent) => void): ToolExecFn => {
        const policy = createToolAllowlistPolicy(allToolIds);
        const source = createStaticToolSourceFromRecord(guarded);
        const toolRunner = createToolRunner(source, emit, {
          policy,
          ctx: { runId },
        });

        return async (name, args, toolCallId) => {
          if (denial) throw new ToolAuthorityError(denial.code, name, null);
          const result =
            toolCallId !== undefined
              ? await toolRunner.exec(name, args, {
                  modelToolCallId: toolCallId,
                })
              : await toolRunner.exec(name, args);
          if (!result.ok) {
            this.log.warn(
              {
                event: EVENT_NAMES.AI_TOOL_CALL_ERROR,
                runId,
                graphName,
                tool: name,
                errorCode: result.errorCode,
                safeMessage: result.safeMessage.slice(0, 300),
              },
              "tool call failed",
            );
          }
          return result;
        };
      };

      const toolContracts = catalogTools
        .filter((bt): bt is PublishedCatalogBoundTool =>
          this.identity.publishedToolIds.includes(bt.contract.name),
        )
        .map((bt) => bt.contract);
      // The public JSON-schema seam is the product boundary. graphs0.11 drops
      // inputSchema here; activation waits for the package-owned repair.
      const productSpecs = catalogTools
        .filter(
          (bt) => !this.identity.publishedToolIds.includes(bt.contract.name),
        )
        .map((bt) => nativeRuntimes[bt.contract.name]?.spec)
        .filter((spec): spec is NonNullable<typeof spec> => spec !== undefined);

      const traceId =
        trace.getActiveSpan()?.spanContext().traceId ??
        "00000000000000000000000000000000";
      const runnerRequest: InProcGraphRequest = {
        runId,
        messages: messages as InProcGraphRequest["messages"],
        abortSignal: runSignal,
        ...(traceId !== undefined && { traceId }),
        ...(requestId !== undefined && { ingressRequestId: requestId }),
        configurable: {
          model,
          toolIds: offered,
          ...(runScope.principalId ? { actorId: runScope.principalId } : {}),
          ...(runScope.subjectUserId
            ? { subjectId: runScope.subjectUserId }
            : {}),
          tenantId: runScope.billing.billingAccountId,
          graphId,
        },
      };

      const result = createInProcGraphRunner({
        createGraph: entry.graphFactory,
        ...(entry.program
          ? { program: entry.program, trustedProgramId: entry.program }
          : {}),
        ...(runScope.principalId
          ? { trustedActorId: runScope.principalId }
          : {}),
        completionFn,
        createToolExecFn,
        toolContracts,
        ...(productSpecs.length ? { mcpToolSpecs: productSpecs } : {}),
        request: runnerRequest,
        ...(req.responseFormat !== undefined && {
          responseFormat: req.responseFormat,
        }),
        ...(entry.systemPrompt !== undefined && {
          systemPrompt: entry.systemPrompt,
        }),
      });
      const denialContent = () =>
        JSON.stringify({
          code: denial?.code,
          retryable: false,
          lookup: { tool: denial?.tool ?? null },
          message: "Tool permission denied.",
        });
      return {
        stream: (async function* () {
          for await (const event of result.stream) {
            if (denial) continue;
            yield event;
          }
          if (denial) {
            yield {
              type: "assistant_final" as const,
              content: denialContent(),
            };
            yield { type: "done" as const };
          }
        })(),
        final: result.final.then((final) =>
          denial
            ? {
                ok: true,
                content: denialContent(),
                ...(final.usage ? { usage: final.usage } : {}),
              }
            : final,
        ),
      };
    };

    // Execute: resolve MCP (if needed) then run graph.
    // Returns {stream, final} synchronously per GraphRunResult contract;
    // the inner async generator awaits the promise.
    const innerResult = resolveMcpAndExecute();

    const stream = (async function* () {
      let inner: Awaited<ReturnType<typeof resolveMcpAndExecute>>;
      try {
        inner = await innerResult;
      } catch {
        yield {
          type: "error" as const,
          error: "internal" as AiExecutionErrorCode,
        };
        yield { type: "done" as const };
        return;
      }
      yield* inner.stream;
    })();

    const final = innerResult.then(
      (r) => this.mapToGraphFinal(r.final, runId, requestId, graphName),
      () =>
        ({
          ok: false as const,
          runId,
          requestId,
          error: "internal",
        }) as const,
    );

    // mapToGraphFinal returns Promise<GraphFinal>, so final is Promise<Promise<GraphFinal> | GraphFinal>
    // Flatten with .then()
    const flatFinal = final.then((f) => f);

    return { stream, final: flatFinal };
  }

  /**
   * Extract graph name from namespaced graphId.
   * Per GRAPH_ID_NAMESPACED: "langgraph:poet" → "poet"
   */
  private extractGraphName(graphId: string): string | undefined {
    const prefix = `${this.providerId}:`;
    if (graphId.startsWith(prefix)) {
      return graphId.slice(prefix.length);
    }

    return undefined;
  }

  /**
   * Create completion function wrapping adapter.executeCompletionUnit.
   */
  private createCompletionFn(
    req: GraphRunRequest,
  ): CompletionFn<LlmToolDefinition> {
    const { runId, graphId } = req;
    const attempt = 0; // P0_ATTEMPT_FREEZE

    return (params: {
      messages: Message[];
      model: string;
      tools?: readonly LlmToolDefinition[];
      abortSignal?: AbortSignal;
    }) => {
      const result = this.adapter.executeCompletionUnit({
        messages: params.messages as GraphRunRequest["messages"],
        model: params.model,
        runContext: { runId, attempt, graphId },
        ...(params.abortSignal && { abortSignal: params.abortSignal }),
        ...(params.tools?.length && { tools: [...params.tools] }),
      });

      return {
        stream: result.stream,
        final: result.final.then((r) => {
          if (!r.ok) return { ok: false as const, error: r.error };
          return {
            ok: true as const,
            content: r.content ?? "",
            ...(r.toolCalls && { toolCalls: r.toolCalls }),
            ...(r.usage && { usage: r.usage }),
            ...(r.finishReason && { finishReason: r.finishReason }),
          };
        }),
      };
    };
  }

  /**
   * Map package GraphResult to port GraphFinal.
   * GraphResult.error is now AiExecutionErrorCode - direct passthrough.
   * Logs errors at adapter boundary for debugging.
   */
  private async mapToGraphFinal(
    final: Promise<GraphResult>,
    runId: string,
    requestId: string,
    graphName: string,
  ): Promise<GraphFinal> {
    const result = await final;

    if (!result.ok) {
      // Log error at adapter boundary (per OBSERVABILITY.md: adapter ERROR log)
      this.log.error(
        {
          runId,
          reqId: requestId,
          graphName,
          errorCode: result.error ?? "internal",
          errorMessage: result.errorMessage,
          event: EVENT_NAMES.ADAPTER_LANGGRAPH_INPROC_ERROR,
        },
        EVENT_NAMES.ADAPTER_LANGGRAPH_INPROC_ERROR,
      );

      // Direct passthrough - GraphResult.error is already AiExecutionErrorCode
      return { ok: false, runId, requestId, error: result.error ?? "internal" };
    }

    // Conditional spreads for exactOptionalPropertyTypes
    return {
      ok: true,
      runId,
      requestId,
      finishReason: "stop",
      ...(result.usage !== undefined && { usage: result.usage }),
      ...(result.content !== undefined && { content: result.content }),
      ...(result.structuredOutput !== undefined && {
        structuredOutput: result.structuredOutput,
      }),
    };
  }

  /**
   * Create error result for invalid requests.
   * Per ERROR_NORMALIZATION: details logged, stream gets code only.
   */
  private createErrorResult(
    runId: string,
    requestId: string,
    code: AiExecutionErrorCode = "internal",
  ): GraphRunResult {
    const errorStream = (async function* () {
      yield { type: "error" as const, error: code };
      yield { type: "done" as const };
    })();

    return {
      stream: errorStream,
      final: Promise.resolve({
        ok: false as const,
        runId,
        requestId,
        error: code,
      }),
    };
  }
}
