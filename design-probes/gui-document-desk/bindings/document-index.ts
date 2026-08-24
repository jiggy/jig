// DESIGN PROBE ONLY: one mounted Service owns the persistent index.
import { bind, root } from "@jigging/jig";

export default bind({
  use: "./flows/document-index",
  settings: {},
  attachments: { index: root("./index") },
});
