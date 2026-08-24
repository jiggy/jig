// DESIGN PROBE ONLY: no explicit Binding source is configured.
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
});
