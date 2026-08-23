// DESIGN PROBE ONLY: the instruction Run, not this provider, owns staging.
import { run as acpAgentRun } from "@jig/agent-acp";
import { bind, hostCapability } from "jig";

export default bind({
  use: hostCapability(acpAgentRun),
  settings: {},
  grants: {
    tools: ["attachment-files", "sandboxed-command"],
  },
});
