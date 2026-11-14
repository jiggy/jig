import { DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT } from '@jigging/display-model'
import { privateExplorerInput } from './explorer-client.js'

export const PRIVATE_SCENARIO_FORMAT = 'jig-input-scenario.v1'
export const PRIVATE_SCENARIO_FILE_BYTE_LIMIT = DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT + 4096

export type PrivateExplorerScenario = {
  format: typeof PRIVATE_SCENARIO_FORMAT
  name: string
  workflow: { kind: 'flow' | 'binding'; label: string }
  // Exact authored JSON text, rather than a parsed/re-serialized input value.
  input: string
}
export type PrivateScenarioResult =
  | { state: 'valid'; scenario: PrivateExplorerScenario }
  | { state: 'invalid'; reason: string }

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const label = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' &&
  value.trim() === value &&
  [...value].length > 0 &&
  [...value].length <= maximum &&
  !/[\u0000-\u001f\u007f]/u.test(value)

/** Pure, bounded exchange data. A scenario does not select or authorize a workflow. */
export function privateExplorerScenario(source: string): PrivateScenarioResult {
  if (bytes(source) > PRIVATE_SCENARIO_FILE_BYTE_LIMIT)
    return { state: 'invalid', reason: 'The scenario file exceeds the 16 MiB input allowance.' }
  let candidate: unknown
  try {
    candidate = JSON.parse(source)
  } catch {
    return { state: 'invalid', reason: 'The scenario file is not valid JSON.' }
  }
  if (
    !record(candidate) ||
    !exactKeys(candidate, ['format', 'name', 'workflow', 'input']) ||
    candidate.format !== PRIVATE_SCENARIO_FORMAT ||
    !label(candidate.name, 80) ||
    !record(candidate.workflow) ||
    !exactKeys(candidate.workflow, ['kind', 'label']) ||
    !['flow', 'binding'].includes(String(candidate.workflow.kind)) ||
    !label(candidate.workflow.label, 200) ||
    typeof candidate.input !== 'string'
  )
    return { state: 'invalid', reason: 'The scenario file has an unsupported format or invalid fields.' }
  const input = privateExplorerInput(candidate.input)
  if (input.state !== 'valid')
    return { state: 'invalid', reason: 'The scenario input is unavailable: ' + input.reason }
  return {
    state: 'valid',
    scenario: {
      format: PRIVATE_SCENARIO_FORMAT,
      name: candidate.name,
      workflow: {
        kind: candidate.workflow.kind as 'flow' | 'binding',
        label: candidate.workflow.label,
      },
      input: candidate.input,
    },
  }
}

export function privateExplorerScenarioFile(
  name: string,
  workflow: { kind: 'flow' | 'binding'; label: string },
  input: string,
): { state: 'valid'; text: string; filename: string } | { state: 'invalid'; reason: string } {
  const text = JSON.stringify({ format: PRIVATE_SCENARIO_FORMAT, name, workflow, input }, null, 2) + '\n'
  const result = privateExplorerScenario(text)
  if (result.state === 'invalid') return result
  const stem = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'scenario'
  return { state: 'valid', text, filename: stem + '.jig-scenario.json' }
}
