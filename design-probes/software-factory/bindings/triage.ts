// DESIGN PROBE ONLY: local routing and open component resolution stay distinct.
import {
  bind,
  bindingRef,
  candidates,
} from "@jigging/jig";

export default bind({
  use: "./flows/triage",
  settings: {},
  slots: {
    worker: bindingRef("work-agent"),
    analyst: bindingRef("analysis-agent"),
    choice: bindingRef("semantic-choice"),
    kanban: bindingRef("kanban"),
    "reference-research": candidates([
      bindingRef("reference-fast"),
      bindingRef("reference-deep"),
    ]),
  },
});
