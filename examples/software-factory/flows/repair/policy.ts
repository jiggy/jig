export interface AcceptanceCase {
  id: string
  args: string[]
  stdin: string
  stdout: string
  stderr: string
  exitCode: number
}
export interface RepairInput {
  issue: string
  files: Record<string, string>
  editPaths: string[]
  cases: AcceptanceCase[]
}
export interface Proposal {
  replacements: { path: string; content: string }[]
  summary: string
}

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object.')
  return value as Record<string, any>
}
function keys(value: object, expected: string[]) {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(','))
    throw new TypeError('Unexpected or missing fields.')
}
export function text(value: unknown, bytes: number): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value) > bytes ||
    Buffer.from(value).toString('utf8') !== value ||
    value.includes('\0')
  )
    throw new TypeError('Expected bounded Unicode text without NUL.')
  return value
}
export function path(value: unknown): string {
  const name = text(value, 256)
  if (
    !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(name) ||
    name.split('/').length > 16 ||
    name.split('/').some((p) => ['node_modules', '.git', '.jig'].includes(p))
  )
    throw new TypeError('Unsupported project-relative path.')
  return name
}
export function digest(value: unknown): string {
  const canonical = (v: any): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : v !== null && typeof v === 'object'
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(',')}}`
        : JSON.stringify(v)
  return sha256(canonical(value))
}
export function sha256(value: string): string {
  return `sha256:${new Bun.CryptoHasher('sha256').update(value).digest('hex')}`
}
export function parseInput(value: unknown): RepairInput {
  const input = object(value)
  keys(input, ['issue', 'files', 'editPaths', 'cases'])
  const issue = text(input.issue, 8000)
  if (!issue.trim()) throw new TypeError('Supply the issue to repair.')
  const supplied = object(input.files),
    files: Record<string, string> = Object.create(null)
  if (Object.keys(supplied).length < 1 || Object.keys(supplied).length > 16)
    throw new TypeError('Supply 1–16 text files.')
  for (const [name, content] of Object.entries(supplied)) files[path(name)] = text(content, 65536)
  if (Object.values(files).reduce((sum, s) => sum + Buffer.byteLength(s), 0) > 65536)
    throw new TypeError('Project text exceeds 64 KiB.')
  if (
    Object.keys(files).some((a) => Object.keys(files).some((b) => a !== b && b.startsWith(`${a}/`)))
  )
    throw new TypeError('A project file conflicts with a directory.')
  if (!Array.isArray(input.editPaths) || input.editPaths.length < 1 || input.editPaths.length > 8)
    throw new TypeError('Select 1–8 existing source files to edit.')
  const editPaths = input.editPaths.map(path)
  if (
    new Set(editPaths).size !== editPaths.length ||
    editPaths.some(
      (p) => !Object.hasOwn(files, p) || !p.startsWith('src/') || !/\.(ts|js)$/.test(p),
    )
  )
    throw new TypeError('Only selected existing src/*.ts or src/*.js files may change.')
  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 8)
    throw new TypeError('Supply 1–8 independent CLI acceptance cases.')
  const cases = input.cases.map((v: unknown) => {
    const c = object(v)
    keys(c, ['id', 'args', 'stdin', 'stdout', 'stderr', 'exitCode'])
    if (
      !Array.isArray(c.args) ||
      c.args.length > 8 ||
      !Number.isInteger(c.exitCode) ||
      c.exitCode < 0 ||
      c.exitCode > 255
    )
      throw new TypeError('Invalid acceptance arguments or exit code.')
    return {
      id: text(c.id, 64),
      args: c.args.map((a: unknown) => text(a, 1024)),
      stdin: text(c.stdin, 8192),
      stdout: text(c.stdout, 8192),
      stderr: text(c.stderr, 8192),
      exitCode: c.exitCode,
    }
  })
  if (new Set(cases.map((c) => c.id)).size !== cases.length)
    throw new TypeError('Duplicate acceptance case.')
  return { issue, files, editPaths, cases }
}
export function parseProposal(value: unknown, input: RepairInput): Proposal {
  const proposal = object(value)
  keys(proposal, ['replacements', 'summary'])
  const summary = text(proposal.summary, 2000)
  if (
    !summary.trim() ||
    !Array.isArray(proposal.replacements) ||
    proposal.replacements.length < 1 ||
    proposal.replacements.length > input.editPaths.length
  )
    throw new TypeError('Supply replacement text for the selected source files and a summary.')
  const replacements = proposal.replacements.map((v: unknown) => {
    const file = object(v)
    keys(file, ['path', 'content'])
    if (!input.editPaths.includes(file.path))
      throw new TypeError('The proposal changes an unapproved file.')
    return { path: file.path as string, content: text(file.content, 65536) }
  })
  if (new Set(replacements.map((f) => f.path)).size !== replacements.length)
    throw new TypeError('The proposal repeats a path.')
  parseInput({ ...input, files: candidate(input, { replacements, summary }) })
  return { replacements, summary }
}
export function candidate(input: RepairInput, proposal: Proposal): Record<string, string> {
  return Object.assign(
    Object.create(null),
    input.files,
    Object.fromEntries(proposal.replacements.map((f) => [f.path, f.content])),
  )
}
