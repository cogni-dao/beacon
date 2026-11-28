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

it("preserves every actual product input schema in model-facing tools", async () => {
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

describe("Beacon product permissions", () => {
  it("passes the released route parity rules over Beacon's actual composed tools", async () => {
    const { BEACON_CORE_TOOL_BUNDLE } = await import("@/bootstrap/ai/evaluation-baseline");
    const { nodeExtensions } = await import("@/node-extensions");
    const { composeAgentRoutes } = await import("@cogni/agent-grants");
    const { SAME_DOOR_PARITY_RULES } = await import("@cogni/agent-grants/same-door-parity");
    const contracts = BEACON_CORE_TOOL_BUNDLE.map(t => t.contract);
    const routes = composeAgentRoutes(nodeExtensions.routes);
    for (const rule of SAME_DOOR_PARITY_RULES) {
      expect(rule.violations(contracts, routes, { absentBaseline: ["core__sandbox_shell", "core__account_credits_read"] }), rule.name).toEqual([]);
    }
  });

  it("declares every actual write and preserves grandfathered ids", async () => {
    const { BEACON_CORE_TOOL_BUNDLE } = await import(
      "@/bootstrap/ai/evaluation-baseline"
    );
    const { buildRequiresById, buildPermissionCatalog } = await import(
      "@cogni/agent-grants/host"
    );
    const requires = buildRequiresById(
      BEACON_CORE_TOOL_BUNDLE.map(({ contract }) => ({
        id: contract.name,
        requires: contract.requires,
      })),
    );
    for (const { contract } of BEACON_CORE_TOOL_BUNDLE) {
      if (contract.effect !== "read_only")
        expect(requires[contract.name], contract.name).toBeDefined();
    }
    expect(requires.core__broadcast_post).toMatchObject({
      scope: "beacon.broadcast:write",
      kind: "account",
      subject: "member",
    });
    expect(requires.core__schedule_manage).toMatchObject({
      scope: "schedule:manage",
      kind: "own",
      subject: "member",
    });
    expect(
      buildPermissionCatalog(requires).scopeKinds["beacon.broadcast:write"],
    ).toBe("account");
  });

  async function broadcast(
    options: {
      grant?: boolean;
      revoked?: boolean;
      account?: string | null;
      target?: string;
      ownerChanged?: boolean;
      outage?: boolean;
      ownerOutage?: boolean;
      subject?: string | null;
    } = {},
  ) {
    const actual = await vi.importActual<
      typeof import("@cogni/node-template-graphs")
    >("@cogni/node-template-graphs");
    const { BEACON_CORE_TOOL_BUNDLE } = await import(
      "@/bootstrap/ai/evaluation-baseline"
    );
    const product = BEACON_CORE_TOOL_BUNDLE.find(
      (t) => t.contract.name === "core__broadcast_post",
    );
    if (!product) throw new Error("actual broadcast missing");
    const execute = vi.fn().mockResolvedValue({ ideaKey: "idea", results: [] });
    const { createBroadcastPostImplementation } = await import(
      "@cogni/beacon-ai-tools"
    );
    const bound = {
      ...product,
      implementation: createBroadcastPostImplementation({
        broadcastCapability: { broadcast: execute },
      }),
    };
    const runtime = toBoundToolRuntime(bound as never);
    const shown: string[] = [];
    let grant = options.grant ?? true;
    const factory: CreateGraphFn = (opts) => ({
      invoke: async (_input, config) => {
        shown.push(...opts.tools.map((t) => t.name));
        if (options.revoked) grant = false;
        const tool = opts.tools.find((t) => t.name === product.contract.name);
        if (tool)
          await tool.invoke(
            {
              accountId: options.target ?? "owned",
              campaignId: "campaign",
              ideaKey: "idea",
              variants: [
                {
                  channel: "x",
                  text: "post",
                  funnelLayer: "tofu",
                  topic: "ownership",
                  kind: "text",
                },
              ],
            },
            config,
          );
        return { messages: [] };
      },
    });
    // Keep the actual content catalog's tool list and principal. Only the graph
    // body is deterministic so this test exercises the real host execution seam.
    catalog.entries.content = {
      ...actual.LANGGRAPH_CATALOG.content,
      graphFactory: factory,
    };
    expect(actual.LANGGRAPH_CATALOG.content?.principal).toBe("node-ai");
    const accountOf = vi.fn(async (subject: string) =>
      subject === "human"
        ? options.account === undefined
          ? "owned"
          : options.account
        : null,
    );
    const store = {
      accountOf,
      liveScopes: async () => [],
      ownsAccount: async (subject: string, account: string) => {
        if (options.ownerOutage) throw new Error("owner read unavailable");
        return (
          subject === "human" && account === "owned" && !options.ownerChanged
        );
      },
      liveAccountScopes: async (
        principal: string,
        scopes: readonly string[],
        account: string,
      ) =>
        principal === "stored-node-ai" && account === "owned" && grant
          ? [...scopes]
          : [],
      hasLiveAccountGrant: async (
        principal: string,
        scope: string,
        account: string,
      ) =>
        principal === "stored-node-ai" &&
        scope === "beacon.broadcast:write" &&
        account === "owned" &&
        grant,
    } as unknown as AgentGrantsStore;
    const provider = new LangGraphInProcProvider(
      {
        executeCompletionUnit: () => {
          throw new Error("no model needed");
        },
      },
      {
        getBoundTool: (id) => (id === runtime.id ? runtime : undefined),
        listToolSpecs: () => [runtime.spec],
        hasToolId: (id) => id === runtime.id,
      },
      async () => null,
      [bound as CatalogBoundTool],
      {
        resolvePrincipal: async () => "stored-node-ai",
        publishedToolIds: [],
        guardDeps: {
          withStore: async (fn) => {
            if (options.outage) throw new Error("SQL unavailable");
            return fn(store);
          },
          adminCheck: async () => "denied",
        },
      },
    );
    const subjectUserId =
      options.subject === undefined ? "human" : options.subject;
    const result = runInScope(
      {
        billing,
        llmService: {} as never,
        usageSource: "litellm",
        ...(subjectUserId ? { subjectUserId } : {}),
        runId: request.runId,
        runKind: "user_immediate",
      },
      () => provider.runGraph({ ...request, graphId: "langgraph:content" }),
    );
    for await (const _event of result.stream) {
      /* drain */
    }
    return { execute, shown, accountOf, final: await result.final };
  }

  it("offers and executes broadcast for the actual owner and approved principal, independently of payer", async () => {
    const result = await broadcast();
    expect(result.accountOf).toHaveBeenCalledWith("human");
    expect(result.shown).toEqual(["core__broadcast_post"]);
    expect(result.execute).toHaveBeenCalledOnce();
    expect(result.execute.mock.calls[0]?.[0].accountId).toBe("owned");
    expect(result.final.ok).toBe(true);
  });
  it.each([{ grant: false }, { account: null }, { subject: null }])(
    "withholds broadcast without its actual authority (%j)",
    async (options) => {
      const result = await broadcast(options);
      expect(result.shown).toEqual([]);
      expect(result.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    { revoked: true },
    { target: "foreign" },
    { target: "payer" },
    { ownerChanged: true },
  ])(
    "forced execution cannot cross the account or revoked-grant lock (%j)",
    async (options) => {
      const result = await broadcast(options);
      expect(result.shown).toEqual(["core__broadcast_post"]);
      expect(result.execute).not.toHaveBeenCalled();
      expect(JSON.parse(result.final.content ?? "{}")).toMatchObject({
        code: "policy_denied",
        retryable: false,
      });
    },
  );
  it("returns a terminal unavailable receipt when the exec owner check fails", async () => {
    const result = await broadcast({ ownerOutage: true });
    expect(result.shown).toEqual(["core__broadcast_post"]);
    expect(result.execute).not.toHaveBeenCalled();
    expect(JSON.parse(result.final.content ?? "{}")).toMatchObject({
      code: "authz_unavailable",
      retryable: false,
    });
  });
  it("never executes during an owner-store outage", async () => {
    const result = await broadcast({ outage: true });
    expect(result.execute).not.toHaveBeenCalled();
  });
});
