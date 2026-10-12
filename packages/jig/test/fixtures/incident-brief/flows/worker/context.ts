import { createHash } from 'node:crypto'

export interface Context {
  readonly task: string
  readonly earlierContext: string
  readonly files: readonly { readonly path: string; readonly text: string }[]
  readonly laterInstructions: readonly { readonly revision: number; readonly text: string }[]
  readonly turnBudget: number
}

export function context(value: unknown): Readonly<Context> {
  const data = value as Context
  const text = (value: unknown, limit: number) =>
    typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= limit
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== 'object' ||
    Object.keys(data).some(
      (key) =>
        !['task', 'earlierContext', 'files', 'laterInstructions', 'turnBudget'].includes(key),
    ) ||
    !text(data.task, 4096) ||
    !text(data.earlierContext, 16384) ||
    !Array.isArray(data.files) ||
    data.files.length > 16 ||
    !Array.isArray(data.laterInstructions) ||
    data.laterInstructions.length > 8 ||
    !Number.isInteger(data.turnBudget) ||
    data.turnBudget < 1 ||
    data.turnBudget > 3
  )
    throw new TypeError(
      'Supply bounded task, earlierContext, files, ordered laterInstructions and turnBudget (1–3).',
    )
  const paths = new Set<string>()
  for (const file of data.files) {
    if (
      !file ||
      Object.keys(file).some((key) => !['path', 'text'].includes(key)) ||
      !text(file.path, 256) ||
      !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(file.path) ||
      paths.has(file.path) ||
      !text(file.text, 16384)
    )
      throw new TypeError(
        'Files need distinct relative labels and bounded text; they are data, not filesystem paths to read.',
      )
    paths.add(file.path)
  }
  let revision = 0
  for (const instruction of data.laterInstructions) {
    if (
      !instruction ||
      Object.keys(instruction).some((key) => !['revision', 'text'].includes(key)) ||
      !Number.isSafeInteger(instruction.revision) ||
      instruction.revision <= revision ||
      !text(instruction.text, 4096)
    )
      throw new TypeError('Later instructions need unique increasing revisions and bounded text.')
    revision = instruction.revision
  }
  if (Buffer.byteLength(JSON.stringify(data)) > 65536)
    throw new TypeError('Context exceeds 64 KiB.')
  // Reconstruct in fixed order; caller mutation and property insertion order
  // cannot change the handoff's preserved application snapshot.
  return Object.freeze({
    task: data.task,
    earlierContext: data.earlierContext,
    files: Object.freeze(
      data.files.map((file) => Object.freeze({ path: file.path, text: file.text })),
    ),
    laterInstructions: Object.freeze(
      data.laterInstructions.map((item) =>
        Object.freeze({ revision: item.revision, text: item.text }),
      ),
    ),
    turnBudget: data.turnBudget,
  })
}

export function identity(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
