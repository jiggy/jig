// DESIGN PROBE ONLY: routing and reference analysis receive no attachments or tools.
import { run as acpAgentRun } from "@jigging/agent-acp";
import { bind, hostCapability } from "@jigging/jig";

export default bind({
  use: hostCapability(acpAgentRun),
  settings: {},
});
