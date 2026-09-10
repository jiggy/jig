import { resolve } from 'node:path'
import { defineConfig } from '@rspress/core'
import { documentationIndex } from '../theme/llms'
import { accessibleMarkdown } from '../theme/accessible-markdown'
import { diagramImages } from '../theme/diagram-images'

const siteDirectory = import.meta.dirname

const sidebar = [
  {
    text: "Start",
    items: [
      { text: "Documentation home", link: "/guide/overview" },
      { text: "Your first Flow", link: "/guide/" },
      { text: "How Jig works", link: "/guide/understand" },
    ],
  },
  {
    text: "Build",
    items: [
      { text: "Choose an Agent", link: "/guide/agents" },
      { text: "Flow dependencies", link: "/guide/dependencies" },
      { text: "Working with files", link: "/guide/files" },
      { text: "Live progress", link: "/guide/channels" },
      { text: "Two-way data exchange", link: "/guide/dataset-analysis" },
      { text: "Workflow structure", link: "/guide/workflow-design" },
    ],
  },
  {
    text: "Examples",
    items: [
      { text: "An issue becomes a tested patch", link: "/guide/tested-patch" },
      { text: "A proposal workshop", link: "/guide/proposal-workshop" },
    ],
  },
  {
    text: "Work together",
    items: [
      { text: "For teams", link: "/guide/teams" },
      { text: "For agents", link: "/guide/for-agents" },
      { text: "Concepts and questions", link: "/guide/concepts" },
      { text: "Results and recovery", link: "/guide/results" },
    ],
  },
  {
    text: "Reference",
    collapsible: true,
    items: [
      { text: "Project authoring", link: "/spec/project-sdk" },
      { text: "Execution policy", link: "/spec/project-policy" },
      { text: "Agent Run", link: "/spec/agent-run" },
      { text: "Project Command", link: "/spec/project-command" },
      { text: "Channels", link: "/spec/channels" },
      { text: "Run Checkpoint", link: "/spec/run-checkpoint" },
    ],
  },
  {
    text: "Capability identities",
    collapsible: true,
    collapsed: true,
    items: [
      { text: "Agent Run", link: "/contracts/agent-run" },
      { text: "ACP public updates", link: "/contracts/acp-public-updates" },
      { text: "Project Command", link: "/contracts/project-command" },
      { text: "Run Checkpoint", link: "/contracts/run-checkpoint" },
    ],
  },
  {
    text: "Research \u00b7 not availability",
    collapsible: true,
    collapsed: true,
    items: [
      { text: "Use cases", link: "/use-cases" },
      { text: "Orchestration patterns", link: "/orchestration-patterns" },
      { text: "Time-travel handoff", link: "/time-travel-handoff" },
    ],
  },
]

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/jig'),
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  markdown: { remarkPlugins: [diagramImages], rehypePlugins: [accessibleMarkdown], shiki: { themes: { light: 'one-light', dark: 'one-dark-pro' } } },
  llms: { llmsTxt: documentationIndex(sidebar) },
  route: { exclude: ['**/AGENTS.md'] },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://jig.md',
  title: 'Jig',
  description: 'Reusable methods. Your Agents. Power under control.',
  icon: new URL('./public/favicon.svg', import.meta.url).href,
  logoText: 'Jig',
  builderConfig: {
    output: { cleanDistPath: false },
    tools: { rspack: { module: { rules: [{
      test: /\.svg$/,
      resourceQuery: /diagram-theme=/,
      type: 'asset/resource',
      generator: { filename: 'static/svg/[name].[contenthash:10][ext]' },
      use: [resolve(siteDirectory, '../theme/diagram-theme-loader.cjs')],
    }] } } },
  },
  themeConfig: {
    llmsUI: { placement: 'title', viewOptions: ['markdownLink'] },
    editLink: { docRepoBaseUrl: 'https://github.com/jiggy/jig/tree/main/docs/jig' },
    enableScrollToTop: true,
    nav: [
      {"text": "Documentation", "link": "/guide/overview"},
      {"text": "Example", "link": "/guide/tested-patch"},
      {"text": "For agents", "link": "/guide/for-agents"},
      {"text": "FLOW", "link": "https://flow.jig.md/"},
      {"text": "GitHub", "link": "https://github.com/jiggy/jig"},
    ],
    sidebar: { '/': sidebar },
    footer: { message: 'Expand human possibility. Jig is open-source, prerelease software.' },
  },
})
