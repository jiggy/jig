import { resolve } from 'node:path'

import { defineConfig } from '@rspress/core'

const siteDirectory = import.meta.dirname

const researchSidebar = [
  {
    text: 'Research',
    items: [
      { text: 'Use cases', link: '/use-cases' },
      { text: 'Time-travel handoff', link: '/time-travel-handoff' },
      {
        text: 'Candidate orchestration patterns',
        link: '/orchestration-patterns',
      },
    ],
  },
]

const guideSidebar = [
  {
    text: 'Guides',
    items: [
      { text: 'Get started', link: '/guide/' },
      { text: 'Choose an Agent', link: '/guide/agents' },
      { text: 'Flow dependencies', link: '/guide/dependencies' },
      { text: 'Working with files', link: '/guide/files' },
      { text: 'Live progress', link: '/guide/channels' },
      { text: 'Two-way data exchange', link: '/guide/dataset-analysis' },
      { text: 'A proposal workshop', link: '/guide/proposal-workshop' },
      { text: 'An issue becomes a tested patch', link: '/guide/tested-patch' },
      {
        text: 'Choosing a workflow structure',
        link: '/guide/workflow-design',
      },
    ],
  },
]

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/jig'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  route: {
    exclude: ['**/AGENTS.md'],
  },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://jig.md',
  title: 'Jig',
  description: 'A local, secure host for admitted FLOW packages.',
  logoText: 'Jig',
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: 'Quickstart', link: '/guide/' },
      { text: 'Use cases', link: '/use-cases' },
      { text: 'FLOW', link: 'https://flow.jig.md/' },
      { text: 'GitHub', link: 'https://github.com/jiggy/jig' },
    ],
    sidebar: {
      '/guide/': guideSidebar,
      '/use-cases': researchSidebar,
      '/time-travel-handoff': researchSidebar,
      '/orchestration-patterns': researchSidebar,
      '/contracts/': [
        {
          text: 'Capability contracts',
          items: [
            { text: 'Agent Run', link: '/contracts/agent-run' },
            { text: 'ACP public updates', link: '/contracts/acp-public-updates' },
            { text: 'Project Command', link: '/contracts/project-command' },
            { text: 'Run Checkpoint', link: '/contracts/run-checkpoint' },
          ],
        },
      ],
      '/spec/': [
        {
          text: 'Jig direct alpha',
          items: [
            { text: 'Project Authoring SDK', link: '/spec/project-sdk' },
            {
              text: 'Project and execution policy',
              link: '/spec/project-policy',
            },
            { text: 'Agent Run capability', link: '/spec/agent-run' },
            { text: 'Channels and live output', link: '/spec/channels' },
            { text: 'Project Command capability', link: '/spec/project-command' },
            { text: 'Run Checkpoint capability', link: '/spec/run-checkpoint' },
          ],
        },
      ],
    },
    footer: {
      message: 'Jig is prerelease software. FLOW remains independently implementable.',
    },
  },
})
