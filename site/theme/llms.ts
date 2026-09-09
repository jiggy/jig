import type { LlmsTxtContext } from '@rspress/core'

type Group = { text: string; items: { text: string; link: string }[] }
const normalize = (path: string) => path.replace(/\.(?:html|md)$/, '').replace(/\/index$/, '/').replace(/\/$/, '')

/** Reuse the human navigation while retaining every generated public page. */
export function documentationIndex(groups: Group[]) {
  return ({ title, description, siteOrigin, sections }: LlmsTxtContext) => {
    const pages = new Map(sections.flatMap(section => section.pages).map(page => [normalize(page.routePath), page]))
    const lines = [`# ${title}`, '', `> ${description}`, '', `- [Homepage](${siteOrigin}/index.md)`, `- [Complete documentation](${siteOrigin}/llms-full.txt)`]
    for (const group of groups) {
      lines.push('', `## ${group.text}`, '')
      for (const item of group.items) {
        const key = normalize(item.link)
        const page = pages.get(key)
        if (!page) throw new Error(`Documentation index cannot resolve ${item.link}`)
        lines.push(`- [${item.text}](${page.link})${page.frontmatter.description ? `: ${page.frontmatter.description}` : ''}`)
        pages.delete(key)
      }
    }
    if (pages.size) {
      lines.push('', '## Additional pages', '')
      for (const page of pages.values()) lines.push(`- [${page.title}](${page.link})`)
    }
    return `${lines.join('\n')}\n`
  }
}
