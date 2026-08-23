// DESIGN PROBE ONLY: exact Agent Run provider configured for factory work.
import { bind, hostCapability, root } from "jig";

export default bind({
  use: hostCapability("local-agent", {
    export: "run",
  }),
  settings: {},
  attachments: {
    workspace: root("./workspace"),
  },
  grants: {
    tools: ["attachment-files", "sandboxed-command"],
  },
});
