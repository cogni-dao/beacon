// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/ActivityPriorityQueue`
 * Purpose: Compact sortable/filterable priority queue for research-backed
 *   Beacon activities. Reuses the same ReUI DataGrid pattern as `/work`.
 * Scope: Client presentation only. Reads metadata already mapped by the server
 *   facade; no fetching or mutation.
 * Invariants:
 *   - TABLE_PATTERN_REUSED: TanStack + ReUI DataGrid, dense layout, header sort/filter.
 *   - STORAGE_NAME_HIDDEN: product copy says activity priorities, not post-priority rows.
 * Side-effects: none
 * @internal
 */

"use client";

import type { CampaignPostPriority } from "@/app/_facades/growth/campaigns.server";
import { HeaderFilter } from "@cogni/node-ui-kit/header-filter";
import {
  DataGrid,
  DataGridContainer,
} from "@cogni/node-ui-kit/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@cogni/node-ui-kit/reui/data-grid/data-grid-column-header";
import { DataGridTable } from "@cogni/node-ui-kit/reui/data-grid/data-grid-table";
import {
  createColumnHelper,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

type PriorityRow = CampaignPostPriority;

const col = createColumnHelper<PriorityRow>();

function compact(value: string, max = 130): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function metadata(row: PriorityRow): Record<string, unknown> {
  return row.metadata ?? {};
}

function metaString(row: PriorityRow, key: string): string | null {
  const value = metadata(row)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function metaNumber(row: PriorityRow, key: string): number | null {
  const value = metadata(row)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaStringArray(row: PriorityRow, key: string): string[] {
  const value = metadata(row)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function activityType(row: PriorityRow): string {
  return metaString(row, "activityType") ?? "activity";
}

function targetSurface(row: PriorityRow): string {
  return metaString(row, "targetSurface") ?? row.topic ?? row.funnelLayer;
}

function expectedImpact(row: PriorityRow): number {
  return Math.round(metaNumber(row, "expectedImpact") ?? row.score * 100);
}

function ease(row: PriorityRow): number {
  return Math.round(metaNumber(row, "ease") ?? 50);
}

function capabilityStatus(row: PriorityRow): string {
  return metaString(row, "capabilityStatus") ?? row.status;
}

function evidenceCount(row: PriorityRow): number {
  const sourceRefs = metaStringArray(row, "sourceRefs");
  if (sourceRefs.length > 0) return sourceRefs.length;
  return metaStringArray(row, "evidenceBasis").length;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

const columns = [
  col.accessor("rank", {
    header: ({ column }) => <DataGridColumnHeader column={column} title="Pri" />,
    size: 52,
    cell: (info) => (
      <span className="inline-flex w-7 justify-center rounded-md bg-muted px-1.5 py-0.5 font-medium text-xs">
        {info.getValue()}
      </span>
    ),
    sortingFn: (a, b) => a.original.rank - b.original.rank,
    meta: { headerTitle: "Pri" },
  }),
  col.accessor((row) => activityType(row), {
    id: "activity",
    header: ({ column }) => (
      <DataGridColumnHeader
        column={column}
        title="Activity"
        filter={<HeaderFilter column={column} formatLabel={formatLabel} />}
      />
    ),
    minSize: 260,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5 py-1">
        <span className="line-clamp-1 text-sm">
          {compact(row.original.premise, 120)}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatLabel(activityType(row.original))}
        </span>
      </div>
    ),
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Activity" },
  }),
  col.accessor((row) => targetSurface(row), {
    id: "surface",
    header: ({ column }) => (
      <DataGridColumnHeader
        column={column}
        title="Surface"
        filter={<HeaderFilter column={column} formatLabel={formatLabel} />}
      />
    ),
    size: 120,
    cell: ({ row }) => (
      <span className="truncate text-muted-foreground text-xs">
        {formatLabel(targetSurface(row.original))}
      </span>
    ),
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Surface" },
  }),
  col.accessor((row) => expectedImpact(row), {
    id: "impact",
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Impact" />
    ),
    size: 78,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums">{expectedImpact(row.original)}</span>
    ),
    sortingFn: (a, b) => expectedImpact(a.original) - expectedImpact(b.original),
    meta: { headerTitle: "Impact" },
  }),
  col.accessor((row) => ease(row), {
    id: "ease",
    header: ({ column }) => <DataGridColumnHeader column={column} title="Ease" />,
    size: 64,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums">{ease(row.original)}</span>
    ),
    sortingFn: (a, b) => ease(a.original) - ease(b.original),
    meta: { headerTitle: "Ease" },
  }),
  col.accessor((row) => metaString(row, "blockedBy") ?? capabilityStatus(row), {
    id: "status",
    header: ({ column }) => (
      <DataGridColumnHeader
        column={column}
        title="Status"
        filter={<HeaderFilter column={column} formatLabel={formatLabel} />}
      />
    ),
    size: 110,
    cell: ({ row }) => {
      const status = capabilityStatus(row.original);
      const blockedBy = metaString(row.original, "blockedBy");
      return (
        <span className="text-muted-foreground text-xs">
          {formatLabel(blockedBy ?? status)}
        </span>
      );
    },
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Status" },
  }),
  col.accessor((row) => evidenceCount(row), {
    id: "evidence",
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Evidence" />
    ),
    size: 82,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-xs tabular-nums">
        {evidenceCount(row.original)}
      </span>
    ),
    sortingFn: (a, b) => evidenceCount(a.original) - evidenceCount(b.original),
    meta: { headerTitle: "Evidence" },
  }),
];

export function ActivityPriorityQueue({
  priorities,
}: {
  priorities: CampaignPostPriority[];
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "rank", desc: false },
  ]);
  const data = useMemo(() => priorities, [priorities]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <div className="grid gap-2 rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-sm">Activity priorities</p>
        <span className="text-muted-foreground text-xs">
          {priorities.length} queued
        </span>
      </div>
      <DataGrid
        table={table}
        recordCount={priorities.length}
        tableLayout={{
          headerSticky: false,
          headerBackground: true,
          rowBorder: true,
          dense: true,
        }}
        tableClassNames={{
          bodyRow: "align-top",
        }}
        emptyMessage="No activity priorities yet."
      >
        <DataGridContainer className="overflow-x-auto">
          <DataGridTable />
        </DataGridContainer>
      </DataGrid>
    </div>
  );
}
