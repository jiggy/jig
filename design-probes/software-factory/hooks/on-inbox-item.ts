// DESIGN PROBE ONLY:
// inbox-watcher Mount -> Journal Event -> this admitted tuple -> triage Run.
// The Hook is admission data, not the filesystem watcher or a callback.
import { hook } from "jig";

export default hook({
  source: { binding: "inbox-watcher" },
  type: "https://jig.example/events/inbox-item-created",
  target: "triage",
});
