// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/startup-reconcile`
 * Purpose: Activate this node's goal-metric refresh schedule on first container use.
 * Scope: Once-per-process bounded retry of the idempotent schedule registration.
 * Invariants:
 *   - Dynamic job import avoids a static container/job cycle; tests are inert.
 *   - The manual ops route and its authentication remain intact.
 * Side-effects: IO (job), bounded retry timers.
 * Links: bootstrap/container.ts, bootstrap/jobs/metrics-refresh.job.ts
 * @public
 */

let metricsStarted = false;
const MAX_ATTEMPTS = 8;
const RETRY_DELAY_MS = 15_000;

export function startMetricsSyncOnBoot(): void {
  if (metricsStarted) return;
  // biome-ignore lint/style/noProcessEnv: startup gate before container config
  if (process.env.APP_ENV === "test" || process.env.VITEST === "true") return;
  metricsStarted = true;
  void reconcile(1);
}

async function reconcile(attempt: number): Promise<void> {
  try {
    const { ensureMetricsRefreshSchedule } = await import(
      "./jobs/metrics-refresh.job"
    );
    await ensureMetricsRefreshSchedule();
  } catch (error) {
    // Importing the logger here keeps startup dependencies lazy, like the job.
    const { makeLogger } = await import("@/shared/observability");
    makeLogger({ component: "startup-reconcile" }).warn(
      { err: error, kind: "metrics", attempt, exhausted: attempt === MAX_ATTEMPTS },
      "Schedule startup reconcile failed"
    );
    if (attempt < MAX_ATTEMPTS) {
      setTimeout(() => void reconcile(attempt + 1), RETRY_DELAY_MS);
    }
  }
}
