// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/loading`
 * Purpose: Per-route Suspense fallback for `/growth`. Mirrors the lens —
 *   header + responsive card grid skeleton.
 * Scope: Server component, layout-preserving inside `(app)/layout.tsx`.
 * Invariants: Outer container matches `view.tsx` (`flex flex-col gap-4 p-5 md:p-6`).
 *   Grid collapses to 1 column on mobile, 2–3 on larger viewports.
 * Side-effects: none
 * Links: ./view.tsx
 * @public
 */

import { Skeleton } from "@/components";
import { PageHeaderSkeleton } from "@/components/kit/layout/PageHeaderSkeleton";

export default function GrowthLoading() {
  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <PageHeaderSkeleton titleWidth="w-28" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
            key={i}
            className="h-44 w-full rounded-lg"
          />
        ))}
      </div>
    </div>
  );
}
