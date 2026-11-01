import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

export type Finding = { file: string; line: number; message: string }
const root = resolve(import.meta.dirname, '..')

function withoutCode(text: string): string {
  let fence: { character: string; length: number } | undefined
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker) {
        if (!fence) fence = { character: marker[0], length: marker.length }
        else if (
          marker[0] === fence.character &&
          marker.length >= fence.length &&
          /^\s*(`+|~+)\s*$/.test(line)
        )
          fence = undefined
        return ''
      }
      return fence ? '' : line.replace(/(`+)[^`]*?\1/g, 'CODE')
    })
    .join('\n')
}

export function headingIds(text: string): Set<string> {
  const ids = new Set<string>()
  const counts = new Map<string, number>()
  // Inline code contributes its text to a rendered heading.
  const body = text.startsWith('---\n') ? text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '') : text
  const lines = withoutCode(body.replace(/`([^`\n]+)`/g, '$1')).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const title =
      /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(lines[i])?.[1] ??
      (i + 1 < lines.length && /^(?:=+|-+)\s*$/.test(lines[i + 1]) ? lines[i] : undefined)
    if (!title) continue
    const slug = title
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-')
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    ids.add(slug + (count ? `-${count}` : ''))
  }
  for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(match[1])
  return ids
}

export function metadataFindings(file: string, text: string): Finding[] {
  const fail = (message: string) => [{ file, line: 1, message }]
  if (text.startsWith('---') && !text.startsWith('---\n'))
    return fail('Put frontmatter delimiters on separate lines.')
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4)
    if (end < 0 || !/^\n---(?:\n|$)/.test(text.slice(end)))
      return fail('Close the frontmatter on its own line.')
    try {
      const data = Bun.YAML.parse(text.slice(4, end)) as Record<string, unknown>
      if (!data || typeof data !== 'object' || Array.isArray(data))
        return fail('Use a frontmatter mapping.')
      if (typeof data.title !== 'string' || !data.title.trim())
        return fail('Supply a nonempty frontmatter title.')
      return [] // Custom landing layouts can supply their own visible heading.
    } catch {
      return fail('Use valid YAML frontmatter.')
    }
  }
  if (!/^#\s+\S/m.test(withoutCode(text))) return fail('Supply a level-one document heading.')
  return []
}

export function linkFindings(file: string, text: string, repository = root): Finding[] {
  const findings: Finding[] = []
  const source = withoutCode(text)
  const check = (target: string, offset: number) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)) return
    const [path, fragment] = target.split('#', 2)
    let destination: string
    let anchor: string | undefined
    try {
      destination = path
        ? resolve(repository, dirname(file), decodeURIComponent(path.split('?')[0]))
        : resolve(repository, file)
      anchor = fragment ? decodeURIComponent(fragment) : undefined
    } catch {
      findings.push({
        file,
        line: source.slice(0, offset).split('\n').length,
        message: 'Use a valid encoded link.',
      })
      return
    }
    const line = source.slice(0, offset).split('\n').length
    if (!existsSync(destination))
      findings.push({ file, line, message: `Missing local link: ${target}` })
    else if (
      anchor &&
      extname(destination) === '.md' &&
      !headingIds(readFileSync(destination, 'utf8')).has(anchor)
    ) {
      findings.push({ file, line, message: `Missing heading anchor: ${target}` })
    }
  }
  for (const match of source.matchAll(
    /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
  )) {
    check(match[1] ?? match[2], match.index!)
  }
  for (const match of source.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm))
    check(match[1] ?? match[2], match.index!)
  return findings
}

type Paragraph = { line: number; text: string }
function paragraphs(text: string): Paragraph[] {
  if (text.startsWith('---\n'))
    text = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, (value) => value.replace(/[^\n]/g, ' '))
  const rows = withoutCode(text).split('\n')
  const result: Paragraph[] = []
  let block: string[] = []
  let start = 0
  const flush = () => {
    if (block.length)
      result.push({ line: start + 1, text: block.join(' ').replace(/\s+/g, ' ').trim() })
    block = []
  }
  rows.forEach((row, index) => {
    if (!row.trim() || /^\s*(?:#|<|:::|\$\$)/.test(row)) {
      flush()
      return
    }
    if (/^\s*\|/.test(row)) {
      flush()
      // Escaped pipes are literal values, not cell delimiters.
      row
        .replace(/\\\|/g, 'PIPE')
        .split('|')
        .slice(1, -1)
        .forEach((cell) => {
          if (cell.trim() && !/^\s*:?-+:?\s*$/.test(cell))
            result.push({ line: index + 1, text: cell.trim() })
        })
      return
    }
    if (/^\s*(?:[-*+] |\d+\. )/.test(row)) flush()
    if (!block.length) start = index
    block.push(row.replace(/^\s*(?:[-*+] |\d+\. )/, '').replace(/^\s*>\s?/, ''))
  })
  flush()
  return result
}

