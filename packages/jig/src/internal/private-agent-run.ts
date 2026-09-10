import { types as utilTypes } from 'node:util'
import type { AgentResult } from '@jigging/agent-method'

import { type ParsedInvocationContract, parseInvocationContract } from '../invocation-contract.js'
import { canonicalJson, type JsonObject, type JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import { comparePathBytes } from '../package/paths.js'
import { type CompiledSchema, compileSchemaFile } from '../schema/index.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const AGENT_RUN_CONTRACT_ID = 'https://jig.md/contracts/agent-run'
export const AGENT_RUN_CONTRACT_VERSION = '1.0.0'
export const AGENT_RUN_CONTRACT_DIGEST =
  'sha256:63ba08f956904d64d499efcd3e93ac19773c61f2efc7de2673a660eb80963cb3'

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SELECTED_SKILLS = 64
const MAX_PROJECTED_FILES = 1_024
const MAX_PROJECTED_BYTES = 1_048_576
const EMPTY_SKILLS: readonly string[] = Object.freeze([])

export interface AgentRunInput {
  readonly instructions: string
  readonly skills?: readonly string[]
  readonly responseSchema?: JsonObject
}

export interface PreparedAgentRunInput {
  /** The immutable, ordinary JSON/1 value accepted by the exact contract. */
  readonly input: AgentRunInput
  /** Always present; an omitted `input.skills` becomes the empty selection. */
  readonly selectedSkills: readonly string[]
}

export interface AgentRunSkillFile {
  /** Logical path relative to this skill's `skills/<name>/` root. */
  readonly path: string
  readonly size: number
  /** Return a fresh copy so a consumer cannot mutate the retained manifest. */
  bytes(): Uint8Array
}

export interface AgentRunSkill {
  readonly name: string
  readonly files: readonly AgentRunSkillFile[]
}

export interface AgentRunSkillManifest {
  readonly skills: readonly AgentRunSkill[]
  readonly fileCount: number
  readonly contentBytes: number
}

export type AgentRunValidationCode =
  | 'AGENT_RUN_CONTRACT_MISMATCH'
  | 'AGENT_RUN_RESULT_INVALID'
  | 'AGENT_RUN_JSON_INVALID'
  | 'AGENT_RUN_SKILL_SELECTION_INVALID'
  | 'AGENT_RUN_SKILL_UNKNOWN'
  | 'AGENT_RUN_SKILL_PROJECTION_LIMIT'
  | 'AGENT_RUN_SKILL_CONTENT_INVALID'
  | 'AGENT_RUN_INPUT_UNPREPARED'
  | 'AGENT_RUN_STRUCTURED_REQUIRED'

export class AgentRunValidationError extends Error {
  constructor(
    readonly code: AgentRunValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentRunValidationError'
  }
}

interface AgentRunSchemas {
  readonly input: CompiledSchema
  readonly result: CompiledSchema
}

interface PreparedInputState {
  readonly responseSchema?: CompiledSchema
}

const preparedInputs = new WeakMap<PreparedAgentRunInput, PreparedInputState>()

/** Reject every descriptor except the exact current Jig Agent Run contract. */
export function assertAgentRunContract(contract: ParsedInvocationContract): void {
  requireAgentRunSchemas(contract)
}

/** Snapshot and validate one method input before any Agent provider work. */
export function parseAgentRunInput(
  contract: ParsedInvocationContract,
  value: unknown,
): PreparedAgentRunInput {
  const schemas = requireAgentRunSchemas(contract)
  const inputValue = snapshotAgentJson(value, 'Agent Run input')
  schemas.input.validate(inputValue, 'AGENT_RUN_INPUT_INVALID')
  const input = inputValue as unknown as AgentRunInput
  const selectedSkills = validateSkillSelection(input.skills ?? EMPTY_SKILLS)
  const responseSchema = Object.hasOwn(input, 'responseSchema')
    ? compileSchemaFile(
        canonicalJson(input.responseSchema as JsonValue),
        'Agent Run responseSchema',
      )
    : undefined

  const prepared = Object.freeze({ input, selectedSkills })
  preparedInputs.set(
    prepared,
    Object.freeze({
      ...(responseSchema === undefined ? {} : { responseSchema }),
    }),
  )
  return prepared
}

/** Snapshot and validate one method result against its prepared input. */
export function parseAgentRunResult(
  contract: ParsedInvocationContract,
  input: PreparedAgentRunInput,
  value: unknown,
): AgentResult {
  const schemas = requireAgentRunSchemas(contract)
  const prepared = preparedInputs.get(input)
  if (prepared === undefined) {
    throw new AgentRunValidationError(
      'AGENT_RUN_INPUT_UNPREPARED',
      'Agent Run result validation requires an input returned by parseAgentRunInput',
    )
  }
  const resultValue = snapshotAgentJson(value, 'Agent Run result')
  schemas.result.validate(resultValue, 'AGENT_RUN_RESULT_INVALID')
  const result = resultValue as unknown as AgentResult
  if (prepared.responseSchema !== undefined) {
    if (result.outcome === 'done' && !Object.hasOwn(result.output, 'structured')) {
      throw new AgentRunValidationError(
        'AGENT_RUN_STRUCTURED_REQUIRED',
        'a completed Agent Run with responseSchema requires a structured result',
      )
    }
    if (Object.hasOwn(result.output, 'structured')) {
      prepared.responseSchema.validate(result.output.structured, 'AGENT_RUN_STRUCTURED_INVALID')
    }
  }
  return result
}

/**
 * Copy only the selected immediate `skills/<name>/` trees out of one captured
 * Package/1 snapshot. The returned manifest contains no package or host path.
 */
export async function projectAgentRunSkills(
  captured: CapturedPackage,
  selected: unknown,
): Promise<AgentRunSkillManifest> {
  const names = validateSkillSelection(selected)
  if (names.length === 0) {
    return Object.freeze({ skills: Object.freeze([]), fileCount: 0, contentBytes: 0 })
  }

  interface PlannedFile {
    readonly packagePath: string
    readonly relativePath: string
    readonly size: number
  }
  interface PlannedSkill {
    readonly name: string
    readonly files: readonly PlannedFile[]
  }

  const planned: PlannedSkill[] = []
  let fileCount = 0
  let contentBytes = 0
  for (const name of names) {
    const prefix = `skills/${name}/`
    const packageFiles = captured.files.filter((file) => file.path.startsWith(prefix))
    if (!packageFiles.some((file) => file.path === `${prefix}SKILL.md`)) {
      throw new AgentRunValidationError(
        'AGENT_RUN_SKILL_UNKNOWN',
        `Agent Run selected unavailable package-local skill ${name}`,
      )
    }
    const files = packageFiles
      .map((file): PlannedFile => {
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
          throw new AgentRunValidationError(
            'AGENT_RUN_SKILL_CONTENT_INVALID',
            `Agent Run skill file ${file.path} has an invalid captured size`,
          )
        }
        return Object.freeze({
          packagePath: file.path,
          relativePath: file.path.slice(prefix.length),
          size: file.size,
        })
      })
      .sort((left, right) => comparePathBytes(left.relativePath, right.relativePath))
    fileCount += files.length
    for (const file of files) contentBytes += file.size
    if (fileCount > MAX_PROJECTED_FILES || contentBytes > MAX_PROJECTED_BYTES) {
      throw new AgentRunValidationError(
        'AGENT_RUN_SKILL_PROJECTION_LIMIT',
        `Agent Run skill projection exceeds ${MAX_PROJECTED_FILES} files or ${MAX_PROJECTED_BYTES} bytes`,
      )
    }
    planned.push(Object.freeze({ name, files: Object.freeze(files) }))
  }

  const skills: AgentRunSkill[] = []
  for (const skill of planned) {
    const files: AgentRunSkillFile[] = []
    for (const file of skill.files) {
      const bytes = await captured.read(file.packagePath, file.size)
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size) {
        throw new AgentRunValidationError(
          'AGENT_RUN_SKILL_CONTENT_INVALID',
          `Agent Run skill file ${file.packagePath} does not match its captured size`,
        )
      }
      files.push(projectedFile(file.relativePath, bytes))
    }
    skills.push(Object.freeze({ name: skill.name, files: Object.freeze(files) }))
  }

  return Object.freeze({
    skills: Object.freeze(skills),
    fileCount,
    contentBytes,
  })
}

