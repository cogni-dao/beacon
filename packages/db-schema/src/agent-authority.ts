// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** The released principal/role/credential schema over Beacon's existing identity tables. */
import { defineAgentAuthoritySchema } from "@cogni/agent-grants/schema";
import { billingAccounts, users } from "./refs";
export const { agentPrincipals, agentRoles, agentCredentials } =
  defineAgentAuthoritySchema({ users, billingAccounts });
