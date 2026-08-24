// DESIGN PROBE ONLY: one explicit use owns the intentionally open call slot.
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: ["./bindings/dispatcher.ts"],
});
