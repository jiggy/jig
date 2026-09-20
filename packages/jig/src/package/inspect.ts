import { CHANNEL_CONTRACT_BYTES, type ParsedChannelContract } from '../channel-contract.js'
import { invalid, unavailable } from '../diagnostics.js'
import {
  INVOCATION_CONTRACT_LIMITS,
  type InvocationOperationDescriptor,
  invocationContractChannelPaths,
  type ParsedInvocationContract,
  parseInvocationContract,
} from '../invocation-contract.js'
import { type CompiledMarkdown, compileMarkdown, MARKDOWN_LIMITS } from '../markdown/parser.js'
import {
  type CompiledSchema,
  compileSchemaFile,
  SCHEMA_1_LIMITS,
  SchemaDiagnostic,
} from '../schema/index.js'
import { type CapturedPackage, capturePackageDirectory } from './capture.js'
import { type FlowMetadata, parseFlowMetadataPrefix, parseFlowMetadataSidecar } from './metadata.js'

const FLOW_FRONTMATTER_LIMIT = 262_144
const ENTRYPOINT_PREFIX_LIMIT = 82
const ENTRYPOINT = /^FLOW\.([a-z0-9]{1,16})(?![\s\S])/
const SELECTOR = /^#!\/usr\/bin\/env ([A-Za-z0-9][A-Za-z0-9._+-]{0,63})\r?$/

export type PackageMode = 'run'

/** Exact root implementation grammar shared by discovery and captured inspection. */
export function packageEntrypointSuffix(path: string): string | undefined {
  return ENTRYPOINT.exec(path)?.[1]
}

export interface PackageEntrypoint {
  readonly path: string
  readonly suffix: string
  readonly selector?: string
}

export interface CheckedContractReference {
  readonly slot: string
  readonly path: string
  readonly contract: ParsedInvocationContract
}

export interface InspectedPackage {
  readonly digest: string
  readonly mode: PackageMode
  readonly metadata: FlowMetadata
  readonly entrypoint: PackageEntrypoint
  readonly contract?: ParsedInvocationContract
  readonly markdown?: CompiledMarkdown
  /** Empty for an unconstrained package; absent for the unsupported named profile. */
  readonly invocation?: InvocationOperationDescriptor
  readonly schemas: Readonly<{
    input?: CompiledSchema
    settings?: CompiledSchema
    result?: CompiledSchema
  }>
  readonly usedContracts: readonly CheckedContractReference[]
  readonly fileCount: number
  readonly contentBytes: number
}

export interface PackageProfileIssue {
  readonly code: string
  readonly message: string
  readonly path: string
  readonly pointer?: string
}

/** Known static support failures; absence does not prove runtime or provider readiness. */
export function packageProfileIssue(inspected: InspectedPackage): PackageProfileIssue | undefined {
  if (inspected.contract?.profile === 'named') {
    return {
      code: 'PACKAGE_PROFILE_UNSUPPORTED',
      message: 'Named invocation operations are not supported by this execution profile.',
      path: 'FLOW.contract.json',
    }
  }
  const requiredNamed = inspected.usedContracts.find(({ contract }) => contract.profile === 'named')
  if (requiredNamed !== undefined) {
    return {
      code: 'PACKAGE_PROFILE_UNSUPPORTED',
      message: 'A required invocation interface uses unsupported named operations.',
      path: requiredNamed.path,
    }
  }
  const unknown = Object.keys(inspected.metadata.unknownFields)[0]
  const metadataPath = inspected.entrypoint.suffix === 'md' ? 'FLOW.md' : 'flow.meta.json'
  if (unknown !== undefined) {
    return {
      code: 'PACKAGE_METADATA_UNSUPPORTED',
      message: 'The package declares metadata whose execution meaning is unsupported.',
      path: metadataPath,
      pointer: `/${unknown.replaceAll('~', '~0').replaceAll('/', '~1')}`,
    }
  }
  const allowedTools = inspected.metadata['allowed-tools']
  if (allowedTools !== undefined) {
    const tools = allowedTools.replace(/^ +| +$/g, '')
    if (inspected.entrypoint.suffix !== 'md' || (tools !== '' && tools !== 'Read')) {
      return {
        code: 'PACKAGE_TOOLS_UNSUPPORTED',
        message: 'This runtime cannot enforce the declared allowed-tools restriction.',
        path: metadataPath,
        pointer: '/allowed-tools',
      }
    }
  }
  return undefined
}

