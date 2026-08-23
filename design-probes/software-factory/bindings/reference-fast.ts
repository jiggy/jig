// DESIGN PROBE ONLY: one approved candidate for an open flow/call slot.
import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/reference-fast",
  settings: {},
  instruction: {
    agent: bindingRef("analysis-agent"),
  },
});
