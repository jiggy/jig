// DESIGN PROBE ONLY: the instruction Run, not this provider, owns staging.
import { run as acpAgentRun } from "@jigging/agent-acp";
import { bind, hostCapability } from "@jigging/jig";

export default bind({
  use: hostCapability(acpAgentRun),
  settings: {},
  grants: {
    tools: ["attachment-files", "sandboxed-command"],
  },
});
