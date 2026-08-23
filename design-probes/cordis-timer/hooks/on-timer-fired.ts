import { bindingRef, event, hook } from "jig";

export default hook({
  on: event(
    bindingRef("cordis-scheduler"),
    "https://probe.jig.dev/events/timer-fired",
  ),
  run: bindingRef("record-firing"),
});

