// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { serverEnv } from "@/shared/env";
import { assertEvmRpcConfig, assertRuntimeSecrets } from "@/shared/env/invariants";

/** Local configuration only: no container construction or remote calls. */
export function localReadinessPreflight(): ReturnType<typeof serverEnv> {
  const env = serverEnv();
  assertRuntimeSecrets(env);
  assertEvmRpcConfig(env);
  return env;
}
