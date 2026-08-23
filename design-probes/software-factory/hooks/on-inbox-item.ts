// DESIGN PROBE ONLY: exact Event-to-Run admission, not a callback.
import { hook } from "jig";

export default hook({
  source: { binding: "inbox-producer" },
  type: "https://jig.example/events/inbox-item-created",
  target: "triage",
});
