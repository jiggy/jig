// DESIGN PROBE ONLY: the instruction Run, not this provider, owns staging.
import { bind, hostCapability } from "jig";

export default bind({
  use: hostCapability("local-agent", {
    export: "run",
  }),
  settings: {},
  grants: {
    tools: ["attachment-files", "sandboxed-command"],
  },
});
