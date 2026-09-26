import { resolve } from 'node:path'
import { defineConfig } from '@rspress/core'
import { documentationIndex } from '../theme/llms'
import { accessibleMarkdown } from '../theme/accessible-markdown'
import { diagramImages } from '../theme/diagram-images'
import { codeThemes } from '../theme/code-themes'

const siteDirectory = import.meta.dirname

const sidebar = [
  {
    text: 'Start',
    items: [
      { text: 'Documentation home', link: '/guide/overview' },
      { text: 'Build your first Flow', link: '/guide/start' },
      { text: 'Why FLOW exists', link: '/guide/understand' },
    ],
  },
  {
    text: 'Build',
    items: [
      { text: 'Markdown methods', link: '/guide/markdown' },
      { text: 'Skill compatibility', link: '/guide/skills' },
      { text: 'TypeScript / JavaScript SDK', link: '/guide/typescript' },
      { text: 'Python SDK', link: '/guide/python' },
      { text: 'For agents', link: '/guide/for-agents' },
      { text: 'Concepts and questions', link: '/guide/concepts' },
    ],
  },
  {
    text: 'Specifications',
    items: [
      { text: 'Specification map', link: '/guide/' },
      { text: 'Package format', link: '/spec/package-format' },
      { text: 'Run protocol', link: '/spec/run-protocol' },
      { text: 'Run SDK', link: '/spec/run-sdk' },
      { text: 'JSON values', link: '/spec/json-values' },
      { text: 'Schema files', link: '/spec/schema-files' },
      { text: 'Invocation contracts', link: '/spec/invocation-contracts' },
      { text: 'Markdown runtime', link: '/spec/markdown-runtime' },
      { text: 'Channel contracts', link: '/spec/channel-contracts' },
    ],
  },
]

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/flow'),
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  markdown: {
    remarkPlugins: [diagramImages],
    rehypePlugins: [accessibleMarkdown],
    shiki: codeThemes,
  },
  llms: { llmsTxt: documentationIndex(sidebar) },
  route: { exclude: ['**/AGENTS.md'] },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://flow.jig.md',
  title: 'FLOW',
  description: 'An independent standard for sharing executable know-how.',
  icon: new URL('./public/favicon.svg', import.meta.url).href,
  logoText: 'FLOW',
  builderConfig: {
    output: { cleanDistPath: false },
    tools: {
      rspack: {
        module: {
          rules: [
            {
              test: /\.svg$/,
              resourceQuery: /diagram-theme=/,
              type: 'asset/resource',
              generator: { filename: 'static/svg/[name].[contenthash:10][ext]' },
              use: [resolve(siteDirectory, '../theme/diagram-theme-loader.cjs')],
            },
          ],
        },
      },
    },
  },
  themeConfig: {
    llmsUI: { placement: 'title', viewOptions: ['markdownLink'] },
    editLink: { docRepoBaseUrl: 'https://github.com/jiggy/jig/tree/main/docs/flow' },
    enableScrollToTop: true,
    nav: [
      { text: 'Documentation', link: '/guide/overview' },
      { text: 'Specifications', link: '/guide/' },
      { text: 'For agents', link: '/guide/for-agents' },
      { text: 'Jig', link: 'https://jig.md/' },
      { text: 'GitHub', link: 'https://github.com/jiggy/jig' },
    ],
    sidebar: { '/': sidebar },
    footer: {
      message: 'Capability compounding. FLOW v0 is openly implementable and experimental.',
    },
  },
})
