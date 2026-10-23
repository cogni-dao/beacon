// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Request/DTO adapter for the published score contract. */
import { parseWorkItemScores, type WorkItemScores } from "@cogni/work-items";
import { z } from "zod";
export const WorkItemScoresSchema = z.custom<WorkItemScores>(
  (value) => value !== null && parseWorkItemScores(value).ok,
  "Invalid evaluation scores",
);
