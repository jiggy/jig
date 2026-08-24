// DESIGN PROBE ONLY: select Events from one exact Service Binding generation.
import { bindingRef, event, hook } from "@jigging/jig";

export default hook({
  on: event(
    bindingRef("document-index"),
    "https://probe.jig.dev/events/document-indexed",
  ),
  run: bindingRef("audit"),
});
