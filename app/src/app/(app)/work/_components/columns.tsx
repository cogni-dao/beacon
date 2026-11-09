// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/_components/columns`
 * Purpose: Binds the published work column set from `@cogni/knowledge-base-ui` to this node's `WorkItemSummary` (task.0044, task.0056).
 * Scope: Adapter only. Column definitions, header sort/filter controls and cells live in the package.
 * Invariants: HEADER_OWNS_SORT_AND_FILTER — inherited from the package columns.
 * Side-effects: none
 * Links: task.0044
 * @internal
 */

"use client";

import { createWorkItemColumns, scoreQueue } from "@cogni/knowledge-base-ui";
import type { WorkItemSummary } from "@cogni/node-contracts";
import { rankScore } from "@cogni/work-items";

// Beacon keeps its queue tooltip on the rank cell; everything else is the package column set.
// Summaries carry `scores`, not `rankScore`: the rank comes from the same `rankScore(scores)` the package column sorts by.
export const columns = createWorkItemColumns<WorkItemSummary>().map((column) =>
  column.id === "rankScore"
    ? {
        ...column,
        cell: ({ row }: { row: { original: WorkItemSummary } }) => {
          const rank = rankScore(row.original.scores);
          return rank !== undefined ? (
            <span title={`${scoreQueue(row.original.scores)} queue`}>
              {rank.toFixed(2)}
            </span>
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          );
        },
      }
    : column
);
