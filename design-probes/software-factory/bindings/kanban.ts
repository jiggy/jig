// DESIGN PROBE ONLY: one mounted writer owns the human-readable board.
import { bind, root } from "@jigging/jig";

export default bind({
  use: "./flows/kanban",
  settings: {},
  attachments: {
    board: root("./kanban"),
  },
});
