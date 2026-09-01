import { resolve } from "node:path";

import { defineConfig } from "@rspress/core";

const siteDirectory = import.meta.dirname;

export default defineConfig({
  root: resolve(siteDirectory, "../docs"),
  outDir: process.env.JIG_PAGES_OUTPUT ?? resolve(siteDirectory, "doc_build"),
  siteOrigin: "https://flow.jig.md",
  title: "Jig + FLOW",
  description: "A local, secure host for admitted FLOW packages.",
  logoText: "Jig + FLOW",
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: "Docs", link: "/guide/" },
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
            { text: "Capability Contract/1", link: "/spec/capability-contracts" },
          ],
        },
        {
          text: "Jig direct alpha",
          items: [
            { text: "Project Authoring SDK", link: "/spec/project-sdk" },
            { text: "Project and execution policy", link: "/spec/project-policy" },
          ],
        },
      ],
    },
    footer: {
      message: "FLOW is openly implementable and founder-stewarded. Jig is prerelease software.",
    },
  },
});
