import { resolve } from 'node:path'
import { defineConfig } from '@rspress/core'
import { accessibleMarkdown } from '../theme/accessible-markdown'
import { codeThemes } from '../theme/code-themes'
import { diagramImages } from '../theme/diagram-images'
import { documentationIndex } from '../theme/llms'

const siteDirectory = import.meta.dirname

const areas = [
  { text: 'Documentation home', link: '/documentation' },
  { text: 'Start here', link: '/start/' },
  { text: 'Build', link: '/build/' },
  { text: 'Understand', link: '/understand/' },
  { text: 'Examples', link: '/examples/' },
  { text: 'Reference', link: '/reference/' },
]

const start = [
  {
    text: 'Start here',
    items: [
      { text: 'Run your first Flow', link: '/start/' },
      { text: 'Call from your application', link: '/start/application' },
      { text: 'Add an Agent', link: '/build/agents' },
      { text: 'Compose methods', link: '/build/compose' },
    ],
  },
]
const build = [
  {
    text: 'Build',
    items: [
      { text: 'Choose a task', link: '/build/' },
      { text: 'Add an Agent', link: '/build/agents' },
      { text: 'Compose methods', link: '/build/compose' },
      { text: 'Write Markdown methods', link: '/build/markdown' },
      { text: 'Reuse the Agent method', link: '/build/agent-method' },
      { text: 'Prepare dependencies', link: '/build/dependencies' },
      { text: 'Author contracts', link: '/build/contracts' },
    ],
  },
  {
    text: 'Data, effects, and results',
    items: [
      { text: 'Work with files', link: '/build/files' },
      { text: 'Delegate HTTP access', link: '/build/http' },
      { text: 'Show live progress', link: '/build/channels' },
      { text: 'Results', link: '/build/results' },
    ],
  },
  {
    text: 'Continue Agent work',
    collapsible: true,
    items: [
      { text: 'Revise in one conversation', link: '/build/conversations' },
      { text: 'Control a conversation', link: '/build/conversation-control' },
      { text: 'Hand work to a fresh conversation', link: '/build/conversation-handoff' },
      { text: 'Retain and restore a conversation', link: '/build/conversation-restoration' },
    ],
  },
  {
    text: 'Design and collaborate',
    collapsible: true,
    items: [
      { text: 'Project design', link: '/build/design' },
      { text: 'Work together', link: '/build/teams' },
    ],
  },
]
const understand = [
  {
    text: 'Understand',
    items: [
      { text: 'How Jig works', link: '/understand/' },
      { text: 'Choose a workflow structure', link: '/understand/workflows' },
      { text: 'Glossary and questions', link: '/reference/glossary' },
    ],
  },
]
const examples = [
  {
    text: 'Examples',
    items: [
      { text: 'Choose an example', link: '/examples/' },
      { text: 'Preview unfamiliar CSV contacts', link: '/examples/contact-import' },
      { text: 'Handle a disputed charge', link: '/examples/support-case' },
      { text: 'Turn an issue into a tested patch', link: '/examples/tested-patch' },
      { text: 'Run a small software factory', link: '/examples/software-factory' },
    ],
  },
]
const reference = [
  {
    text: 'Reference',
    items: [
      { text: 'Find an exact answer', link: '/reference/' },
      { text: 'Settings and configuration', link: '/reference/configuration' },
      { text: 'Limits and defaults', link: '/reference/limits' },
      { text: 'Troubleshooting', link: '/reference/troubleshooting' },
      { text: 'Glossary and questions', link: '/reference/glossary' },
    ],
  },
  {
    text: 'Project and execution contracts',
    collapsible: true,
    items: [
      { text: 'Project authoring', link: '/spec/project-sdk' },
      { text: 'Execution policy', link: '/spec/project-policy' },
      { text: 'Application client', link: '/spec/execution-client' },
      { text: 'Resource grants', link: '/spec/grants' },
      { text: 'Contract authoring', link: '/spec/contract-authoring' },
      { text: 'CLI experience', link: '/spec/cli-experience' },
    ],
  },
  {
    text: 'Capability and presentation contracts',
    collapsible: true,
    collapsed: true,
    items: [
      { text: 'Agent Run', link: '/spec/agent-run' },
      { text: 'Finite ACP', link: '/spec/finite-acp' },
      { text: 'Project Command', link: '/spec/project-command' },
      { text: 'Project Evaluation', link: '/spec/project-evaluation' },
      { text: 'HTTP Request', link: '/spec/http-request' },
      { text: 'Channels', link: '/spec/channels' },
      { text: 'Reporting', link: '/spec/reporting' },
      { text: 'Run Checkpoint', link: '/spec/run-checkpoint' },
      { text: 'Child Checkpoint', link: '/spec/child-checkpoint' },
      { text: 'Display archives', link: '/spec/display-archive' },
      { text: 'Web display', link: '/spec/web-display' },
    ],
  },
  {
    text: 'Named capability contracts',
    collapsible: true,
    collapsed: true,
    items: [
      { text: 'Directory', link: '/contracts/' },
      { text: 'Agent Run', link: '/contracts/agent-run' },
      { text: 'ACP public updates', link: '/contracts/acp-public-updates' },
      { text: 'Reporting', link: '/contracts/reporting' },
      { text: 'Project Command', link: '/contracts/project-command' },
      { text: 'Project Evaluation', link: '/contracts/project-evaluation' },
      { text: 'HTTP Request', link: '/contracts/http-request' },
      { text: 'Finite ACP', link: '/contracts/finite-acp' },
      { text: 'Run Checkpoint', link: '/contracts/run-checkpoint' },
      { text: 'Child Checkpoint', link: '/contracts/child-checkpoint' },
    ],
  },
]
const research = [
  {
    text: 'Research · hypotheses',
    items: [
      { text: 'About this research', link: '/research/' },
      { text: 'Use cases', link: '/research/use-cases' },
      { text: 'Orchestration patterns', link: '/research/orchestration-patterns' },
      { text: 'Time-travel handoff', link: '/research/time-travel-handoff' },
    ],
  },
]
const utilities = [
  {
    text: 'Resources',
    items: [
      { text: 'For agents', link: '/for-agents' },
      { text: 'Research · hypotheses', link: '/research/' },
      { text: 'Acknowledgements', link: '/acknowledgements' },
    ],
  },
]
const sectionLinks = { text: 'Documentation', items: areas }
const focused = (groups: typeof start) => [sectionLinks, ...groups]
const indexed = new Set<string>()
const index = [
  ...start,
  ...build,
  ...understand,
  ...examples,
  ...reference,
  ...research,
  ...utilities,
].map((group) => ({
  ...group,
  items: group.items.filter((item) => {
    if (indexed.has(item.link)) return false
    indexed.add(item.link)
    return true
  }),
}))

