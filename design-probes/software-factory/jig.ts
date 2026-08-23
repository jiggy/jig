// DESIGN PROBE ONLY: hypothetical authoring syntax, no Jig implementation.
import {
  bindingSources,
  catalogue,
  defineJig,
  hookSources,
  semanticResolver,
} from "jig";

export default defineJig({
  catalogues: {
    flows: catalogue.directory("./flows"),
  },
  bindings: bindingSources.directory("./bindings"),
  hooks: hookSources.directory("./hooks"),
  resolver: semanticResolver({
    using: "semantic-choice",
  }),
});
