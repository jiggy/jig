// DESIGN PROBE ONLY: exact Semantic Choice backed by an exact Agent Binding.
import { bind, bindingRef, hostCapability } from "jig";

export default bind({
  use: hostCapability("semantic-choice-via-agent", {
    export: "choose",
  }),
  settings: {},
  slots: {
    agent: bindingRef("analysis-agent"),
  },
});
