import { bind } from "@jigging/jig";

// Explicit because a Service is activated project policy, never an ambient Run.
export default bind({
  use: "./flows/cordis-delay",
  settings: {},
});
