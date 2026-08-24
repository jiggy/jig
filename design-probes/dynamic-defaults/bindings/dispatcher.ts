// DESIGN PROBE ONLY: this Binding is intentional policy, not package boilerplate.
import { allRuns, bind } from "@jigging/jig";

export default bind({
  use: "./flows/dispatcher",
  settings: {},
  slots: {
    delegate: allRuns(),
  },
});
