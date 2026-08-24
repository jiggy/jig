// DESIGN PROBE ONLY: operator-started repair writes only inert proposal files.
import { bind, bindingRef, root } from "@jigging/jig";

export default bind({
  use: "./flows/create-missing-flow",
  settings: {},
  instruction: {
    agent: bindingRef("repair-agent"),
  },
  attachments: {
    workspace: root("./repair-staging"),
  },
});
