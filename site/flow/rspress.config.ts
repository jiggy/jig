import { resolve } from "node:path";

import { defineConfig } from "@rspress/core";

const siteDirectory = import.meta.dirname;

export default defineConfig({
  root: resolve(siteDirectory, "../../docs/flow"),
  route: {
    exclude: ["**/AGENTS.md"],
  },
  outDir:
    process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, "doc_build"),
  siteOrigin: "https://flow.jig.md",
  title: "FLOW",
  description: "Portable workflow packages and process contracts.",
  logoText: "FLOW",
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: "Specifications", link: "/guide/" },
      { text: "Jig", link: "https://jig.md/" },
      { text: "GitHub", link: "https://github.com/jigmd/jig" },
    ],
    sidebar: {
      "/spec/": [
        {
          text: "FLOW foundation",
          items: [
            { text: "JSON/1", link: "/spec/json-values" },
            { text: "Schema/1", link: "/spec/schema-files" },
            { text: "Package/1", link: "/spec/package-format" },
            { text: "Run/1", link: "/spec/run-protocol" },
            { text: "Run SDK/1", link: "/spec/run-sdk" },
            {
              text: "Capability Contract/1",
              link: "/spec/capability-contracts",
            },
          ],
        },
      ],
    },
    footer: {
      message: "FLOW is openly implementable and founder-stewarded.",
    },
  },
});
