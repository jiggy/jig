import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/schedule-reminder",
  settings: {},
  slots: { scheduler: bindingRef("cordis-scheduler") },
});

