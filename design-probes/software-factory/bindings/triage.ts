// DESIGN PROBE ONLY: local routing and open component resolution stay distinct.
import {
  bind,
  bindingRef,
  discover,
} from "jig";

export default bind({
  use: "./flows/triage",
  settings: {},
  slots: {
    agent: bindingRef("work-agent"),
    choice: bindingRef("semantic-choice"),
    "reference-research": discover([
      "reference-fast",
      "reference-deep",
    ]),
  },
});
