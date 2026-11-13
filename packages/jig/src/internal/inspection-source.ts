import { invalid } from '../diagnostics.js'
import type { CapturedPackage } from '../package/capture.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './inspection-policy.js'

export async function inspectionSource(
  captured: Pick<CapturedPackage, 'files' | 'read'>,
  member: string,
): Promise<{ source: string; sourcePath: string }> {
  const file = captured.files.find((file) => file.path === member)
  if (file === undefined || file.size > PRIVATE_FLOW_CONTEXT_LIMITS.sourceBytes)
    invalid(
      'INSPECTION_SOURCE_UNAVAILABLE',
      'captured member is missing or exceeds the presentation bound',
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
  return { source: source!, sourcePath: file.path }
}
