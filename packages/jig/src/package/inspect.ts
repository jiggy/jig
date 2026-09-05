import {
  CAPABILITY_CONTRACT_LIMITS,
  parseCapabilityContract,
  type ParsedCapabilityContract,
} from '../capability/index.js'
import {
  compileSchemaFile,
  SCHEMA_1_LIMITS,
  SchemaDiagnostic,
  type CompiledSchema,
} from '../schema/index.js'
import { invalid, unavailable } from '../diagnostics.js'
import { capturePackageDirectory, type CapturedPackage } from './capture.js'
import { parseFlowMetadataPrefix, type FlowMetadata } from './metadata.js'

const FLOW_FRONTMATTER_LIMIT = 262_144
const ENTRYPOINT_PREFIX_LIMIT = 82
const ENTRYPOINT = /^flow\.([a-z0-9]{1,16})$/
const SELECTOR = /^#!\/usr\/bin\/env ([A-Za-z0-9][A-Za-z0-9._+-]{0,63})\r?$/

export type PackageMode = 'run'

export interface PackageEntrypoint {
  readonly path: string
  readonly suffix: string
  readonly selector?: string
}

export interface CheckedContractReference {
  readonly slot: string
  readonly path: string
  readonly contract: ParsedCapabilityContract
}

export interface InspectedPackage {
  readonly digest: string
  readonly mode: PackageMode
  readonly metadata: FlowMetadata
  readonly entrypoint?: PackageEntrypoint
  readonly schemas: Readonly<{
    input?: CompiledSchema
    settings?: CompiledSchema
    result?: CompiledSchema
  }>
  readonly usedContracts: readonly CheckedContractReference[]
  readonly fileCount: number
  readonly contentBytes: number
}

/**
 * Validate one already captured Package/1 snapshot without executing code,
 * consulting a runtime, resolving providers, or claiming operational readiness.
 */
export async function inspectCapturedPackage(captured: CapturedPackage): Promise<InspectedPackage> {
  const byPath = new Map(captured.files.map((file) => [file.path, file]))
  const flowDocument = byPath.get('FLOW.md')
  if (flowDocument === undefined) {
    invalid('PACKAGE_FLOW_MISSING', 'package root has no exact-case FLOW.md', 'FLOW.md')
  }

  const metadataPrefix = await captured.readPrefix('FLOW.md', FLOW_FRONTMATTER_LIMIT + 1)
  const { metadata } = parseFlowMetadataPrefix(metadataPrefix)
  await validateUtf8File(captured, 'FLOW.md')

  const entrypoint = await inspectEntrypoint(captured)
  const mode: PackageMode = 'run'

  const schemas = await inspectConventionalSchemas(captured, byPath)
  const contractCache = new Map<string, ParsedCapabilityContract>()
  const usedContracts: CheckedContractReference[] = []
  for (const [slot, declaration] of Object.entries(metadata.uses ?? {})) {
    if (declaration.contract === undefined) continue
    const path = declaration.contract.slice(2)
    usedContracts.push(
      Object.freeze({
        slot,
        path,
        contract: await readContract(captured, byPath, contractCache, path),
      }),
    )
  }
  rejectContractEquivocation(usedContracts)

  return Object.freeze({
    digest: captured.digest,
    mode,
    metadata,
    ...(entrypoint === undefined ? {} : { entrypoint }),
    schemas: Object.freeze(schemas),
    usedContracts: Object.freeze(usedContracts),
    fileCount: captured.files.length,
    contentBytes: captured.files.reduce((total, file) => total + file.size, 0),
  })
}

function rejectContractEquivocation(contracts: readonly CheckedContractReference[]): void {
  const seen = new Map<string, CheckedContractReference>()
  for (const reference of contracts) {
    const { id, version } = reference.contract.descriptor
    const key = `${id}\0${version}`
    const prior = seen.get(key)
    if (prior !== undefined && prior.contract.digest !== reference.contract.digest) {
      invalid(
        'CAPABILITY_EQUIVOCATION',
        `package carries different bytes for capability contract ${id}@${version}`,
        reference.path,
      )
    }
    seen.set(key, reference)
  }
}

/** Capture, inspect, and release one local package directory. */
export async function checkPackageDirectory(source: string): Promise<InspectedPackage> {
  const captured = await capturePackageDirectory(source)
  try {
    return await inspectCapturedPackage(captured)
  } finally {
    await captured.dispose()
  }
}

