// DESIGN PROBE ONLY: hypothetical authoring syntax, no runtime implementation.
import {
  bindingSources,
  catalogue,
  defineJig,
} from "jig";

export default defineJig({
  catalogues: {
    flows: catalogue.directory("./flows"),
  },
  bindings: bindingSources.directory("./bindings"),
});