export function requireSupportedPackageProfile(
  inspected: InspectedPackage,
  packagePath = '',
): void {
  const issue = packageProfileIssue(inspected)
  if (issue !== undefined)
    unavailable(
      issue.code,
      issue.message,
      packagePath ? `${packagePath}/${issue.path}` : issue.path,
      issue.pointer,
    )
}

/**
 * Validate one already captured Package/1 snapshot without executing code,
 * consulting a runtime, resolving providers, or claiming operational readiness.
 */
export async function inspectCapturedPackage(captured: CapturedPackage): Promise<InspectedPackage> {
  const byPath = new Map(captured.files.map((file) => [file.path, file]))
  const entrypoint = await inspectEntrypoint(captured)
  let metadata: FlowMetadata
  if (entrypoint.suffix === 'md') {
    if (byPath.has('flow.meta.json')) {
      invalid(
        'PACKAGE_METADATA_OWNER',
        'FLOW.md owns its optional frontmatter; flow.meta.json is not allowed beside it',
        'flow.meta.json',
      )
    }
    const metadataPrefix = await captured.readPrefix('FLOW.md', FLOW_FRONTMATTER_LIMIT + 1)
    metadata = parseFlowMetadataPrefix(metadataPrefix).metadata
    await validateUtf8File(captured, 'FLOW.md')
  } else {
    const sidecar = byPath.get('flow.meta.json')
    if (sidecar !== undefined && sidecar.size > FLOW_FRONTMATTER_LIMIT) {
      invalid('METADATA_LIMIT', 'metadata exceeds 262144 bytes', 'flow.meta.json')
    }
    metadata = parseFlowMetadataSidecar(
      sidecar === undefined
        ? new TextEncoder().encode('{}')
        : await captured.read('flow.meta.json', FLOW_FRONTMATTER_LIMIT),
    )
  }
  const mode: PackageMode = 'run'
  for (const path of ['input.schema.json', 'result.schema.json']) {
    if (byPath.has(path))
      invalid(
        'PACKAGE_SCHEMA_OWNER',
        `${path} is not an invocation declaration; use FLOW.contract.json`,
        path,
      )
  }
  const contractCache = new Map<string, ParsedInvocationContract>()
  const contract = byPath.has('FLOW.contract.json')
    ? await readContract(captured, byPath, contractCache, 'FLOW.contract.json')
    : undefined
  const invocation = contract === undefined ? Object.freeze({}) : contract.invocation
  const metadataPath = entrypoint.suffix === 'md' ? 'FLOW.md' : 'flow.meta.json'
  if (metadata.supports !== undefined)
    validateFeatureSelection(metadata.supports, contract, 'supports', metadataPath)
  const schemas: { input?: CompiledSchema; settings?: CompiledSchema; result?: CompiledSchema } = {}
  const input = contract?.schemas.get('/input')
  const result = contract?.schemas.get('/result')
  if (input !== undefined) schemas.input = input
  if (result !== undefined) schemas.result = result
  if (byPath.has('settings.schema.json')) {
    schemas.settings = compileSchemaFile(
      await readSchemaFile(captured, byPath, 'settings.schema.json'),
      'settings.schema.json',
    )
  }
  const usedContracts: CheckedContractReference[] = []
  for (const [slot, declaration] of Object.entries(metadata.uses ?? {})) {
    if (declaration.contract === undefined) continue
    const path = declaration.contract.slice(2)
    const usedContract = await readContract(captured, byPath, contractCache, path)
    if (usedContract.descriptor.id === undefined) {
      invalid(
        'CONTRACT_IDENTITY',
        'a dependency contract must declare an exact id and version',
        path,
      )
    }
    if (declaration.requires !== undefined)
      validateFeatureSelection(
        declaration.requires,
        usedContract,
        `uses.${slot}.requires`,
        metadataPath,
      )
    usedContracts.push(
      Object.freeze({
        slot,
        path,
        contract: usedContract,
      }),
    )
  }
  rejectContractEquivocation([...contractCache].map(([path, contract]) => ({ path, contract })))
  rejectChannelEquivocation(
    [...contractCache.values()].flatMap((contract) => [...contract.channelContracts.values()]),
  )

  let markdown: CompiledMarkdown | undefined
  if (entrypoint.suffix === 'md') {
    const maximum = FLOW_FRONTMATTER_LIMIT + MARKDOWN_LIMITS.bodyBytes
    if (byPath.get('FLOW.md')!.size > maximum)
      unavailable(
        'MARKDOWN_LIMIT',
        'Markdown source exceeds the combined frontmatter and body bounds.',
        'FLOW.md',
      )
    markdown = compileMarkdown(await captured.read('FLOW.md', maximum), {
      ...(contract === undefined ? {} : { contract }),
      usedContracts,
    })
  }

  return Object.freeze({
    digest: captured.digest,
    mode,
    metadata,
    entrypoint,
    ...(contract === undefined ? {} : { contract }),
    ...(markdown === undefined ? {} : { markdown }),
    ...(invocation === undefined ? {} : { invocation }),
    schemas: Object.freeze(schemas),
    usedContracts: Object.freeze(usedContracts),
    fileCount: captured.files.length,
    contentBytes: captured.files.reduce((total, file) => total + file.size, 0),
  })
}

