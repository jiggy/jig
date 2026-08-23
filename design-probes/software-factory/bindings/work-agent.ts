// DESIGN PROBE ONLY: exact Agent Run provider configured for factory work.
import { run as acpAgentRun } from "@jig/agent-acp";
import { bind, hostCapability, root } from "jig";

export default bind({
  use: hostCapability(acpAgentRun),
  settings: {},
  attachments: {
    workspace: root("./workspace"),
  },
  grants: {
    tools: ["attachment-files", "sandboxed-command"],
  },
});
