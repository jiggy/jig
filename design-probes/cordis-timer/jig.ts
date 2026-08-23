import { defineJig, discover } from "jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
});