async function inspectEntrypoint(
  captured: CapturedPackage,
): Promise<PackageEntrypoint | undefined> {
  const candidates = captured.files.filter(
    (file) => !file.path.includes('/') && ENTRYPOINT.test(file.path),
  )
  if (candidates.length > 1) {
    invalid(
      'PACKAGE_ENTRYPOINT_AMBIGUOUS',
      `package has several root implementations: ${candidates.map((file) => file.path).join(', ')}`,
    )
  }
  const candidate = candidates[0]
  if (candidate === undefined) return undefined
  const suffix = ENTRYPOINT.exec(candidate.path)![1]!
  const prefix = await captured.readPrefix(candidate.path, ENTRYPOINT_PREFIX_LIMIT)
  if (prefix[0] !== 0x23 || prefix[1] !== 0x21) {
    return Object.freeze({ path: candidate.path, suffix })
  }
  const newline = prefix.indexOf(0x0a)
  if (newline < 0 && candidate.size > prefix.byteLength) {
    invalid(
      'PACKAGE_SELECTOR',
      'entrypoint selector line exceeds the portable grammar',
      candidate.path,
    )
  }
  const lineBytes = prefix.subarray(0, newline < 0 ? prefix.byteLength : newline)
  let line: string
  try {
    line = new TextDecoder('utf-8', { fatal: true }).decode(lineBytes)
  } catch {
    invalid('PACKAGE_SELECTOR', 'entrypoint selector line is not valid UTF-8', candidate.path)
  }
  const match = SELECTOR.exec(line)
  if (match === null) {
    invalid(
      'PACKAGE_SELECTOR',
      'entrypoint begins with #! but has no valid Adapter selector',
      candidate.path,
    )
  }
  return Object.freeze({ path: candidate.path, suffix, selector: match[1]! })
}

async function inspectConventionalSchemas(
  captured: CapturedPackage,
  byPath: ReadonlyMap<string, { readonly path: string; readonly size: number }>,
): Promise<{ input?: CompiledSchema; settings?: CompiledSchema; result?: CompiledSchema }> {
  const present = (path: string): boolean => byPath.has(path)
  const result: { input?: CompiledSchema; settings?: CompiledSchema; result?: CompiledSchema } = {}
  if (present('input.schema.json')) {
    result.input = compileSchemaFile(
      await readSchemaFile(captured, byPath, 'input.schema.json'),
      'input.schema.json',
    )
  }
  if (present('settings.schema.json')) {
    result.settings = compileSchemaFile(
      await readSchemaFile(captured, byPath, 'settings.schema.json'),
      'settings.schema.json',
    )
  }
  if (present('result.schema.json')) {
    result.result = compileSchemaFile(
      await readSchemaFile(captured, byPath, 'result.schema.json'),
      'result.schema.json',
    )
  }
  return result
}

async function readContract(
  captured: CapturedPackage,
  byPath: ReadonlyMap<string, { readonly size: number }>,
  cache: Map<string, ParsedCapabilityContract>,
  path: string,
): Promise<ParsedCapabilityContract> {
  const file = byPath.get(path)
  if (file === undefined) {
    invalid(
      'PACKAGE_REFERENCE_MISSING',
      `contract reference does not name a package file: ${path}`,
      path,
    )
  }
  const prior = cache.get(path)
  if (prior !== undefined) return prior
  if (file.size > CAPABILITY_CONTRACT_LIMITS.bytes) {
    invalid(
      'CAPABILITY_LIMIT',
      `capability descriptor exceeds ${CAPABILITY_CONTRACT_LIMITS.bytes} bytes`,
      path,
    )
  }
  const parsed = parseCapabilityContract(
    await captured.read(path, CAPABILITY_CONTRACT_LIMITS.bytes),
    path,
  )
  cache.set(path, parsed)
  return parsed
}

async function readSchemaFile(
  captured: CapturedPackage,
  byPath: ReadonlyMap<string, { readonly size: number }>,
  path: string,
): Promise<Uint8Array> {
  const file = byPath.get(path)
  if (file === undefined) throw new Error(`internal schema lookup failed for ${path}`)
  if (file.size > SCHEMA_1_LIMITS.bytes) {
    throw new SchemaDiagnostic(`schema exceeds ${SCHEMA_1_LIMITS.bytes} encoded bytes`, {
      code: 'SCHEMA_LIMIT_EXCEEDED',
      instancePointer: '',
      schemaPointer: '',
      path,
    })
  }
  return captured.read(path, SCHEMA_1_LIMITS.bytes)
}

async function validateUtf8File(captured: CapturedPackage, logicalPath: string): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    for await (const chunk of captured.stream(logicalPath)) {
      decoder.decode(chunk, { stream: true })
    }
    decoder.decode()
  } catch (error) {
    if (error instanceof TypeError) {
      invalid('METADATA_INVALID_UTF8', `${logicalPath} is not valid UTF-8`, logicalPath)
    }
    const message = error instanceof Error ? error.message : String(error)
    unavailable('PACKAGE_STAGE_IO', `cannot read staged ${logicalPath}: ${message}`, logicalPath)
  }
}
