// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Real released runner/model definitions and the actual Beacon launch boundary. */

import type { AgentGrantsStore } from "@cogni/agent-grants";
import {
  knowledgeWriteContract,
  toBoundToolRuntime as sharedRuntime,
} from "@cogni/ai-tools";
import {
  type CatalogBoundTool,
  CORE_TOOL_BUNDLE,
  toBoundToolRuntime,
} from "@cogni/beacon-ai-tools";
import type { CreateGraphFn } from "@cogni/shared-langgraph-graphs";
import { createInProcGraphRunner } from "@cogni/shared-langgraph-graphs";
import { describe, expect, it, vi } from "vitest";
import {
  getExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import { LangGraphInProcProvider } from "@/adapters/server/ai/langgraph/inproc.provider";

const ledger = vi.hoisted(() => ({ getRunByRunId: vi.fn() }));
vi.mock("@/bootstrap/container", () => ({
  getContainer: () => ({ graphRunRepository: ledger }),
}));
vi.mock("@/bootstrap/agent-authority", () => ({
  resolveAgentAuthority: vi.fn(),
}));
vi.mock("@/adapters/server", () => ({}));
const catalog = vi.hoisted(() => ({ entries: {} as Record<string, unknown> }));
vi.mock("@cogni/node-template-graphs", () => ({
  LANGGRAPH_CATALOG: catalog.entries,
}));
vi.mock("@cogni/langgraph-graphs", () => ({}));

import { runGraphWithScope } from "@/bootstrap/graph-executor.factory";

const request = {
  runId: "run-1",
  graphId: "langgraph:brain" as const,
  modelRef: { providerKey: "platform", modelId: "test" },
  messages: [],
};
const billing = { billingAccountId: "payer", virtualKeyId: "key" };

describe("durable launch admission", () => {
  const valid = {
    runId: "run-1",
    graphId: request.graphId,
    runKind: "user_immediate",
    requestedBy: "human",
  };
  const launch = (actorUserId?: string) => {
    const executor = {
      runGraph: vi.fn(() => {
        const scope = getExecutionScope();
        return {
          stream: (async function* () {})(),
          final: Promise.resolve({
            ok: true,
            runId: request.runId,
            requestId: request.runId,
            content: JSON.stringify(scope),
          }),
        };
      }),
    };
    const result = runGraphWithScope({
      executor,
      req: request,
      ...(actorUserId ? { ctx: { actorUserId } } : {}),
      billing,
      llmService: {} as never,
      usageSource: "litellm",
    });
    return { executor, result };
  };
  it.each([
    null,
    { ...valid, graphId: "langgraph:other" },
    { ...valid, runKind: null },
    { ...valid, requestedBy: null },
  ])("rejects incomplete or mismatched durable facts (%j)", async (run) => {
    ledger.getRunByRunId.mockResolvedValue(run);
    const { executor, result } = launch();
    await expect(result.final).rejects.toThrow();
    expect(executor.runGraph).not.toHaveBeenCalled();
  });
  it("does not swallow ledger outages or caller mismatches", async () => {
    ledger.getRunByRunId.mockRejectedValueOnce(new Error("ledger offline"));
    const unavailable = launch();
    await expect(unavailable.result.final).rejects.toThrow("ledger offline");
    expect(unavailable.executor.runGraph).not.toHaveBeenCalled();
    ledger.getRunByRunId.mockResolvedValue(valid);
    const forged = launch("other");
    await expect(forged.result.final).rejects.toThrow("requester_mismatch");
    expect(forged.executor.runGraph).not.toHaveBeenCalled();
  });
  it.each([
    "user_immediate",
    "system_scheduled",
    "system_webhook",
  ])("binds stored facts for %s, including same-run retry", async (runKind) => {
    const requestedBy = runKind === "system_webhook" ? null : "human";
    ledger.getRunByRunId.mockResolvedValue({ ...valid, runKind, requestedBy });
    for (let retry = 0; retry < 2; retry++) {
      const { result } = launch(requestedBy ?? undefined);
      const final = await result.final;
      expect(JSON.parse(final.content ?? "{}")).toMatchObject({
        runId: "run-1",
        graphId: request.graphId,
        runKind,
      });
      expect(JSON.parse(final.content ?? "{}").subjectUserId).toBe(
        requestedBy ?? undefined,
      );
    }
  });
});

it.fails("UPSTREAM graphs0.11: preserves every actual product input schema in model-facing tools", async () => {
  const specs = CORE_TOOL_BUNDLE.map((tool) => toBoundToolRuntime(tool).spec);
  let modelTools: readonly {
    type: string;
    function: { name: string; parameters: unknown };
  }[] = [];
  const factory: CreateGraphFn = (options) => ({
    invoke: async (input, config) => {
      // The same bindTools conversion used by released production graphs.
      const llm = options.llm;
      if (!("bindTools" in llm) || typeof llm.bindTools !== "function")
        throw new Error("missing bindTools");
      await llm.bindTools([...options.tools]).invoke(input.messages, config);
      return { messages: [] };
    },
  });
  const run = createInProcGraphRunner({
    createGraph: factory,
    toolContracts: [],
    mcpToolSpecs: specs,
    createToolExecFn: () => async () => {
      throw new Error("schema test must not execute tools");
    },
    completionFn: (params) => {
      modelTools = params.tools as typeof modelTools;
      return {
        stream: (async function* () {})(),
        final: Promise.resolve({ ok: true, content: "done" }),
      };
    },
    request: {
      runId: "schemas",
      messages: [],
      configurable: { model: "test", toolIds: specs.map((c) => c.name) },
    },
  });
  for await (const _event of run.stream) {
    /* drain */
  }
  expect(await run.final).toMatchObject({ ok: true });
  expect(modelTools).toHaveLength(CORE_TOOL_BUNDLE.length);
  for (const tool of CORE_TOOL_BUNDLE) {
    const expected = toBoundToolRuntime(tool).spec.inputSchema;
    const actual = modelTools.find(
      (entry) => entry.function.name === tool.contract.name,
    )?.function.parameters;
    expect.soft(actual, tool.contract.name).toMatchObject({
      properties: expected.properties,
      ...(expected.required ? { required: expected.required } : {}),
    });
  }
  const broadcast = modelTools.find(
    (entry) => entry.function.name === "core__broadcast_post",
  )?.function.parameters;
  expect(broadcast).toMatchObject({
    required: ["accountId", "campaignId", "ideaKey", "variants"],
    properties: {
      variants: {
        items: {
          required: ["channel", "text", "funnelLayer", "topic", "kind"],
        },
      },
    },
  });
});

// The catalog factory is a node product extension; guard execution still passes
// through the real released runner and actual provider's toolRunner.

describe("actual provider authority composition", () => {
  const writeArgs = {
    id: "fixture-entry",
    domain: "meta",
    title: "Fixture",
    content: "Fixture",
    sourceType: "derived",
  };
  async function run(options: {
    live?: boolean;
    admin?: boolean;
    revoke?: boolean;
    outage?: boolean;
  }) {
    let live = options.live ?? true;
    const execute = vi.fn().mockResolvedValue({
      entry: {
        id: "fixture-entry",
        domain: "meta",
        title: "Fixture",
        confidencePct: null,
        sourceType: "derived",
        tags: null,
      },
      committed: true,
      message: "saved",
    });
    const bound = {
      contract: knowledgeWriteContract,
      implementation: { execute },
    };
    const runtime = sharedRuntime(bound);
    const shown: string[] = [];
    const factory: CreateGraphFn = (opts) => ({
      invoke: async (_input, config) => {
        shown.push(...opts.tools.map((tool) => tool.name));
        if (options.revoke) live = false;
        const tool = opts.tools[0];
        if (tool) await tool.invoke(writeArgs, config);
        return { messages: [] };
      },
    });
    catalog.entries.fixture = {
      principal: "node-ai",
      displayName: "Fixture",
      description: "Fixture",
      toolIds: [knowledgeWriteContract.name],
      graphFactory: factory,
    };
    const store = {
      liveScopes: async () => (live ? ["knowledge:write"] : []),
      hasLiveRole: async () => live,
    } as unknown as AgentGrantsStore;
    const source = {
      getBoundTool: () => runtime,
      listToolSpecs: () => [runtime.spec],
      hasToolId: () => true,
    };
    const provider = new LangGraphInProcProvider(
      {
        executeCompletionUnit: () => {
          throw new Error("no LLM needed");
        },
      },
      source,
      async () => null,
      [bound as unknown as CatalogBoundTool],
      {
        resolvePrincipal: async () => "stored-node-ai",
        publishedToolIds: [knowledgeWriteContract.name],
        guardDeps: {
          withStore: async (fn) => {
            if (options.outage) throw new Error("SQL offline");
            return fn(store);
          },
          adminCheck: async () => (options.admin ? "allow" : "denied"),
        },
      },
    );
    const result = runInScope(
      {
        billing,
        llmService: {} as never,
        usageSource: "litellm",
        subjectUserId: "human",
        runId: "run-1",
        runKind: "user_immediate",
      },
      () => provider.runGraph({ ...request, graphId: "langgraph:fixture" }),
    );
    const events = [];
    for await (const event of result.stream) events.push(event);
    return { execute, shown, events, final: await result.final };
  }
  it("withholds zero-role and unavailable tools", async () => {
    for (const options of [{ live: false }, { outage: true }]) {
      const result = await run(options);
      expect(result.shown).toEqual([]);
      expect(result.execute).not.toHaveBeenCalled();
    }
  });
  it.each([
    { admin: false },
    { admin: true, revoke: true },
  ])("exec denial is terminal and never writes (%j)", async (options) => {
    const result = await run(options);
    expect(result.shown).toEqual([knowledgeWriteContract.name]);
    expect(result.execute).not.toHaveBeenCalled();
    expect(result.final).toMatchObject({ ok: true });
    expect(JSON.parse(result.final.content ?? "{}")).toMatchObject({
      code: "policy_denied",
      retryable: false,
    });
    expect(result.events.filter((event) => event.type === "done")).toHaveLength(
      1,
    );
  });
  it("runs only with the principal role and approving subject check", async () => {
    const result = await run({ live: true, admin: true });
    expect(result.execute).toHaveBeenCalledOnce();
    expect(result.final).toMatchObject({ ok: true });
  });
});