function requireAgentRunSchemas(contract: ParsedInvocationContract): AgentRunSchemas {
  if (
    contract === null ||
    typeof contract !== 'object' ||
    utilTypes.isProxy(contract) ||
    (Object.getPrototypeOf(contract) !== Object.prototype &&
      Object.getPrototypeOf(contract) !== null)
  ) {
    return contractMismatch('Agent Run contract must be an ordinary parsed descriptor')
  }
  const descriptorField = Object.getOwnPropertyDescriptor(contract, 'descriptor')
  const digestField = Object.getOwnPropertyDescriptor(contract, 'digest')
  if (
    descriptorField === undefined ||
    !('value' in descriptorField) ||
    !descriptorField.enumerable ||
    digestField === undefined ||
    !('value' in digestField) ||
    !digestField.enumerable
  ) {
    return contractMismatch('Agent Run contract fields must be ordinary data')
  }

  let parsed: ParsedInvocationContract
  try {
    const descriptor = snapshotPrivateOrdinaryJson(
      descriptorField.value,
      'Agent Run contract descriptor',
      (message) => new AgentRunValidationError('AGENT_RUN_CONTRACT_MISMATCH', message),
    )
    const channelsField = Object.getOwnPropertyDescriptor(contract, 'channelContracts')
    if (channelsField === undefined || !('value' in channelsField))
      return contractMismatch('Agent Run channel closure is absent')
    const channelDocuments = new Map<string, Uint8Array>()
    for (const [path, channel] of Map.prototype.entries.call(channelsField.value)) {
      const field = Object.getOwnPropertyDescriptor(channel, 'descriptor')
      if (field === undefined || !('value' in field))
        return contractMismatch('Agent Run channel descriptor is invalid')
      channelDocuments.set(
        path,
        canonicalJson(
          snapshotPrivateOrdinaryJson(
            field.value,
            'Agent channel contract',
            (message) => new TypeError(message),
          ),
        ),
      )
    }
    parsed = parseInvocationContract(
      canonicalJson(descriptor),
      'Agent Run contract',
      channelDocuments,
    )
  } catch (error) {
    if (error instanceof AgentRunValidationError) throw error
    const message = error instanceof Error ? error.message : String(error)
    return contractMismatch(`Agent Run contract descriptor is invalid: ${message}`)
  }

  if (
    parsed.descriptor.id !== AGENT_RUN_CONTRACT_ID ||
    parsed.descriptor.version !== AGENT_RUN_CONTRACT_VERSION ||
    parsed.digest !== AGENT_RUN_CONTRACT_DIGEST ||
    digestField.value !== parsed.digest ||
    parsed.profile !== 'single'
  ) {
    return contractMismatch('Agent Run requires the exact current 1.0.0 contract descriptor')
  }

  const input = parsed.schemas.get('/input')
  const result = parsed.schemas.get('/result')
  if (input === undefined || result === undefined) {
    return contractMismatch('Agent Run contract is missing its invocation schemas')
  }
  return Object.freeze({ input, result })
}

