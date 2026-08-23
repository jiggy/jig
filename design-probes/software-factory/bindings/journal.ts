// DESIGN PROBE ONLY: canonical Journal authority, not an implementation.
import { bind, hostCapability } from "jig";

export default bind({
  use: hostCapability("jig-journal", {
    export: "append",
  }),
  settings: {},
  grants: {
    eventTypes: ["https://jig.example/events/inbox-item-created"],
  },
});
