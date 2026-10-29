import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DisplayPreviewReply, DisplaySnapshot, WebAssets } from '@jigging/display-model'
import { validateDisplaySnapshot } from '@jigging/display-model'
import type { Reference } from '@jigging/reporting'
import { canonicalReportingMessage, decodeDisplayBundle } from '@jigging/reporting/validation'
import { cliShellWord } from './cli-discovery.js'
import { asciiJsonString, CliDiagnostic, usage } from './cli-usage.js'
import { PrivateWebDisplay } from './cli-web.js'
import {
  openPrivateDisplayArchive,
  type PrivateDisplayArchive,
  PrivateDisplayArchiveError,
  type PrivateDisplayBinding,
  type PrivateRetainedDisplayView,
  privateViewReferences,
} from './internal/display-archive.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'

const encoder = new TextEncoder()
const MAX_PRESENTED_VIEWS = 32
const MAX_PRESENTED_BYTES = 6 * 1024 * 1024
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024
const MAX_EVIDENCE_FILES = 64
export type PrivateDisplayBundleSelection = Readonly<{ attachment: string; path: string }>

/** Suppliers transfer detached verified copies. Optional reporting is never final material. */
export async function privateRetainDisplayBundle(
  input: Readonly<{
    directory: string
    selection: PrivateDisplayBundleSelection
    readOutput(attachment: string, path: string): Uint8Array | undefined
    readInput?(attachment: string, path: string): Uint8Array | undefined
    selectInput?(selection: readonly Readonly<{ attachment: string; path: string }>[]): void
    source: Readonly<{ runId: string; sourceId: string }>
    deadline: number
  }>,
): Promise<unknown> {
  const check = () => {
    if (!Number.isSafeInteger(input.deadline) || privatePresentationNow() >= input.deadline)
      throw new CliDiagnostic(
        'JIG_DISPLAY_PUBLICATION_DEADLINE',
        'The display publication allowance expired before acceptance.',
        1,
      )
  }
  check()
  const bytes = input.readOutput(input.selection.attachment, input.selection.path)
  if (!bytes)
    throw new CliDiagnostic(
      'JIG_DISPLAY_BUNDLE_UNAVAILABLE',
      'The selected display bundle was not captured from verified final delivery.',
      1,
    )
  const capturedBundleDigest = digest(bytes)
  let bundle: ReturnType<typeof decodeDisplayBundle>
  try {
    bundle = decodeDisplayBundle(bytes)
  } catch {
    throw new CliDiagnostic(
      'JIG_DISPLAY_BUNDLE_INVALID',
      'The selected file is not a valid bounded display bundle. Encode it with the reporting SDK before delivery.',
      1,
    )
  } finally {
    bytes.fill(0)
  }
  const recovery = `Recover the original acceptance with:\n  $ jig views receipt --request=${cliShellWord(bundle.requestId)} --generation=${cliShellWord(bundle.generation)} --json`
  const references = new Map<string, Reference>()
  for (const item of bundle.views)
    for (const reference of privateViewReferences(item.view))
      references.set(canonicalReportingMessage(reference), reference)
  for (const reference of bundle.requiredEvidence ?? [])
    references.set(canonicalReportingMessage(reference), reference)
  input.selectInput?.(
    [...references.values()].filter((reference) => reference.kind === 'input-artifact'),
  )
  const bindings: PrivateDisplayBinding[] = []
  let archive: PrivateDisplayArchive | undefined
  let failure: CliDiagnostic | undefined
  let total = 0
  try {
    for (const reference of references.values()) {
      check()
      let content: Uint8Array | undefined
      if (reference.kind === 'artifact')
        content = input.readOutput(reference.attachment, reference.path)
      else if (reference.kind === 'input-artifact')
        content = input.readInput?.(reference.attachment, reference.path)
      else if (reference.kind === 'record') {
        const target = bundle.views.find((entry) => entry.view.id === reference.viewId)
        const collection = target?.view.sections
          .flatMap((section) => section.blocks)
          .find((value) => value.kind === 'collection' && value.id === reference.collectionId)
        const row =
          collection?.kind === 'collection'
            ? collection.rows.find((item) => item.id === reference.rowId)
            : undefined
        if (row) content = encoder.encode(canonicalReportingMessage(row))
      }
      if (
        content &&
        content.byteLength <= 16 * 1024 * 1024 &&
        total + content.byteLength <= MAX_EVIDENCE_BYTES
      ) {
        total += content.byteLength
        bindings.push({
          reference,
          state: 'retained',
          targetId: opaque([input.source.runId, input.source.sourceId, reference]),
          content,
        })
      } else {
        content?.fill(0)
        bindings.push({
          reference,
          state: 'unavailable',
          reason:
            reference.kind === 'call'
              ? 'Execution history is not retained in this publication.'
              : 'Exact evidence was not retained within the publication budget.',
        })
      }
    }
    archive = await openArchive(input.directory, false)
    check()
    return await archive.commit({
      bundle,
      capturedBundleDigest,
      source: input.source,
      bindings,
      deadline: input.deadline,
    })
  } catch (error) {
    const diagnostic = privateDisplayArchiveFailure(error)
    failure = new CliDiagnostic(
      diagnostic.code,
      `${diagnostic.message}\n${recovery}`,
      diagnostic.exitCode,
    )
    throw failure
  } finally {
    try {
      if (archive)
        await closeArchive(
          archive,
          failure ?? new CliDiagnostic('JIG_DISPLAY_PUBLICATION_RECOVERY', recovery, 1),
        )
    } finally {
      for (const binding of bindings) if (binding.state === 'retained') binding.content.fill(0)
    }
  }
}

