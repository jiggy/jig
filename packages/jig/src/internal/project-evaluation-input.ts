import { createHash } from 'node:crypto'
import { type CapturedPackage, createCapturedPackage } from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { assertNoPathCollisions } from '../package/paths.js'
import { type PrivateCapturedOutput, requirePrivateCapturedOutput } from './captured-output.js'
import { privateDescriptorByteChunks } from './descriptor-byte-stream.js'
import {
  type PrivateProjectEvaluationPhase,
  requirePrivateProjectEvaluationOutputFiles,
} from './project-evaluation-execution.js'
import { PROJECT_EVALUATION_LIMITS } from './project-evaluation-policy.js'

const OWNED_ROOTS = new Set([
  '.git',
  '.jig',
  'node_modules',
  'generated',
  'dist',
  'reports',
  'scratch',
  '.jig-evaluation.json',
])

export class PrivateProjectEvaluationReviewRequiredError extends Error {
  constructor() {
    super('candidate manifest or lock differs from the reviewed evaluation recipe')
  }
}

/** Validate the actual held artifact; metadata/hashes cannot mint its authority. */
export async function requirePrivateProjectEvaluationCandidate(
  candidate: PrivateCapturedOutput,
  reviewed: CapturedPackage,
): Promise<void> {
  const held = requirePrivateCapturedOutput(candidate)
  if (
    held.files.length > PROJECT_EVALUATION_LIMITS.candidateFiles ||
    held.bytes > PROJECT_EVALUATION_LIMITS.candidateBytes
  )
    throw new TypeError('evaluation candidate exceeds its finite profile')
  for (const path of [...held.files.map((file) => file.path), ...held.directories]) {
    if (
      Buffer.byteLength(path) > 256 ||
      path.split('/').length > 16 ||
      !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
      path.split('/').some((part) => part === '.' || part === '..')
    )
      throw new TypeError('evaluation candidate path exceeds its finite profile')
    if (OWNED_ROOTS.has(path.split('/')[0]!.toLowerCase()))
      throw new TypeError('evaluation candidate shadows a host-owned root')
  }
  assertNoPathCollisions([...held.files.map((file) => file.path)])
  for (const path of ['package.json', 'bun.lock']) {
    const original = held.files.find((file) => file.path === path)
    if (original === undefined) continue
    const bytes = await reviewed.read(path, PROJECT_EVALUATION_LIMITS.recipeBytes)
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (original.bytes !== bytes.length || original.digest !== digest)
      throw new PrivateProjectEvaluationReviewRequiredError()
  }
}

interface Member {
  readonly path: string
  readonly size: number
  readonly stream: () => AsyncIterable<Uint8Array>
}

export interface PrivateProjectEvaluationWorkspaceCapture extends CapturedPackage {
  readonly emptyDirectories: readonly string[]
}

/**
 * Immutable, borrowing merged view for one native phase. No source is reread
 * from a host path. Disposal revokes only this view, not borrowed snapshots.
 * The owning controller keeps C/R/D/prior readers alive through native sealing.
 */
