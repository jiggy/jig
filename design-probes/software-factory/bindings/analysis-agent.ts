// DESIGN PROBE ONLY: routing and reference analysis receive no attachments or tools.
import { bind, hostCapability } from "jig";

export default bind({
  use: hostCapability("local-agent", {
    export: "run",
  }),
  settings: {},
});
