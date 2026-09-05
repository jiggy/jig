import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "flows/workshop",
  slots: {
    drafter: "flow:flows/drafter",
    reviewer: "binding:reviewer",
  },
});
