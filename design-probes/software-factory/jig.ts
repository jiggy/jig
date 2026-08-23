// DESIGN PROBE ONLY: hypothetical authoring syntax, no Jig implementation.
import {
  defineJig,
  discover,
} from "jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
  // Optional: rank only when deterministic flow/call filtering leaves >1.
  // Removing this makes the reference-research call ambiguous; the Spindle
  // Router still uses triage's separate `choice` slot.
  semanticChoice: "semantic-choice",
});
