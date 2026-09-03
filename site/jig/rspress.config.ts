import { resolve } from "node:path";

import { defineConfig } from "@rspress/core";

const siteDirectory = import.meta.dirname;

export default defineConfig({
  root: resolve(siteDirectory, "../../docs/jig"),
  outDir:
    process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, "doc_build"),
  siteOrigin: "https://jig.md",
  title: "Jig",
  description: "A local, secure host for admitted FLOW packages.",
  logoText: "Jig",
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/guide/" },
      { text: "Use cases", link: "/use-cases/" },
      { text: "FLOW", link: "https://flow.jig.md/" },
      { text: "GitHub", link: "https://github.com/jigmd/jig" },
    ],
    sidebar: {
      "/use-cases/": [
        {
          text: "Use cases",
          items: [
            { text: "Catalogue", link: "/use-cases/" },
            { text: "Pattern notebook", link: "/use-cases/patterns" },
          ],
        },
      ],
      "/spec/": [
        {
          text: "Jig direct alpha",
          items: [
            { text: "Project Authoring SDK", link: "/spec/project-sdk" },
            {
              text: "Project and execution policy",
              link: "/spec/project-policy",
            },
            { text: "Agent Run capability", link: "/spec/agent-run" },
          ],
        },
      ],
    },
    footer: {
      message: "Jig is prerelease software. FLOW remains independently implementable.",
    },
  },
});
