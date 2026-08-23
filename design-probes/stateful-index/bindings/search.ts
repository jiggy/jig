// DESIGN PROBE ONLY: one exact Bun Run using the same index generation.
import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/search",
  settings: {},
  slots: {
    index: bindingRef("document-index"),
  },
});
