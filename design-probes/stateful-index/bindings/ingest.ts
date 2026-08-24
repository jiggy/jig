// DESIGN PROBE ONLY: one exact Python Run using the index Service.
import { bind, bindingRef } from "@jigging/jig";

export default bind({
  use: "./flows/ingest",
  settings: {},
  slots: {
    index: bindingRef("document-index"),
  },
});
