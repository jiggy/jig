import { resolve } from 'node:path'

import { accessibleMarkdown } from '../theme/accessible-markdown'

import { defineConfig } from '@rspress/core'

const siteDirectory = import.meta.dirname

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/flow'),
  markdown: { rehypePlugins: [accessibleMarkdown] },
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  route: {
    exclude: ['**/AGENTS.md'],
  },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://flow.jig.md',
  title: 'FLOW',
  description: 'An independent standard for sharing executable know-how.',
  logoText: 'FLOW',
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: 'Start building', link: '/guide/start' },
      { text: 'Why FLOW', link: '/guide/understand' },
      { text: 'Specifications', link: '/guide/' },
      { text: 'Python SDK', link: '/guide/python' },
      { text: 'Jig', link: 'https://jig.md/' },
      { text: 'GitHub', link: 'https://github.com/jiggy/jig' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Start', items: [{ text: 'Start building', link: '/guide/start' }] },
        { text: 'Build', items: [{ text: 'Python SDK', link: '/guide/python' }] },
        { text: 'Understand', items: [{ text: 'Why FLOW exists', link: '/guide/understand' }] },
        { text: 'Reference', items: [{ text: 'Specification map', link: '/guide/' }] },
      ],
      '/spec/': [
        {
          text: 'FLOW foundation',
          items: [
            { text: 'JSON/1', link: '/spec/json-values' },
            { text: 'Schema/1', link: '/spec/schema-files' },
            { text: 'Package/1', link: '/spec/package-format' },
            { text: 'Run/1', link: '/spec/run-protocol' },
            { text: 'Run SDK/1', link: '/spec/run-sdk' },
            { text: 'Channel Contract/1', link: '/spec/channel-contracts' },
            {
              text: 'Capability Contract/1',
              link: '/spec/capability-contracts',
            },
          ],
        },
      ],
    },
    footer: {
      message: 'FLOW is openly implementable and founder-stewarded.',
    },
  },
})
