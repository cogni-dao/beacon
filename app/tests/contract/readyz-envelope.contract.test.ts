// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Real readiness logging envelope: writes enqueue even at the old flush threshold. */
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ container: vi.fn() }));
vi.mock("@/bootstrap/container", () => ({ getContainer: calls.container }));
vi.mock("@/bootstrap/local-readiness-preflight", () => ({
  localReadinessPreflight: () => ({ APP_BUILD_SHA: "readyz-envelope-sha" }),
}));
vi.mock("@/shared/config", async (original) => ({
  ...(await original<typeof import("@/shared/config")>()),
  getNodeId: () => "readyz-envelope-node",
}));

import { GET } from "@/app/(infra)/readyz/route";
import { getLokiPushStream } from "@/shared/observability/server/loki-push-stream";

const globalSink = globalThis as typeof globalThis & {
  __cogniLokiPushStream?: unknown;
  __cogniLokiPushInit?: boolean;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete globalSink.__cogniLokiPushStream;
  delete globalSink.__cogniLokiPushInit;
  vi.useRealTimers();
});

describe("readiness envelope", () => {
  it("queues request logs without triggering a Loki push", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PINO_LOG_LEVEL", "info");
    vi.stubEnv("LOKI_PUSH_URL", "https://logs.invalid/push");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    delete globalSink.__cogniLokiPushStream;
    delete globalSink.__cogniLokiPushInit;
    const sink = getLokiPushStream();
    expect(sink).toBeDefined();
    for (let i = 0; i < 499; i++) sink?.write('{"msg":"buffered"}\n');
    const response = await GET(new Request("http://localhost/readyz"));
    expect(response.status).toBe(200);
    expect(calls.container).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    sink?.flushNow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
