// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0

/**
 * /.well-known/agent.json projects each work-item operation with `z.toJSONSchema`. A `z.custom` or transform in one
 * of them made the whole discovery document a 500 (beacon, before task.0149). Every operation it lists must convert.
 */

import {
  workItemsArtifactGetOperation,
  workItemsArtifactsCreateOperation,
  workItemsArtifactsListOperation,
  workItemsCreateOperation,
  workItemsGetOperation,
  workItemsPatchOperation,
} from "@cogni/node-contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("work-item operations project to JSON Schema", () => {
  it.each([
    ["create", workItemsCreateOperation],
    ["get", workItemsGetOperation],
    ["patch", workItemsPatchOperation],
    ["artifacts.create", workItemsArtifactsCreateOperation],
    ["artifacts.list", workItemsArtifactsListOperation],
    ["artifacts.get", workItemsArtifactGetOperation],
  ] as const)("%s", (_name, operation) => {
    expect(() => z.toJSONSchema(operation.input)).not.toThrow();
    expect(() => z.toJSONSchema(operation.output)).not.toThrow();
  });
});