export async function capturePrivateProjectEvaluationWorkspace(input: {
  readonly candidate: PrivateCapturedOutput
  readonly reviewed: CapturedPackage
  readonly dependencies: CapturedPackage
  readonly compiler: Readonly<Record<string, unknown>>
  readonly phase: PrivateProjectEvaluationPhase
  readonly prior: readonly PrivateCapturedOutput[]
  readonly signal: AbortSignal
}): Promise<PrivateProjectEvaluationWorkspaceCapture> {
  await requirePrivateProjectEvaluationCandidate(input.candidate, input.reviewed)
  input.signal.throwIfAborted()
  const members = new Map<string, Member>()
  const directories = new Set(requirePrivateCapturedOutput(input.candidate).directories)
  const putPackage = (source: CapturedPackage, selected: (path: string) => boolean) => {
    for (const file of source.files) {
      if (!selected(file.path)) continue
      if (members.has(file.path)) throw new TypeError('evaluation workspace inputs overlap')
      members.set(file.path, {
        ...file,
        stream: () => source.stream(file.path, file.size),
      })
    }
  }
  const putSnapshot = (snapshot: PrivateCapturedOutput, replace: boolean) => {
    const held = requirePrivateCapturedOutput(snapshot)
    for (const file of held.files) {
      if (!replace && members.has(file.path))
        throw new TypeError('evaluation workspace inputs overlap')
      members.set(file.path, {
        path: file.path,
        size: file.bytes,
        async *stream() {
          // Recheck authentic capability on each stream, preserving original members.
          const current = requirePrivateCapturedOutput(snapshot)
          for (const chunk of privateDescriptorByteChunks(current.fd, file.bytes, file.offset)) {
            input.signal.throwIfAborted()
            yield Uint8Array.from(chunk)
          }
        },
      })
    }
  }
  const dependencies = input.dependencies.files.filter((file) =>
    file.path.startsWith('node_modules/'),
  )
  if (
    dependencies.length > PROJECT_EVALUATION_LIMITS.dependencyFiles ||
    dependencies.reduce((sum, file) => sum + file.size, 0) >
      PROJECT_EVALUATION_LIMITS.dependencyBytes ||
    !dependencies.some((file) => file.path === 'node_modules/typescript/lib/tsc.js')
  )
    throw new TypeError('evaluation requires its complete bounded reviewed TypeScript closure')
  putPackage(input.dependencies, (path) => path.startsWith('node_modules/'))
  putSnapshot(input.candidate, false)
  // Candidate manifests, if present, were proved identical. Reviewed bytes win.
  for (const path of ['package.json', 'bun.lock']) members.delete(path)
  putPackage(input.reviewed, (path) => path === 'package.json' || path === 'bun.lock')
  for (const prior of input.prior) {
    const held = requirePrivateCapturedOutput(prior)
    requirePrivateProjectEvaluationOutputFiles(held.files, ['generated', 'dist', 'reports'])
    putSnapshot(prior, true)
    for (const path of held.directories) directories.add(path)
  }
  // A later phase may read previous reports, but tests receive fresh reports.
  const fresh =
    input.phase === 'generate'
      ? ['generated', 'reports']
      : input.phase === 'compile'
        ? ['dist']
        : ['reports']
  for (const path of members.keys()) if (fresh.includes(path.split('/')[0]!)) members.delete(path)
  const compiler = Buffer.from(JSON.stringify(input.compiler))
  members.set('.jig-evaluation.json', {
    path: '.jig-evaluation.json',
    size: compiler.length,
    async *stream() {
      yield Uint8Array.from(compiler)
    },
  })
  const files = [...members.values()].map(({ path, size }) => Object.freeze({ path, size }))
  assertNoPathCollisions(files.map((file) => file.path))
  let closed = false
  const stream = async function* (path: string) {
    if (closed) throw new Error('evaluation workspace view is closed')
    const member = members.get(path)
    if (member === undefined) throw new TypeError('evaluation workspace member is absent')
    for await (const bytes of member.stream()) {
      if (closed) throw new Error('evaluation workspace view is closed')
      input.signal.throwIfAborted()
      yield bytes
    }
  }
  const digest = await packageDigest(files, (file) => stream(file.path))
  const captured = createCapturedPackage(
    'controlled evaluation workspace',
    Object.freeze(files),
    digest,
    {
      stream,
      async dispose() {
        closed = true
      },
    },
  )
  const emptyDirectories = [...directories]
    .filter(
      (path) =>
        !fresh.includes(path.split('/')[0]!) &&
        !files.some((file) => file.path.startsWith(`${path}/`)),
    )
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  return Object.freeze({ ...captured, emptyDirectories: Object.freeze(emptyDirectories) })
}
