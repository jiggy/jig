import { resolve } from "node:path";

import { defineConfig } from "@rspress/core";

const siteDirectory = import.meta.dirname;

const researchSidebar = [
  {
    text: "Research",
    items: [
      { text: "Use cases", link: "/use-cases" },
      {
        text: "Candidate orchestration patterns",
        link: "/orchestration-patterns",
      },
    ],
  },
];

const guideSidebar = [
  {
    text: "Guides",
    items: [
      { text: "Direct alpha", link: "/guide/" },
      { text: "A proposal workshop", link: "/guide/proposal-workshop" },
      {
        text: "Choosing a workflow structure",
        link: "/guide/workflow-design",
      },
    ],
  },
];

export default defineConfig({
  root: resolve(siteDirectory, "../../docs/jig"),
  route: {
    exclude: ["**/AGENTS.md"],
  },
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
      { text: "Use cases", link: "/use-cases" },
      { text: "FLOW", link: "https://flow.jig.md/" },
      { text: "GitHub", link: "https://github.com/jiggy/jig" },
    ],
    sidebar: {
      "/guide/": guideSidebar,
      "/use-cases": researchSidebar,
      "/orchestration-patterns": researchSidebar,
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
