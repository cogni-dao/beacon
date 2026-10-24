// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Beacon's existing v1 lease commands remain owned by the exact legacy release. */

import type { WorkItemsDoltgresPort as LegacyWorkItemsPort } from "@cogni/legacy-work-items/adapters/doltgres";
import type { WorkItemsContentPort } from "@cogni/work-items";

export type EvaluationWorkItemsPort = Omit<WorkItemsContentPort, "delete"> &
  Pick<LegacyWorkItemsPort, "claim" | "heartbeat" | "release" | "delete">;
