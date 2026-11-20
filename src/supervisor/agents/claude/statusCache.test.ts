// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { expect, it } from "vitest";
import { decodeAgentStatusCache } from "@/shared/agentStatusCache";
import { agentCapabilitySchema } from "@/shared/contracts/agent";

it.each(["claude", "claude:upgrade-profile"])(
  "refreshes obsolete claude capabilities for %s without dropping another provider",
  (kind) => {
    const cached = {
      kind,
      label: "Claude Code",
      installed: true,
      authState: "authenticated",
      capabilities: agentCapabilitySchema.parse({}),
    };
    const unaffected = { ...cached, kind: "unaffected", label: "Unaffected" };
    const upgraded = decodeAgentStatusCache({
      version: 81, // ViscosityCode: v81 rows hold the stale model list and plan label
      windows: [cached, unaffected],
      wsl: [],
    });
    expect(upgraded.statuses).toEqual({ windows: [unaffected], wsl: [], fromCache: false });
    const fresh = decodeAgentStatusCache({ version: 82, windows: [cached, unaffected], wsl: [] });
    expect(fresh.statuses).toEqual({ windows: [cached, unaffected], wsl: [], fromCache: true });
  },
);
