// DESIGN PROBE ONLY: portable custom producer authority is explicit.
import { append as journalAppend } from "@jigging/journal";
import { bind, hostCapability } from "@jigging/jig";

export default bind({
  use: hostCapability(journalAppend),
  settings: {},
  grants: {
    eventTypes: ["https://probe.jig.dev/events/document-indexed"],
  },
});
