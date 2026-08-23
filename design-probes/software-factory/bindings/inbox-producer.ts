// DESIGN PROBE ONLY: finite producer Run; no watcher or Service is implied.
import { bind, bindingRef, root } from "jig";

export default bind({
  use: "./flows/inbox-producer",
  settings: {},
  slots: {
    journal: bindingRef("journal"),
  },
  attachments: {
    inbox: root("./inbox"),
  },
});
