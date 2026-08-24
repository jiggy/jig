// DESIGN PROBE ONLY: Hook target checks the state behind an immutable Event.
import { bind, bindingRef } from "@jigging/jig";

export default bind({
  use: "./flows/audit",
  settings: {},
  slots: {
    index: bindingRef("document-index"),
  },
});
