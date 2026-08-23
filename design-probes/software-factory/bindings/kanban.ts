// DESIGN PROBE ONLY: one mounted writer owns the human-readable board.
import { bind, root } from "jig";

export default bind({
  use: "./flows/kanban",
  settings: {},
  attachments: {
    board: root("./kanban"),
  },
});