export type PrivateViewsCommand = Readonly<{
  operation: 'list' | 'context' | 'receipt' | 'remove' | 'reset'
  json: boolean
  display: 'plain' | 'web'
  requestId?: string
  definitionId?: string
  instanceKey?: string
  expectedRevision?: string
  generation?: string
}>
export function privateParseViews(arguments_: readonly string[]): PrivateViewsCommand {
  let operation: PrivateViewsCommand['operation'] = 'list'
  let index = 1
  const selected = arguments_[index]
  if (selected && !selected.startsWith('--')) {
    if (!['list', 'context', 'receipt', 'remove', 'reset'].includes(selected))
      usage('views', 'Choose list, context, receipt, remove, or reset.')
    operation = selected as PrivateViewsCommand['operation']
    index++
  }
  const values = new Map<string, string>()
  let json = false
  for (; index < arguments_.length; index++) {
    const token = arguments_[index]!
    if (token === '--json' && !json) {
      json = true
      continue
    }
    const equals = token.indexOf('=')
    const option = equals < 0 ? token : token.slice(0, equals)
    if (
      ![
        '--display',
        '--request',
        '--definition',
        '--instance',
        '--expected-revision',
        '--generation',
      ].includes(option) ||
      values.has(option)
    )
      usage('views', 'Supply each supported option at most once.')
    const value = equals < 0 ? arguments_[++index] : token.slice(equals + 1)
    if (
      !value ||
      (equals < 0 && value.startsWith('--')) ||
      [...value].length > 128 ||
      /[\r\n\u2028\u2029]/u.test(value)
    )
      usage('views', `${option} requires one bounded value.`)
    values.set(option, value)
  }
  const display = values.get('--display') ?? 'plain'
  if (display !== 'plain' && display !== 'web') usage('views', '--display accepts plain or web.')
  const allowed =
    operation === 'list'
      ? ['--display', '--definition', '--instance']
      : operation === 'receipt'
        ? ['--request', '--generation']
        : operation === 'remove'
          ? ['--definition', '--instance', '--expected-revision']
          : operation === 'reset'
            ? ['--generation']
            : []
  if ([...values.keys()].some((key) => !allowed.includes(key)))
    usage('views', 'That option does not apply to the selected operation.')
  if (operation === 'receipt' && (!values.has('--request') || !values.has('--generation')))
    usage('views', 'Receipt lookup requires --request ID and its original --generation.')
  if (
    operation === 'remove' &&
    ['--definition', '--instance', '--expected-revision'].some((key) => !values.has(key))
  )
    usage('views', 'Removal requires --definition, --instance, and --expected-revision.')
  if (operation === 'reset' && !values.has('--generation'))
    usage('views', 'Reset requires the current --generation.')
  if (values.has('--instance') && !values.has('--definition'))
    usage('views', '--instance requires --definition.')
  return {
    operation,
    json,
    display,
    ...(values.has('--request') ? { requestId: values.get('--request')! } : {}),
    ...(values.has('--definition') ? { definitionId: values.get('--definition')! } : {}),
    ...(values.has('--instance') ? { instanceKey: values.get('--instance')! } : {}),
    ...(values.has('--expected-revision')
      ? { expectedRevision: values.get('--expected-revision')! }
      : {}),
    ...(values.has('--generation') ? { generation: values.get('--generation')! } : {}),
  }
}