function validateFeatureSelection(
  names: readonly string[],
  contract: ParsedInvocationContract | undefined,
  field: string,
  path: string,
): void {
  if (contract?.descriptor.id === undefined || contract.descriptor.operations !== undefined)
    invalid('PACKAGE_FEATURES', `${field} requires an identified single-form contract`, path)
  for (const name of names) {
    if (!Object.hasOwn(contract.descriptor.features ?? {}, name))
      invalid('PACKAGE_FEATURES', `${field} names an undeclared contract feature: ${name}`, path)
  }
}

function rejectChannelEquivocation(contracts: readonly ParsedChannelContract[]): void {
  const identities = new Map<string, string>()
  for (const contract of contracts) {
    const key = `${contract.descriptor.id}\0${contract.descriptor.version}`
    const previous = identities.get(key)
    if (previous !== undefined && previous !== contract.digest)
      invalid(
        'CHANNEL_EQUIVOCATION',
        'package carries conflicting channel meanings for one identity',
        contract.itemSchema.path,
      )
    identities.set(key, contract.digest)
  }
}

function rejectContractEquivocation(
  contracts: readonly { readonly path: string; readonly contract: ParsedInvocationContract }[],
): void {
  const seen = new Map<string, { readonly contract: ParsedInvocationContract }>()
  for (const reference of contracts) {
    const { id, version } = reference.contract.descriptor
    if (id === undefined) continue
    const key = `${id}\0${version}`
    const prior = seen.get(key)
    if (prior !== undefined && prior.contract.digest !== reference.contract.digest) {
      invalid(
        'CONTRACT_EQUIVOCATION',
        `package carries different meanings for invocation contract ${id}@${version}`,
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

async function inspectEntrypoint(captured: CapturedPackage): Promise<PackageEntrypoint> {
  const candidates = captured.files.filter(
    (file) => packageEntrypointSuffix(file.path) !== undefined,
  )
  if (candidates.length > 1) {
    invalid(
      'PACKAGE_ENTRYPOINT_AMBIGUOUS',
      `package has several root implementations: ${candidates.map((file) => file.path).join(', ')}`,
    )
  }
  const candidate = candidates[0]
  if (candidate === undefined)
    invalid(
      'PACKAGE_ENTRYPOINT_MISSING',
      'package must contain exactly one root FLOW.<ext> implementation',
    )
  const suffix = packageEntrypointSuffix(candidate.path)!
  if (suffix === 'md') return Object.freeze({ path: candidate.path, suffix })
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

async function readContract(
  captured: CapturedPackage,
  byPath: ReadonlyMap<string, { readonly size: number }>,
  cache: Map<string, ParsedInvocationContract>,
  path: string,
): Promise<ParsedInvocationContract> {
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
  if (file.size > INVOCATION_CONTRACT_LIMITS.bytes) {
    invalid(
      'CONTRACT_LIMIT',
      `invocation descriptor exceeds ${INVOCATION_CONTRACT_LIMITS.bytes} bytes`,
      path,
    )
  }
  const source = await captured.read(path, INVOCATION_CONTRACT_LIMITS.bytes)
  const references = invocationContractChannelPaths(source, path)
  const documents = new Map<string, Uint8Array>()
  const slash = path.lastIndexOf('/')
  const base = slash < 0 ? '' : path.slice(0, slash + 1)
  for (const relativePath of references) {
    const channelPath = `${base}${relativePath}`
    const channel = byPath.get(channelPath)
    if (channel === undefined)
      invalid(
        'PACKAGE_REFERENCE_MISSING',
        `channel agreement is missing: ${channelPath}`,
        channelPath,
      )
    if (channel.size > CHANNEL_CONTRACT_BYTES)
      invalid('CHANNEL_LIMIT', 'channel descriptor exceeds 256 KiB', channelPath)
    documents.set(relativePath, await captured.read(channelPath, CHANNEL_CONTRACT_BYTES))
  }
  const parsed = parseInvocationContract(source, path, documents)
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
