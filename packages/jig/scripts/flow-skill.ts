import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateLogicalPath } from '../src/package/paths.js'

type SkillFile = readonly [string, string]
interface PreparedFlowSkill {
  readonly revision: string
  readonly sha256: string
  readonly files: readonly SkillFile[]
}

function digest(files: readonly SkillFile[]): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

export async function readPreparedFlowSkill(path: string): Promise<PreparedFlowSkill> {
  const input = JSON.parse(await readFile(path, 'utf8')) as Partial<PreparedFlowSkill> | null
  if (
    !input ||
    typeof input.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(input.revision) ||
    !Array.isArray(input.files) ||
    input.files.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !entry[0].startsWith('flow/') ||
        validateLogicalPath(entry[0]) !== entry[0] ||
        typeof entry[1] !== 'string',
    ) ||
    !input.files.some(([name]) => name === 'flow/SKILL.md') ||
    new Set(input.files.map(([name]) => name)).size !== input.files.length ||
    digest(input.files) !== input.sha256
  ) {
    throw Error('The prepared FLOW skill input has invalid provenance or file contents')
  }
  return { revision: input.revision, sha256: input.sha256, files: input.files }
}

/** Resolve upstream HEAD once and capture only inert files from the resulting commit. */
async function captureFlowSkill(destination: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'jig-flow-skill-'))
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const git = (...args: string[]) =>
    utf8.decode(
      execFileSync('git', ['--no-replace-objects', '-C', directory, ...args], { timeout: 60_000 }),
    )
  try {
    git('init', '--bare', '--quiet')
    git('fetch', '--quiet', '--no-tags', '--depth=1', 'https://github.com/jiggy/flow.git', 'HEAD')
    const revision = git('rev-parse', '--verify', 'FETCH_HEAD^{commit}').trim()
    const files = git('ls-tree', '-r', '-z', revision, '--', 'skills/flow')
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const match = /^100644 blob ([0-9a-f]{40})\tskills\/(flow\/.+)$/.exec(entry)
        if (!match) throw Error('A FLOW skill input is not a regular non-executable file')
        return [match[2]!, git('cat-file', 'blob', match[1]!)] as const
      })
    if (!files.some(([name]) => name === 'flow/SKILL.md')) throw Error('The FLOW skill is missing')
    const sha256 = digest(files)
    await writeFile(destination, `${JSON.stringify({ revision, sha256, files })}\n`, { flag: 'wx' })
    console.log(`Captured FLOW skill at ${revision} (SHA-256 ${sha256})`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const [destination, ...extra] = process.argv.slice(2)
  if (!destination || extra.length)
    throw Error('Usage: bun packages/jig/scripts/flow-skill.ts <output>')
  await captureFlowSkill(destination)
}
