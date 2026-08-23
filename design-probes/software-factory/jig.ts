// DESIGN PROBE ONLY: hypothetical authoring syntax, no Jig implementation.
import {
  bindingRef,
  defineJig,
  discover,
} from "jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
  // Optional: rank only when deterministic flow/call filtering leaves >1.
  // By convention this resolves bindings/semantic-choice.ts; it is not an
  // algorithm name or provider alias.
  // Removing this makes the reference-research call ambiguous; the Spindle
  // Router still uses triage's separate `choice` slot.
  semanticChoice: bindingRef("semantic-choice"),
});
