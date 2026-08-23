// DESIGN PROBE ONLY: hypothetical authoring syntax, no runtime implementation.
import {
  defineJig,
  discover,
} from "jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
