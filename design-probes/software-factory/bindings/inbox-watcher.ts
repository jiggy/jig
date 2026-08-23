// DESIGN PROBE ONLY: this ready Service Binding is mounted for the generation.
import { bind, bindingRef, root } from "jig";

export default bind({
  use: "./flows/inbox-watcher",
  settings: {},
  slots: {
    journal: bindingRef("journal"),
  },
  attachments: {
    inbox: root("./inbox"),
  },
});