function paragraphKey(text: string): string {
  return text.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
}
export function styleFindings(
  file: string,
  text: string,
  baseline: string | Map<string, number> = '',
): Finding[] {
  const existing = typeof baseline === 'string' ? new Map<string, number>() : baseline
  if (typeof baseline === 'string') {
    for (const paragraph of paragraphs(baseline)) {
      const key = paragraphKey(paragraph.text)
      existing.set(key, (existing.get(key) ?? 0) + 1)
    }
  }
  const findings: Finding[] = []
  for (const paragraph of paragraphs(text)) {
    const prose = paragraphKey(paragraph.text)
    const count = existing.get(prose) ?? 0
    if (count) {
      existing.set(prose, count - 1)
      continue
    }
    if (prose.includes(';'))
      findings.push({ file, line: paragraph.line, message: 'Remove prose semicolons.' })
    // Protect decimal points and common abbreviations before splitting sentences.
    const sentences = prose
      .replace(/(\d)\.(?=\d)/g, '$1DECIMAL')
      .replace(/\b(?:e\.g|i\.e)\./g, 'EXAMPLE')
      .split(/[.!?](?:\s+|$)/)
      .filter((value) => value.trim())
    if (sentences.length > 6)
      findings.push({
        file,
        line: paragraph.line,
        message: `Divide this ${sentences.length}-sentence paragraph (maximum 6).`,
      })
    for (const sentence of sentences) {
      const limit =
        /^(?:Use|Read|Run|Check|Keep|Set|Open|Close|Remove|Add|Write|Supply|Select|Choose|Inspect|Preserve|Do not|Never|Wait|Follow|Verify|Validate|Ensure|Reject|Require|Avoid|Limit|Replace|Create|Update|Report|Confirm)\b/i.test(
          sentence.trim(),
        )
          ? 20
          : 25
      const words =
        sentence.replace(/\bCODE\b/g, '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ??
        0
      if (words > limit)
        findings.push({
          file,
          line: paragraph.line,
          message: `Shorten this ${words}-word sentence (maximum ${limit}).`,
        })
    }
  }
  return findings
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
export function renderedFindings(sites: string): Finding[] {
  const findings: Finding[] = []
  const origins: Record<string, string> = { 'jig.md': 'jig', 'flow.jig.md': 'flow' }
  const ids = new Map<string, Set<string>>()
  const ownSite = 'jig'
  const selectedSites = ['flow', 'jig'].filter((site) =>
    existsSync(join(sites, site, 'index.html')),
  )
  if (!selectedSites.includes(ownSite)) throw new Error(`Missing built ${ownSite} site.`)
  for (const site of selectedSites) {
    const directory = resolve(sites, site)
    if (!existsSync(join(directory, 'index.html'))) throw new Error(`Missing built ${site} site.`)
    for (const file of walk(directory).filter((path) => path.endsWith('.html'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
        const url = new URL(
          match[1].replace(/&amp;/g, '&'),
          `https://${site === 'jig' ? 'jig.md' : 'flow.jig.md'}/${relative(directory, file).split(sep).join('/')}`,
        )
        if (!origins[url.hostname] || !selectedSites.includes(origins[url.hostname])) continue
        const destinationRoot = resolve(sites, origins[url.hostname])
        const requested = resolve(destinationRoot, '.' + decodeURIComponent(url.pathname))
        if (!requested.startsWith(destinationRoot + sep) && requested !== destinationRoot)
          throw new Error('A site link escaped its root.')
        const destination = [requested, requested + '.html', join(requested, 'index.html')].find(
          (path) => existsSync(path) && statSync(path).isFile(),
        )
        if (!destination) {
          findings.push({
            file: relative(root, file),
            line: 1,
            message: `Missing rendered route: ${url.pathname}`,
          })
          continue
        }
        if (url.hash && destination.endsWith('.html')) {
          if (!ids.has(destination))
            ids.set(
              destination,
              new Set(
                [...readFileSync(destination, 'utf8').matchAll(/\bid=["']([^"']+)["']/g)].map(
                  (value) => value[1],
                ),
              ),
            )
          if (!ids.get(destination)!.has(decodeURIComponent(url.hash.slice(1))))
            findings.push({
              file: relative(root, file),
              line: 1,
              message: `Missing rendered anchor: ${url.pathname}${url.hash}`,
            })
        }
      }
    }
  }
  return findings
}

export function limitReferenceFindings(repository = root): Finding[] {
  const file = 'docs/jig/guide/limits.md'
  if (!existsSync(resolve(repository, file))) return []
  const script = resolve(repository, 'scripts/limit-reference.ts')
  if (!existsSync(script))
    return [{ file, line: 1, message: 'The limits reference requires scripts/limit-reference.ts.' }]
  try {
    execFileSync(process.execPath, [script, '--check'], {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    })
    return []
  } catch {
    return [
      {
        file,
        line: 1,
        message:
          'Limits reference check failed. Run bun scripts/limit-reference.ts --check for details, or --write to refresh its policy values.',
      },
    ]
  }
}

export function main(args = process.argv.slice(2)): number {
  let sites: string | undefined
  let base = process.env.DOCS_BASE_REVISION || (process.env.GITHUB_ACTIONS ? 'HEAD^' : 'HEAD')
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sites' && args[i + 1]) sites = args[++i]
    else if (args[i] === '--base' && args[i + 1]) base = args[++i]
    else throw new Error('Usage: bun scripts/check-docs.ts [--base REVISION] [--sites DIRECTORY]')
  }
  if (base.startsWith('-') || /^0+$/.test(base))
    throw new Error('Supply an existing baseline commit.')
  const commit = execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const baseFiles = new Set(
    execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', commit], {
      cwd: root,
      encoding: 'utf8',
    }).split('\0'),
  )
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean),
    ),
  ]
  const authoredSkill = (file: string) => /^skills\/[^/]+\/SKILL\.md$/.test(file)
  const docs = files.filter(
    (file) =>
      file.endsWith('.md') &&
      (file.startsWith('docs/') ||
        authoredSkill(file) ||
        file.endsWith('AGENTS.md') ||
        file.endsWith('-guidance.md') ||
        file === '.agents/maintainer-guide.md'),
  )
  // The owner excludes this tutorial's style while it awaits replacement.
  const technical = (file: string) =>
    file !== 'docs/jig/guide/software-factory.md' &&
    (authoredSkill(file) ||
      file.endsWith('AGENTS.md') ||
      file.endsWith('-guidance.md') ||
      file === '.agents/maintainer-guide.md' ||
      /^docs\/(?:flow|jig)\/(?:guide|spec)\//.test(file))
  const inherited = new Map<string, number>()
  for (const file of baseFiles) {
    if (!file.endsWith('.md') || !technical(file)) continue
    const baseline = execFileSync('git', ['show', `${commit}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const paragraph of paragraphs(baseline)) {
      const key = paragraphKey(paragraph.text)
      inherited.set(key, (inherited.get(key) ?? 0) + 1)
    }
  }
  const findings: Finding[] = limitReferenceFindings()
  for (const file of docs) {
    if (!existsSync(join(root, file))) continue
    const text = readFileSync(join(root, file), 'utf8')
    findings.push(...linkFindings(file, text))
    if (/^docs\/(?:flow|jig)\//.test(file) && !file.endsWith('AGENTS.md'))
      findings.push(...metadataFindings(file, text))
    if (technical(file)) findings.push(...styleFindings(file, text, inherited))
  }
  if (sites) findings.push(...renderedFindings(sites))
  for (const finding of findings)
    console.error(`${finding.file}:${finding.line}: ${finding.message}`)
  console.log(
    `Checked ${docs.length} documents${sites ? ' and both rendered sites' : ''}; ${findings.length} findings.`,
  )
  return findings.length ? 1 : 0
}
if (import.meta.main) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Documentation checks failed.')
    process.exitCode = 1
  }
}
