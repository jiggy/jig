import { bind, bindingRef } from "@jigging/jig";

export default bind({
  use: "./flows/search",
  settings: {},
  slots: { index: bindingRef("document-index") },
});