export async function privateExecuteViews(
  arguments_: readonly string[],
  runtime: Readonly<{
    currentDirectory: string
    humanOutput: boolean
    terminalError: boolean
    signal?: AbortSignal
    presentationDeadline?: number
    assets: WebAssets
    writeRecord(text: string): Promise<void>
    writeError(text: string): void
  }>,
): Promise<number> {
  const parsed = privateParseViews(arguments_)
  const check = () => {
    runtime.signal?.throwIfAborted()
    if (
      runtime.presentationDeadline !== undefined &&
      privatePresentationNow() >= runtime.presentationDeadline
    )
      throw new CliDiagnostic(
        'JIG_DISPLAY_INSPECTION_DEADLINE',
        'The inherited presentation allowance expired before the archive operation.',
        1,
      )
  }
  check()
  const archive = await openArchive(runtime.currentDirectory, parsed.operation === 'context')
  let failure: CliDiagnostic | undefined
  try {
    check()
    if (parsed.operation === 'context') {
      const { generation, heads } = await archive.state()
      await runtime.writeRecord(`${JSON.stringify({ generation, heads })}\n`)
      return 0
    }
    if (parsed.operation === 'receipt') {
      const receipt = await archive.receipt(parsed.requestId!, parsed.generation!)
      await runtime.writeRecord(`${JSON.stringify(receipt ?? null)}\n`)
      return receipt ? 0 : 1
    }
    if (parsed.operation === 'remove') {
      await archive.remove(parsed.definitionId!, parsed.instanceKey!, parsed.expectedRevision!)
      await runtime.writeRecord(`${JSON.stringify({ removed: true })}\n`)
      return 0
    }
    if (parsed.operation === 'reset') {
      const generation = await archive.reset(parsed.generation!)
      await runtime.writeRecord(`${JSON.stringify({ generation })}\n`)
      return 0
    }
    const state = await archive.state()
    const selected = await archive.views({
      ...(parsed.definitionId ? { definitionId: parsed.definitionId } : {}),
      ...(parsed.instanceKey ? { instanceKey: parsed.instanceKey } : {}),
    })
    const heads = state.heads.filter(
      (head) =>
        head.retained &&
        (!parsed.definitionId || head.definitionId === parsed.definitionId) &&
        (!parsed.instanceKey || head.instanceKey === parsed.instanceKey),
    )
    await requireArchiveSnapshot(archive, state)
    if (parsed.json || !runtime.humanOutput) {
      await runtime.writeRecord(
        `${JSON.stringify({ generation: state.generation, heads, matched: heads.length, omitted: heads.length - selected.length, views: selected })}\n`,
      )
      return 0
    }
    if (parsed.display === 'web' && runtime.terminalError) {
      await presentArchive(archive, state, selected, heads.length, runtime)
      runtime.signal?.throwIfAborted()
    } else {
      await runtime.writeRecord(
        selected
          .map(
            (item) =>
              `${asciiJsonString(item.publication.view.title)} · ${asciiJsonString(item.publication.view.target.instanceKey)}\n  ${asciiJsonString(item.publication.view.summary)}\n  Edition: ${asciiJsonString(item.edition)} · ${item.publication.completeness}\n`,
          )
          .join('\n') || 'No retained application views.\n',
      )
      if (heads.length > selected.length)
        await runtime.writeRecord(
          `${heads.length - selected.length} additional views exceed this presentation profile. Use --definition and --instance to select them.\n`,
        )
    }
    return 0
  } catch (error) {
    failure = privateDisplayArchiveFailure(error)
    throw failure
  } finally {
    await closeArchive(archive, failure)
  }
}