function validateSkillSelection(value: unknown): readonly string[] {
  let snapshot: JsonValue
  try {
    snapshot = snapshotPrivateOrdinaryJson(
      value,
      'Agent Run skill selection',
      (message) => new AgentRunValidationError('AGENT_RUN_SKILL_SELECTION_INVALID', message),
    )
  } catch (error) {
    if (error instanceof AgentRunValidationError) throw error
    throw error
  }
  if (!Array.isArray(snapshot) || snapshot.length > MAX_SELECTED_SKILLS) {
    throw new AgentRunValidationError(
      'AGENT_RUN_SKILL_SELECTION_INVALID',
      `Agent Run skills must be an array of at most ${MAX_SELECTED_SKILLS} LocalNames`,
    )
  }
  let prior: string | undefined
  const names: string[] = []
  for (const name of snapshot) {
    if (typeof name !== 'string' || name.length < 1 || name.length > 64 || !LOCAL_NAME.test(name)) {
      throw new AgentRunValidationError(
        'AGENT_RUN_SKILL_SELECTION_INVALID',
        'Agent Run skills must contain only LocalNames',
      )
    }
    if (prior !== undefined && comparePathBytes(prior, name) >= 0) {
      throw new AgentRunValidationError(
        'AGENT_RUN_SKILL_SELECTION_INVALID',
        'Agent Run skills must be unique and strictly ordered by unsigned UTF-8 bytes',
      )
    }
    names.push(name)
    prior = name
  }
  return Object.freeze(names)
}

function projectedFile(path: string, source: Uint8Array): AgentRunSkillFile {
  const retained = Uint8Array.from(source)
  return Object.freeze({
    path,
    size: retained.byteLength,
    bytes(): Uint8Array {
      return Uint8Array.from(retained)
    },
  })
}

function snapshotAgentJson(value: unknown, label: string): JsonValue {
  return snapshotPrivateOrdinaryJson(
    value,
    label,
    (message) => new AgentRunValidationError('AGENT_RUN_JSON_INVALID', message),
  )
}

function contractMismatch(message: string): never {
  throw new AgentRunValidationError('AGENT_RUN_CONTRACT_MISMATCH', message)
}
