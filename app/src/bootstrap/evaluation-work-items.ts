// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Lease coordination is owned by the published PostgreSQL adapter/composer. */
export { withWorkItemLeases as composeEvaluationWorkItems } from "@cogni/work-items";

export class WorkItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Work item not found: ${id}`);
    this.name = "WorkItemNotFoundError";
  }
}
