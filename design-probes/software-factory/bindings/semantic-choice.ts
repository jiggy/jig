// DESIGN PROBE ONLY: exact Semantic Choice backed by an exact Agent Binding.
import { chooseViaAgent } from "@jigging/semantic-choice";
import { bind, bindingRef, hostCapability } from "@jigging/jig";

export default bind({
  use: hostCapability(chooseViaAgent),
  settings: {},
  slots: {
    agent: bindingRef("analysis-agent"),
  },
});
