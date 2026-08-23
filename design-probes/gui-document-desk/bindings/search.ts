import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/search",
  settings: {},
  slots: { index: bindingRef("document-index") },
});

