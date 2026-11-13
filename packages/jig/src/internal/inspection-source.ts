import { invalid } from '../diagnostics.js'
import type { CapturedPackage } from '../package/capture.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './inspection-policy.js'

export async function inspectionSources(
  captured: Pick<CapturedPackage, 'files' | 'read'>,
  members: readonly string[],
): Promise<{ sources: { source: string; sourcePath: string }[] }> {
  if (
    members.length === 0 ||
    members.length > PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage ||
    new Set(members).size !== members.length
  )
    invalid(
      'INSPECTION_SOURCE_UNAVAILABLE',
      'select distinct captured members within the inventory bound',
    )
  let total = 0
  const selected = [...members]
  const sources: { source: string; sourcePath: string }[] = []
  for (const member of selected) {
    const file = captured.files.find((file) => file.path === member)
    if (file !== undefined) total += file.size
    if (file === undefined || total > PRIVATE_FLOW_CONTEXT_LIMITS.sourceBytes)
      invalid(
        'INSPECTION_SOURCE_UNAVAILABLE',
        'captured member is missing or selected source exceeds the aggregate presentation bound',
      )
    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await captured.read(file.path, PRIVATE_FLOW_CONTEXT_LIMITS.sourceBytes),
      )
    } catch {
      invalid('INSPECTION_SOURCE_UNAVAILABLE', 'captured member is not UTF-8 text')
    }
    if (source!.includes('\0'))
      invalid('INSPECTION_SOURCE_UNAVAILABLE', 'captured member contains NUL bytes')
    sources.push({ source: source!, sourcePath: file.path })
  }
  return { sources }
}

/** Recognizable package source, not an inferred control-flow or import graph. */
export async function inspectionImplementation(
  captured: Pick<CapturedPackage, 'files' | 'read'>,
  entrypoint: string,
) {
  const members = captured.files
    .filter(
      (file) =>
        file.path === entrypoint ||
        (!file.path.startsWith('contracts/') &&
          /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|sh|java|c|cc|cpp|h|hpp|json|md)$/.test(
            file.path,
          ) &&
          !/(?:^|\/)(?:AGENTS|README|CHANGELOG)\.md$/.test(file.path)),
    )
    .map((file) => file.path)
    .sort((a, b) => (a === entrypoint ? -1 : b === entrypoint ? 1 : 0))
  return {
    ...(await inspectionSources(captured, members)),
    implementation: { omittedMembers: captured.files.length - members.length },
  }
}