async function openArchive(project: string, create: boolean): Promise<PrivateDisplayArchive> {
  try {
    const parent = resolve(project, '.jig')
    const info = await lstat(parent)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new CliDiagnostic(
        'JIG_DISPLAY_ARCHIVE_UNSAFE',
        'The project requires an existing owner-only .jig directory.',
        1,
      )
    return await openPrivateDisplayArchive(resolve(parent, 'display'), { create })
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      throw new CliDiagnostic(
        'JIG_DISPLAY_ARCHIVE_MISSING',
        'Display storage is unavailable. Initialize the project, then run jig views context --json before constructing a publication.',
        1,
      )
    throw privateDisplayArchiveFailure(error)
  }
}
async function closeArchive(
  archive: PrivateDisplayArchive,
  primary?: CliDiagnostic,
): Promise<void> {
  try {
    await archive.close()
  } catch {
    throw new CliDiagnostic(
      'JIG_DISPLAY_ARCHIVE_CLEANUP',
      `${primary ? `${primary.message}\n` : ''}Display storage cleanup was not confirmed. Preserve the project and recover any original receipt before publishing again.`,
      2,
    )
  }
}
async function requireArchiveSnapshot(
  archive: PrivateDisplayArchive,
  expected: Awaited<ReturnType<PrivateDisplayArchive['state']>>,
): Promise<void> {
  if (canonicalReportingMessage(await archive.state()) !== canonicalReportingMessage(expected))
    throw new CliDiagnostic(
      'JIG_DISPLAY_ARCHIVE_CHANGED',
      'Retained views changed during capture. Repeat the inspection to read a coherent snapshot.',
      1,
    )
}

