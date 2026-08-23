// DESIGN PROBE ONLY: one mounted writer owns the complete index attachment.
import { bind, bindingRef, root } from "jig";

export default bind({
  use: "./flows/document-index",
  settings: {},
  slots: {
    journal: bindingRef("journal"),
  },
  attachments: {
    index: root("./index"),
  },
});
