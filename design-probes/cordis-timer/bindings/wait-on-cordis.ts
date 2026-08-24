import { bind, bindingRef } from "@jigging/jig";

// Explicit because the consumer requires its `delay` slot to be filled.
export default bind({
  use: "./flows/wait-on-cordis",
  settings: {},
  slots: { delay: bindingRef("cordis-delay") },
});
