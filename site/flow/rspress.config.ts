import { resolve } from 'node:path'
import { defineConfig } from '@rspress/core'
import { documentationIndex } from '../theme/llms'
import { accessibleMarkdown } from '../theme/accessible-markdown'

const siteDirectory = import.meta.dirname

const sidebar = [
  {
    text: "Start",
    items: [
      { text: "Documentation home", link: "/guide/overview" },
      { text: "Build your first Flow", link: "/guide/start" },
      { text: "Why FLOW exists", link: "/guide/understand" },
    ],
  },
  {
    text: "Build",
    items: [
      { text: "Python SDK", link: "/guide/python" },
      { text: "For agents", link: "/guide/for-agents" },
      { text: "Concepts and questions", link: "/guide/concepts" },
    ],
  },
  {
    text: "Specifications",
    items: [
      { text: "Specification map", link: "/guide/" },
      { text: "Package format", link: "/spec/package-format" },
      { text: "Run protocol", link: "/spec/run-protocol" },
      { text: "Run SDK", link: "/spec/run-sdk" },
      { text: "JSON values", link: "/spec/json-values" },
      { text: "Schema files", link: "/spec/schema-files" },
      { text: "Capability contracts", link: "/spec/capability-contracts" },
      { text: "Channel contracts", link: "/spec/channel-contracts" },
    ],
  },
]

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/flow'),
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  markdown: { rehypePlugins: [accessibleMarkdown], shiki: { themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' } } },
  llms: { llmsTxt: documentationIndex(sidebar) },
  route: { exclude: ['**/AGENTS.md'] },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://flow.jig.md',
  title: 'FLOW',
  description: 'An independent standard for sharing executable know-how.',
  icon: new URL('./public/favicon.svg', import.meta.url).href,
  logoText: 'FLOW',
  builderConfig: { output: { cleanDistPath: false } },
  themeConfig: {
    llmsUI: { placement: 'title', viewOptions: ['markdownLink'] },
    editLink: { docRepoBaseUrl: 'https://github.com/jiggy/jig/tree/main/docs/flow' },
    enableScrollToTop: true,
    nav: [
      {"text": "Documentation", "link": "/guide/overview"},
      {"text": "Specifications", "link": "/guide/"},
      {"text": "For agents", "link": "/guide/for-agents"},
      {"text": "Jig", "link": "https://jig.md/"},
      {"text": "GitHub", "link": "https://github.com/jiggy/jig"},
    ],
    sidebar: { '/': sidebar },
    footer: { message: 'Capability compounding. FLOW is openly implementable and prerelease.' },
  },
})
