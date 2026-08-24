// DESIGN PROBE ONLY: hypothetical authoring syntax, no Jig implementation.
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
});
