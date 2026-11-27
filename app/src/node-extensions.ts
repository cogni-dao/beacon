// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Beacon declarations over published extension points. No grants are created here. */
import { defineNodeExtensions } from "@cogni/extension-kit";

export const nodeExtensions = defineNodeExtensions({
  routes: {
    noRouteTwin: {
      // Grandfathered product id. This explains the missing HTTP twin only;
      // the tool still requires its owner-approved account grant at execution.
      core__broadcast_post:
        "Publishes staged variants through the node's injected broadcast capability; no HTTP broadcast route exists.",
    },
  },
});
