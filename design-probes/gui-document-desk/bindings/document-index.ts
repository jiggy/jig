// DESIGN PROBE ONLY: one mounted Service owns the persistent index.
import { bind, bindingRef, root } from "jig";

export default bind({
  use: "./flows/document-index",
  settings: {},
  slots: { journal: bindingRef("journal") },
  attachments: { index: root("./index") },
});

