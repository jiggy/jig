import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/ingest",
  settings: {},
  slots: { index: bindingRef("document-index") },
});

