// DESIGN PROBE ONLY: a second compatible candidate exercises semantic ranking.
import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/reference-deep",
  settings: {},
  instruction: {
    agent: bindingRef("analysis-agent"),
  },
});
