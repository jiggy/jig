import { createHash } from 'node:crypto'
import { parseCapabilityContract, type ParsedCapabilityContract } from '../capability/index.js'
import { canonicalJson, type JsonValue } from '../json.js'
import { projectCommandPath, type ProjectCommands } from '../project/commands.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const PROJECT_COMMAND_CONTRACT_ID = 'https://jig.md/contracts/project-command'
export const PROJECT_COMMAND_CONTRACT_VERSION = '1.0.0'
export const PROJECT_COMMAND_CONTRACT_DIGEST =
  'sha256:aed62fe17f01897545f82d7ee91f163a023721431433c8f4f6981b4367c85bcf'
export const PROJECT_COMMAND_LIMITS = Object.freeze({
  files: 64,
  bytes: 262_144,
  streamBytes: 65_536,
  stdinBytes: 16_384,
  args: 32,
  argumentBytes: 1024,
  timeoutMs: 10_000,
})

export function isProjectCommandContract(value: {
  readonly id: unknown
  readonly version: unknown
  readonly digest: unknown
}): boolean {
  return (
    value.id === PROJECT_COMMAND_CONTRACT_ID &&
    value.version === PROJECT_COMMAND_CONTRACT_VERSION &&
    value.digest === PROJECT_COMMAND_CONTRACT_DIGEST
  )
}

export function assertProjectCommandContract(contract: ParsedCapabilityContract): void {
  const parsed = parseCapabilityContract(canonicalJson(contract.descriptor as unknown as JsonValue))
  if (
    !isProjectCommandContract({ ...parsed.descriptor, digest: parsed.digest }) ||
    parsed.digest !== contract.digest
  )
    throw new TypeError('expected the exact supported Project Command contract')
}

export interface ProjectCommandInput {
  readonly command: string
  readonly files: Readonly<Record<string, string>>
  readonly args?: readonly string[]
  readonly stdin?: string
}

export interface PreparedProjectCommand {
  readonly input: ProjectCommandInput
  readonly candidateDigest: string
  readonly invocation: readonly string[]
  readonly stdinDigest: string
}

export interface ProjectCommandResult {
  readonly candidateDigest: string
  readonly command: string
  readonly invocation: readonly string[]
  readonly stdinDigest: string
  readonly stdout: { readonly text: string; readonly truncated: boolean }
  readonly stderr: { readonly text: string; readonly truncated: boolean }
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stopReason: 'exited' | 'deadline' | 'cancelled'
  readonly cleanup: 'complete'
}

export function parseProjectCommandInput(
  value: unknown,
  commands: ProjectCommands,
): PreparedProjectCommand {
  const input = snapshotPrivateOrdinaryJson(
    value,
    'project command input',
    (message) => new TypeError(message),
  ) as unknown as ProjectCommandInput
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['command', 'files', 'args', 'stdin'].includes(key)) ||
    typeof input.command !== 'string' ||
    !Object.hasOwn(commands, input.command)
  )
    throw new TypeError('select a command from the admitted Binding commands')
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files))
    throw new TypeError('command files must be an object of UTF-8 source text')
  const paths = Object.keys(input.files).sort()
  if (paths.length === 0 || paths.length > PROJECT_COMMAND_LIMITS.files)
    throw new TypeError('command requires one to 64 candidate files')
  let bytes = 0
  for (const path of paths) {
    projectCommandPath(path)
    if (path.split('/').some((part) => ['node_modules', '.git', '.jig'].includes(part)))
      throw new TypeError('candidate contains a reserved project directory')
    if (paths.some((other) => path !== other && path.startsWith(`${other}/`)))
      throw new TypeError('candidate has a file/directory collision')
    const text = input.files[path]
    if (typeof text !== 'string') throw new TypeError('candidate files must be UTF-8 text')
    bytes += Buffer.byteLength(text)
  }
  if (bytes > PROJECT_COMMAND_LIMITS.bytes) throw new TypeError('candidate exceeds 256 KiB')
  const args = input.args === undefined ? [] : input.args
  if (
    !Array.isArray(args) ||
    args.length > PROJECT_COMMAND_LIMITS.args ||
    args.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.includes('\0') ||
        Buffer.byteLength(arg) > PROJECT_COMMAND_LIMITS.argumentBytes,
    )
  )
    throw new TypeError('command arguments exceed their bounded string profile')
  const stdin = input.stdin === undefined ? '' : input.stdin
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin) > PROJECT_COMMAND_LIMITS.stdinBytes)
    throw new TypeError('command stdin exceeds 16 KiB')
  const command = commands[input.command]!
  const selected = 'run' in command ? [command.run] : command.test
  if (selected.some((path) => !Object.hasOwn(input.files, path)))
    throw new TypeError('candidate omits a reviewed command file')
  if ('test' in command && args.length !== 0)
    throw new TypeError('test commands do not accept variable arguments')
  const invocation = Object.freeze(
    'run' in command ? ['bun', command.run, ...args] : ['bun', 'test', ...command.test],
  )
  return Object.freeze({
    input,
    invocation,
    candidateDigest: projectCommandCandidateDigest(input.files),
    stdinDigest: digest(Buffer.from(stdin)),
  })
}

/** Public identity: SHA-256 of canonical JSON/1 mapping paths to exact source text. */
export function projectCommandCandidateDigest(files: Readonly<Record<string, string>>): string {
  return digest(canonicalJson(files as JsonValue))
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
