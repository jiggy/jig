// DESIGN PROBE ONLY: one inert owned source -> durable Event -> triage Run.
import { stableTextFiles } from "@jig/hooks-files";
import { bindingRef, hook, root } from "jig";

export default hook({
  on: stableTextFiles({
    root: root("./inbox"),
    suffix: ".md",
    settleMs: 250,
    maxBytes: 1_048_576,
    maxScalars: 262_144,
  }),
  run: bindingRef("triage"),
});