async function presentArchive(
  archive: PrivateDisplayArchive,
  archiveState: Awaited<ReturnType<PrivateDisplayArchive['state']>>,
  items: readonly PrivateRetainedDisplayView[],
  totalViews: number,
  runtime: Readonly<{
    signal?: AbortSignal
    presentationDeadline?: number
    assets: WebAssets
    writeError(text: string): void
  }>,
): Promise<void> {
  const retained: PrivateRetainedDisplayView[] = []
  let viewBytes = 0
  for (const item of items) {
    const size = encoder.encode(canonicalReportingMessage(item.publication.view)).byteLength
    if (retained.length >= MAX_PRESENTED_VIEWS || viewBytes + size > MAX_PRESENTED_BYTES) break
    retained.push(item)
    viewBytes += size
  }
  const content = new Map<string, Uint8Array>()
  const previews = new Map<string, DisplayPreviewReply>()
  const images = new Map<string, number>()
  let imageBytes = 0
  const presentation = new AbortController()
  let pendingPreview: Promise<Awaited<ReturnType<typeof archiveImage>>> | undefined
  let web: PrivateWebDisplay | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => {
    presentation.abort()
    void web?.close()
  }
  runtime.signal?.addEventListener('abort', abort, { once: true })
  const files: DisplaySnapshot['artifacts']['files'][number][] = []
  const inputFiles: NonNullable<DisplaySnapshot['inputs']>['files'][number][] = []
  const attempted = new Set<string>()
  let evidenceBytes = 0
  const generation = opaque([archiveState.generation, retained.map((item) => item.revision)])
  const check = () => {
    runtime.signal?.throwIfAborted()
    if (
      runtime.presentationDeadline !== undefined &&
      privatePresentationNow() >= runtime.presentationDeadline
    )
      throw new CliDiagnostic(
        'JIG_DISPLAY_INSPECTION_DEADLINE',
        'The inherited presentation allowance expired.',
        1,
      )
  }
  try {
    for (const item of retained)
      for (const reference of privateViewReferences(item.publication.view)) {
        check()
        if (reference.kind !== 'artifact' && reference.kind !== 'input-artifact') continue
        const id = opaque([item.source.runId, item.source.sourceId, reference])
        if (attempted.has(id) || attempted.size >= MAX_EVIDENCE_FILES) continue
        attempted.add(id)
        const result = await archive.evidence(
          item.publication.view.target.definitionId,
          item.publication.view.target.instanceKey,
          item.revision,
          reference,
        )
        if (!result?.content) continue
        if (evidenceBytes + result.content.byteLength > MAX_EVIDENCE_BYTES) {
          result.content.fill(0)
          continue
        }
        content.set(id, result.content)
        evidenceBytes += result.content.byteLength
        let text: string | undefined
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(
            result.content.subarray(0, 4096),
            { stream: result.content.length > 4096 },
          )
        } catch {
          /* Binary evidence remains downloadable. */
        }
        const { privateImageSourceCandidate } = await import('./internal/image-preview.js')
        const state = privateImageSourceCandidate(Buffer.from(result.content.subarray(0, 1024)))
          ? ('image' as const)
          : !result.content.byteLength
            ? ('empty' as const)
            : text !== undefined
              ? ('text' as const)
              : ('non-text' as const)
        const preview: DisplayPreviewReply = {
          artifactId: id,
          captureGeneration: generation,
          provenance: reference.kind === 'input-artifact' ? 'captured-input' : 'recorded-capture',
          state: state === 'image' ? 'non-text' : state,
          ...(text !== undefined ? { text } : {}),
          bytes: result.content.byteLength,
          clipped: result.content.length > 4096,
        }
        previews.set(id, preview)
        const file = {
          id,
          sourceId: sourceKey(item),
          attachment: reference.attachment,
          path: reference.path,
          bytes: result.content.length,
          state,
          clipped: preview.clipped,
          downloadable: true,
        }
        if (reference.kind === 'input-artifact') inputFiles.push(file)
        else files.push(file)
      }
    const omitted = totalViews - retained.length
    const snapshot: DisplaySnapshot = {
      kind: 'snapshot',
      revision: 1,
      mode: 'retained-views',
      rootSourceId: 'archive',
      workspace: {
        target: 'Application views',
        phase: 'settled',
        hostStage: 'Retained presentation',
        elapsedMs: 0,
      },
      context: `Retained application projections. Currency is unknown without a current application revision.${omitted ? ` ${omitted} additional views exceed this presentation profile; select --definition and --instance to inspect them.` : ''}`,
      omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
      views: retained.map((item) => ({
        id: opaque([sourceKey(item), item.publication.view.id]),
        sourceId: sourceKey(item),
        sourceLabel: 'Retained application publication',
        updatedAt: 0,
        ended: `${item.publication.completeness} · edition ${item.edition}`,
        value: item.publication.view,
      })),
      calls: [],
      activities: [],
      journal: [],
      attention: [],
      artifacts: {
        generation,
        sourceId: 'archive',
        provenance: 'recorded-capture',
        phase: 'ready',
        permittedAttachments: [...new Set(files.map((file) => file.attachment!))],
        files,
      },
      ...(inputFiles.length
        ? {
            inputs: {
              generation,
              sourceId: 'archive',
              provenance: 'captured-input' as const,
              phase: 'ready' as const,
              permittedAttachments: [...new Set(inputFiles.map((file) => file.attachment!))],
              files: inputFiles,
            },
          }
        : {}),
    }
    validateDisplaySnapshot(snapshot)
    await requireArchiveSnapshot(archive, archiveState)
    check()
    web = PrivateWebDisplay.prepare({
      assets: runtime.assets,
      subscribe: () => () => undefined,
      onClose: () => presentation.abort(),
      onFailure: () => presentation.abort(),
      projection: {
        capture: (revision) => ({ ...snapshot, revision }),
        incomplete: (revision, reason, lastCompleteRevision) => ({
          kind: 'incomplete',
          revision,
          ...(lastCompleteRevision === undefined ? {} : { lastCompleteRevision }),
          mode: 'retained-views',
          rootSourceId: 'archive',
          reason,
          workspace: snapshot.workspace,
          context: snapshot.context,
          omissions: snapshot.omissions,
          attention: [],
          diagnostics: [],
        }),
        preview: async (id) => {
          const preview = previews.get(id),
            bytes = content.get(id),
            file = [...files, ...inputFiles].find((item) => item.id === id)
          if (!preview || !bytes || !file) return undefined
          if (images.has(id)) {
            const charge = images.get(id)!
            images.delete(id)
            images.set(id, charge)
            return preview
          }
          if (file.state !== 'image') return preview
          const task = archiveImage(bytes, presentation.signal, runtime.presentationDeadline)
          pendingPreview = task
          let image: Awaited<typeof task>
          try {
            image = await task
          } finally {
            if (pendingPreview === task) pendingPreview = undefined
          }
          if (!image || presentation.signal.aborted) return preview
          const charge = image.base64.length * 2
          while (imageBytes + charge > 2 * 1024 * 1024 && images.size) {
            const [oldId, oldCharge] = images.entries().next().value!
            images.delete(oldId)
            imageBytes -= oldCharge
            const { image: _image, ...plain } = previews.get(oldId)!
            previews.set(oldId, { ...plain, state: 'non-text' })
          }
          if (charge > 2 * 1024 * 1024) return preview
          const decoded = { ...preview, state: 'image' as const, image, clipped: false }
          previews.set(id, decoded)
          images.set(id, charge)
          imageBytes += charge
          return decoded
        },
        download: async (id, requestedGeneration) =>
          requestedGeneration === generation && content.has(id)
            ? {
                bytes: content.get(id)!,
                filename:
                  [...files, ...inputFiles]
                    .find((file) => file.id === id)
                    ?.path.split('/')
                    .at(-1) ?? 'artifact',
                captureGeneration: generation,
              }
            : undefined,
      },
    })
    check()
    web.activate()
    check()
    runtime.writeError(`Web display: ${web.launchUrl}\nUse Close inspection to finish.\n`)
    if (runtime.presentationDeadline !== undefined)
      timer = setTimeout(
        abort,
        Math.max(0, runtime.presentationDeadline - privatePresentationNow()),
      )
    await web.closed()
  } finally {
    presentation.abort()
    clearTimeout(timer)
    runtime.signal?.removeEventListener('abort', abort)
    try {
      await web?.close()
    } finally {
      try {
        await pendingPreview
      } finally {
        for (const bytes of content.values()) bytes.fill(0)
        content.clear()
        previews.clear()
        images.clear()
      }
    }
  }
}
async function archiveImage(bytes: Uint8Array, signal?: AbortSignal, deadline?: number) {
  const { privateImagePreview, privateImageSourceCandidate } = await import(
    './internal/image-preview.js'
  )
  if (!privateImageSourceCandidate(Buffer.from(bytes.subarray(0, 1024)))) return undefined
  return privateImagePreview(
    Buffer.from(bytes),
    signal,
    Math.min(privatePresentationNow() + 5000, deadline ?? Infinity),
  ).catch(() => undefined)
}
export function privateDisplayArchiveFailure(error: unknown): CliDiagnostic {
  if (error instanceof CliDiagnostic) return error
  if (error instanceof PrivateDisplayArchiveError) {
    const messages: Record<PrivateDisplayArchiveError['code'], string> = {
      INVALID:
        'The display publication is invalid. Construct it with the reporting SDK and a current publication context.',
      UNSAFE_STORE:
        'Display storage failed its integrity checks. Preserve the project for diagnosis before changing retained material.',
      CLOSED:
        'Display storage closed before the operation completed. Recover its receipt before repeating a publication.',
      EXPIRED:
        'The archive generation changed. Read jig views context --json and construct a new publication from current application state.',
      CONFLICT:
        'A selected view changed. Read jig views context --json and reconcile the application state before publishing again.',
      MISMATCH:
        'This request ID already names different material. Recover the original receipt and use a new request ID for new material.',
      CAPACITY:
        'The edition or retained archive exceeds a display limit. Reduce selected material, or inspect retained material before explicitly resetting the archive.',
      EVIDENCE_UNAVAILABLE:
        'Required exact evidence was unavailable. Check the declared output and selected input references before publishing again.',
      DEADLINE:
        'The publication allowance expired. Recover the original receipt before attempting another publication.',
    }
    return new CliDiagnostic(`JIG_DISPLAY_ARCHIVE_${error.code}`, messages[error.code], 1)
  }
  return new CliDiagnostic(
    'JIG_DISPLAY_ARCHIVE_UNAVAILABLE',
    'Display storage could not complete the operation. Preserve the project and recover any original receipt before publishing again.',
    error instanceof AggregateError ? 2 : 1,
  )
}
function sourceKey(item: PrivateRetainedDisplayView): string {
  return opaque([item.source.runId, item.source.sourceId])
}
function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
function opaque(value: unknown): string {
  return createHash('sha256').update(canonicalReportingMessage(value)).digest('hex')
}
