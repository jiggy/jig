import { resolve } from 'node:path'

import { accessibleMarkdown } from '../theme/accessible-markdown'

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
  { text: 'Start', items: [
    { text: 'Your first Flow', link: '/guide/' },
    { text: 'Try a tested patch', link: '/guide/tested-patch' },
  ] },
  { text: 'Build', items: [
    { text: 'Choose an Agent', link: '/guide/agents' },
    { text: 'Flow dependencies', link: '/guide/dependencies' },
    { text: 'Working with files', link: '/guide/files' },
    { text: 'Live progress', link: '/guide/channels' },
    { text: 'Two-way data exchange', link: '/guide/dataset-analysis' },
    { text: 'A proposal workshop', link: '/guide/proposal-workshop' },
  ] },
  { text: 'Understand', items: [
    { text: 'How Jig works', link: '/guide/understand' },
    { text: 'Choosing a workflow structure', link: '/guide/workflow-design' },
  ] },
  { text: 'Reference', items: [
    { text: 'Project authoring', link: '/spec/project-sdk' },
    { text: 'Execution policy', link: '/spec/project-policy' },
    { text: 'Results and recovery', link: '/guide/results' },
  ] },
]

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/jig'),
  markdown: { rehypePlugins: [accessibleMarkdown] },
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  route: {
    exclude: ['**/AGENTS.md'],
  },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://jig.md',
  title: 'Jig',
  description: 'Accomplish more. Keep the controls. Reusable methods with powers you approve.',
  logoText: 'Jig',
  builderConfig: {
    output: {
      cleanDistPath: false,
    },
  },
  themeConfig: {
    nav: [
      { text: 'Quickstart', link: '/guide/' },
      { text: 'How it works', link: '/guide/understand' },
      { text: 'Reference', link: '/spec/project-sdk' },
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
