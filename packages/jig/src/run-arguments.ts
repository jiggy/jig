import { asciiJsonString, CliDiagnostic, spellingHint, usage } from './cli-usage.js'
import { privateAttachmentName, privateFilePath } from './internal/linux-file-input.js'
import {
  PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
} from './internal/root-run-timeout-policy.js'
import { decodeJson1, type JsonValue } from './json.js'
import { bindingRef, flowRef, type RunTargetRef } from './project/author.js'
import { npmPackageName } from './project/package-selector.js'

const textEncoder = new TextEncoder()

export function parseRun(
  arguments_: readonly string[],
  allowUnboundSelect = false,
): {
  readonly target: RunTargetRef
  readonly input: JsonValue
  readonly inputFile?: string
  readonly attachments: readonly { name: string; directory: string; select: readonly string[] }[]
  readonly output?: string
  readonly timeoutMs: number
  readonly receive: readonly string[]
  readonly json: boolean
  readonly verification: string | undefined
} {
  if (arguments_.length < 2)
    usage('run', 'Choose a target, for example flow:flows/hello or binding:repair.')
  const target = parseTarget(arguments_[1]!)
  let input: JsonValue = {}
  let inputFile: string | undefined, output: string | undefined
  const attachments = new Map<string, string>(),
    selectors = new Map<string, string[]>()
  let timeoutMs = PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS
  let json = false
  let sawInput = false
  let sawTimeout = false
  let verification: string | undefined
  const receive: string[] = []
  for (let index = 2; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    if (option === '--json') {
      if (json) usage('run', '--json may only be supplied once.')
      json = true
      index -= 1
      continue
    }
    const value = arguments_[index + 1]
    if (
      ![
        '--input',
        '--attach',
        '--select',
        '--out',
        '--receive',
        '--timeout',
        '--verification',
      ].includes(option!)
    )
      usage(
        'run',
        `Unknown run option ${asciiJsonString(option!.slice(0, 128))}.${spellingHint(option!, ['--input', '--attach', '--select', '--out', '--receive', '--timeout', '--verification', '--json'])}`,
      )
    if (value === undefined || value.startsWith('--')) usage('run', `${option} needs a value.`)
    if (option === '--verification') {
      if (verification !== undefined) usage('run', '--verification may only be supplied once.')
      verification = parseVerification('run', value)
      continue
    }
    if (option === '--receive') {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
        value.length > 64 ||
        receive.includes(value) ||
        receive.length >= 16
      )
        throw new CliDiagnostic(
          'JIG_USAGE',
          '--receive requires unique channel names, at most 16',
          2,
        )
      receive.push(value)
      continue
    }
    if (option === '--input' && !sawInput) {
      sawInput = true
      if (value.startsWith('@')) {
        if (value.length < 2)
          throw new CliDiagnostic('JIG_RUN_INPUT_INVALID', '@FILE requires a file path', 1)
        inputFile = value.slice(1)
        continue
      }
      try {
        input = decodeJson1(textEncoder.encode(value))
      } catch {
        throw new CliDiagnostic(
          'JIG_RUN_INPUT_INVALID',
          '--input must be valid JSON; quote inline JSON or use --input @file.json. No Flow was started.',
          1,
        )
      }
      continue
    }
    if (option === '--timeout' && !sawTimeout) {
      sawTimeout = true
      timeoutMs = parseRunTimeout(value)
      continue
    }
    if (option === '--out' && output === undefined) {
      output = value
      continue
    }
    if (option === '--attach' || option === '--select') {
      const split = value.indexOf('=')
      try {
        if (split < 1 || split === value.length - 1) throw new Error('missing mapping')
        const name = privateAttachmentName(value.slice(0, split)),
          path = value.slice(split + 1)
        if (option === '--attach') {
          if (attachments.has(name)) throw new Error('duplicate mapping')
          attachments.set(name, path)
        } else {
          privateFilePath(path)
          const selected = selectors.get(name) ?? []
          if (selected.includes(path)) throw new Error('duplicate selector')
          selected.push(path)
          selectors.set(name, selected)
        }
      } catch {
        throw new CliDiagnostic(
          'JIG_RUN_FILES_INVALID',
          'use --attach NAME=DIR and optional unique --select NAME=RELATIVE_FILE values',
          1,
        )
      }
      continue
    }
    usage('run', `${option} may only be supplied once.`)
  }
  if (!allowUnboundSelect && [...selectors.keys()].some((name) => !attachments.has(name)))
    throw new CliDiagnostic(
      'JIG_RUN_FILES_INVALID',
      '--select requires a matching --attach name',
      1,
    )
  return {
    target,
    input,
    timeoutMs,
    receive,
    json,
    verification,
    attachments: [...attachments].map(([name, directory]) => ({
      name,
      directory,
      select: selectors.get(name) ?? [],
    })),
    ...(inputFile === undefined ? {} : { inputFile }),
    ...(output === undefined ? {} : { output }),
  }
}

function parseRunTimeout(value: string): number {
  const match = /^([1-9][0-9]*)(ms|s|m|h)$/.exec(value)
  if (match === null) return invalidRunTimeout()
  const quantity = Number(match[1])
  const factor =
    match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : match[2] === 'm' ? 60_000 : 3_600_000
  const milliseconds = quantity * factor
  if (!Number.isSafeInteger(milliseconds) || milliseconds > PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS) {
    return invalidRunTimeout()
  }
  return milliseconds
}

function invalidRunTimeout(): never {
  throw new CliDiagnostic(
    'JIG_RUN_TIMEOUT_INVALID',
    '--timeout must be a positive integer followed by ms, s, m, or h, up to 24h',
    1,
  )
}

export function parseTarget(value: string): RunTargetRef {
  try {
    if (value.startsWith('npm:')) {
      npmPackageName(value)
      return flowRef(value)
    }
    if (value.startsWith('flow:npm:')) throw new TypeError('use npm:<package>')
    if (value.startsWith('flow:')) return flowRef(value.slice('flow:'.length))
    if (value.startsWith('binding:')) return bindingRef(value.slice('binding:'.length))
  } catch {
    // The public diagnostic intentionally does not repeat project-controlled input.
  }
  throw new CliDiagnostic(
    'JIG_RUN_TARGET_INVALID',
    'use flow:<path>, npm:<package> or binding:<id>, for example flow:flows/hello. Run jig review after adding a target.',
    1,
  )
}

export function parseVerification(command: 'run' | 'review' | 'inspect', value?: string): string {
  if (value !== 'cached' && value !== 'strict' && value !== 'fast')
    usage(command, '--verification requires cached, strict, or fast.')
  return value
}
