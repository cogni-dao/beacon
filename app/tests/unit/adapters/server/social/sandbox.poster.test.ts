// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/** Unit tests for SandboxPoster — deterministic fake "send", no network. */

import { describe, expect, it } from "vitest";
import { SandboxPoster } from "@/adapters/server/social/sandbox.poster";

describe("SandboxPoster.post", () => {
  it("records a post deterministically (idempotent externalId)", async () => {
    const poster = new SandboxPoster("resolved-token");
    const a = await poster.post("hello world");
    const b = await poster.post("hello world");
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^sandbox-[0-9a-f]{12}$/);
    expect(a.text).toBe("hello world");
    expect(typeof a.postedAt).toBe("string");
  });

  it("produces distinct ids for distinct text", async () => {
    const poster = new SandboxPoster("resolved-token");
    const a = await poster.post("first");
    const b = await poster.post("second");
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("varies the id by resolved token (per-tenant isolation of the fake id)", async () => {
    const a = await new SandboxPoster("token-a").post("same");
    const b = await new SandboxPoster("token-b").post("same");
    expect(a.externalId).not.toBe(b.externalId);
  });
});
