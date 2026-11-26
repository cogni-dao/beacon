// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/** Retired content deletion. Use a revision-checked PATCH to cancelled with a reason. */
import { z } from "zod";

export const workItemsDeleteOperation = {
  id: "work.items.delete.v1",
  summary: "Work item deletion is retired",
  description:
    "Returns HTTP 410. Read the current revision, then cancel through PATCH with a reason.",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    error: z.string(),
    errorCode: z.literal("work_item_delete_removed"),
  }),
} as const;

export type WorkItemsDeleteInput = z.infer<
  typeof workItemsDeleteOperation.input
>;
export type WorkItemsDeleteOutput = z.infer<
  typeof workItemsDeleteOperation.output
>;