export default defineConfig({
  root: resolve(siteDirectory, '../../docs/jig'),
  themeDir: resolve(siteDirectory, '../theme'),
  globalStyles: resolve(siteDirectory, 'diagrams.css'),
  markdown: {
    remarkPlugins: [diagramImages],
    rehypePlugins: [accessibleMarkdown],
    shiki: codeThemes,
  },
  llms: { llmsTxt: documentationIndex(index) },
  route: { exclude: ['**/AGENTS.md'] },
  outDir: process.env.PUBLIC_SITE_OUTPUT ?? resolve(siteDirectory, 'doc_build'),
  siteOrigin: 'https://jig.md',
  title: 'Jig',
  description: 'Reusable methods. Your Agents. Power under control.',
  icon: new URL('./public/favicon.svg', import.meta.url).href,
  logo: {
    light: '/mark.svg',
    dark: '/mark-light.svg',
  },
  logoText: 'jig',
  builderConfig: {
    server: {
      publicDir: {
        name: resolve(siteDirectory, 'public'),
      },
    },
    output: {
      cleanDistPath: false,
      copy: [{ from: resolve(siteDirectory, 'public'), to: '.' }],
    },
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
    editLink: { docRepoBaseUrl: 'https://github.com/jiggy/jig/tree/main/docs/jig' },
    enableScrollToTop: true,
    nav: [
      { text: 'Start here', link: '/start/' },
      { text: 'Build', link: '/build/' },
      { text: 'Understand', link: '/understand/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'For agents', link: '/for-agents' },
      { text: 'Pricing', link: '/pricing' },
      { text: 'FLOW', link: 'https://flow.jig.md/' },
      { text: 'GitHub', link: 'https://github.com/jiggy/jig' },
    ],
    sidebar: {
      '/start/': focused(start),
      '/build/': focused(build),
      '/understand/': focused(understand),
      '/examples/': focused(examples),
      '/reference/': focused(reference),
      '/spec/': focused(reference),
      '/contracts/': focused(reference),
      '/research/': focused(research),
      '/': [sectionLinks, ...utilities],
    },
    footer: { message: 'Expand human possibility. Jig is source-available, prerelease software.' },
  },
})
