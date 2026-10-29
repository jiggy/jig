import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS } from '../packages/jig/src/internal/bun-execution-layout.js'
import { PRIVATE_BUN_PROJECT_PREPARATION_LIMITS } from '../packages/jig/src/internal/bun-native-preparation-budget.js'
import {
  PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARATION_LIMITS,
} from '../packages/jig/src/internal/bun-native-preparation-protocol.js'
import {
  PRIVATE_CAPTURE_LIMITS,
  PRIVATE_FILE_LIMITS,
} from '../packages/jig/src/internal/file-input-policy.js'
import { PRIVATE_FINITE_ACP_LIMITS } from '../packages/jig/src/internal/finite-acp-policy.js'
import { PRIVATE_NATIVE_TURN_POLICY } from '../packages/jig/src/internal/native-agent-turn-policy.js'
import { PROJECT_COMMAND_LIMITS } from '../packages/jig/src/internal/private-project-command.js'
import { RUN_CHECKPOINT_LIMITS } from '../packages/jig/src/internal/private-run-checkpoint.js'
import { PROJECT_EVALUATION_LIMITS } from '../packages/jig/src/internal/project-evaluation-policy.js'
import {
  PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS,
  PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS,
  PRIVATE_AUTHOR_EVALUATOR_MAX_ENTRIES,
} from '../packages/jig/src/internal/project-evaluator-policy.js'
import {
  PRIVATE_FLOW_RESOURCE_CEILINGS,
  PRIVATE_ROOT_RESOURCE_POLICY,
} from '../packages/jig/src/internal/root-operation-limits.js'
import {
  PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
} from '../packages/jig/src/internal/root-run-timeout-policy.js'
import { JSON_1_LIMITS } from '../packages/jig/src/json.js'
import {
  PACKAGE_1_LIMITS,
  PACKAGE_1_MAX_PATH_BYTES,
  PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS,
} from '../packages/jig/src/package/capacity.js'
import { HTTP_LIMITS, HTTP_MAX_LIMITS } from '../packages/jig/src/project/grants.js'
import { DEPENDENCY_PREPARATION_LIMIT_POLICY } from '../packages/jig/src/project/limits.js'

type Control = 'Config / environment' | 'Run option' | 'Reviewed grant' | 'Fixed' | 'Derived'
type Limit = Readonly<{ name: string; value: string; control: Control }>
type Group = Readonly<{
  title: string
  explanation: string
  sources: readonly string[]
  limits: readonly Limit[]
}>
const integer = (value: number) => value.toLocaleString('en-US')
const bytes = (value: number) =>
  value % 1_048_576 === 0
    ? `${integer(value / 1_048_576)} MiB (${integer(value)} bytes)`
    : value % 1024 === 0
      ? `${integer(value / 1024)} KiB (${integer(value)} bytes)`
      : `${integer(value)} bytes`
const duration = (value: number) => `${integer(value / 1000)} seconds`
const fixed = (name: string, value: string): Limit => ({ name, value, control: 'Fixed' })
const source = (path: string) =>
  `[\`${path}\`](https://github.com/jiggy/jig/blob/main/packages/jig/src/${path})`

/** Documentation metadata refers to policy owners. It never authorizes execution. */
export const LIMIT_REFERENCE: readonly Group[] = [
  {
    title: 'Prepare runtime dependencies',
    explanation:
      'The prepared package controls apply to production dependencies of each selected package. Other preparation budgets remain fixed to bound review work.',
    sources: [
      'project/limits.ts',
      'internal/bun-native-preparation-protocol.ts',
      'internal/bun-native-preparation-budget.ts',
      'internal/bun-execution-layout.ts',
    ],
    limits: [
      {
        name: '`limits.dependencies.maxPreparedBytes`',
        value: `Default ${bytes(DEPENDENCY_PREPARATION_LIMIT_POLICY.default.maxPreparedBytes)}. Supported maximum ${bytes(DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparedBytes)}`,
        control: 'Config / environment',
      },
      {
        name: '`limits.dependencies.maxPreparedFiles`',
        value: `Default ${integer(DEPENDENCY_PREPARATION_LIMIT_POLICY.default.maxPreparedFiles)}. Supported maximum ${integer(DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparedFiles)}`,
        control: 'Config / environment',
      },
      fixed(
        'Captured source before installation, per package',
        `${bytes(PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes)} / ${integer(PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles)} files`,
      ),
      fixed(
        'Distinct actual preparations, per review',
        integer(PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.distinctPackages),
      ),
      fixed(
        'Aggregate prepared content, per review',
        bytes(PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes),
      ),
      fixed(
        'Whole preparation phase deadline',
        duration(PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.wallClockMs),
      ),
      fixed(
        'Workspace members in execution layout',
        integer(PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.members),
      ),
      fixed(
        'Dependency aliases in execution layout',
        integer(PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.aliases),
      ),
      fixed('Execution layout JSON', bytes(PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.bytes)),
      fixed(
        'Evaluation dependency closure',
        `${bytes(PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS.preparedBytes)} / ${integer(PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS.preparedFiles)} files`,
      ),
    ],
  },
  {
    title: 'Retain captured packages',
    explanation:
      'Archive capacity includes metadata and retained evidence. These fixed store bounds prevent unbounded durable growth. Dependency settings do not enlarge them.',
    sources: ['package/capacity.ts', 'internal/package-artifact-store.ts'],
    limits: [
      fixed(
        'One canonical captured artifact',
        bytes(PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes),
      ),
      fixed(
        'Captured package store, per project',
        bytes(PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.storeBytes),
      ),
      fixed('Package/0 format files', integer(PACKAGE_1_LIMITS.files)),
      fixed('Package/0 format individual file', bytes(PACKAGE_1_LIMITS.fileBytes)),
      fixed('Package/0 format aggregate content', bytes(PACKAGE_1_LIMITS.totalBytes)),
      fixed('Logical package path', `${integer(PACKAGE_1_MAX_PATH_BYTES)} UTF-8 bytes`),
    ],
  },
  {
    title: 'Bound a Run and its child work',
    explanation:
      'The Run deadline covers its descendants. Fixed process budgets and derived branch reservations keep concurrently owned work inside the root allocation.',
    sources: [
      'internal/root-run-timeout-policy.ts',
      'internal/root-operation-limits.ts',
      'internal/native-agent-turn-policy.ts',
    ],
    limits: [
      {
        name: 'Root Run deadline',
        value: `Default ${duration(PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS)}. Maximum ${duration(PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS)}`,
        control: 'Run option',
      },
      {
        name: 'Native Agent turns',
        value: `Default ${PRIVATE_NATIVE_TURN_POLICY.default}. Range ${PRIVATE_NATIVE_TURN_POLICY.minimum}–${PRIVATE_NATIVE_TURN_POLICY.maximum}`,
        control: 'Reviewed grant',
      },
      fixed(
        'One Flow: memory / process tasks',
        `${bytes(PRIVATE_FLOW_RESOURCE_CEILINGS.memoryBytes)} / ${PRIVATE_FLOW_RESOURCE_CEILINGS.pids}`,
      ),
      fixed(
        'One Flow: CPU quota',
        `${PRIVATE_FLOW_RESOURCE_CEILINGS.cpuQuotaMicros / PRIVATE_FLOW_RESOURCE_CEILINGS.cpuPeriodMicros} core`,
      ),
      fixed(
        'Root: memory / process tasks',
        `${bytes(PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes)} / ${PRIVATE_ROOT_RESOURCE_POLICY.pids}`,
      ),
      fixed(
        'Root: CPU quota',
        `${PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros / PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros} cores`,
      ),
      fixed(
        'Concurrent sibling Flows / exclusive leaf effects',
        `${PRIVATE_ROOT_RESOURCE_POLICY.siblingFlows} / ${PRIVATE_ROOT_RESOURCE_POLICY.leafEffects}`,
      ),
      {
        name: 'Maximum child Flow levels',
        value: `${PRIVATE_ROOT_RESOURCE_POLICY.childFlowLevels}, subject to whole-branch reservations`,
        control: 'Derived',
      },
      fixed('Flow cleanup deadline', duration(PRIVATE_FLOW_RESOURCE_CEILINGS.cleanupTimeoutMs)),
    ],
  },
  {
    title: 'Capture and deliver files',
    explanation:
      'Binding-retained reads and per-run attachments share the invocation input allowance. Fixed path and capture bounds protect descriptor traversal, transport and delivery.',
    sources: ['internal/file-input-policy.ts'],
    limits: [
      fixed(
        'Invocation input / artifact input / output content',
        `${bytes(PRIVATE_CAPTURE_LIMITS.input)} / ${bytes(PRIVATE_CAPTURE_LIMITS['artifact-input'])} / ${bytes(PRIVATE_CAPTURE_LIMITS.output)}`,
      ),
      fixed(
        'Files / tree entries',
        `${PRIVATE_FILE_LIMITS.files} / ${PRIVATE_FILE_LIMITS.entries}`,
      ),
      fixed(
        'Relative path depth / length',
        `${PRIVATE_FILE_LIMITS.depth} components / ${PRIVATE_FILE_LIMITS.pathBytes} UTF-8 bytes`,
      ),
      fixed(
        'Input capture / file delivery deadline',
        `${duration(PRIVATE_FILE_LIMITS.captureMs)} / ${duration(PRIVATE_FILE_LIMITS.deliveryMs)}`,
      ),
    ],
  },
  {
    title: 'Delegate HTTP requests',
    explanation:
      'Request, response and deadline allowances belong to the reviewed HTTP grant. The original root deadline and supported maxima continue to apply.',
    sources: ['project/grants.ts'],
    limits: [
      {
        name: '`requestBytes`',
        value: `Default ${bytes(HTTP_LIMITS.requestBytes)}. Maximum ${bytes(HTTP_MAX_LIMITS.requestBytes)}`,
        control: 'Reviewed grant',
      },
      {
        name: '`responseBytes`',
        value: `Default ${bytes(HTTP_LIMITS.responseBytes)}. Maximum ${bytes(HTTP_MAX_LIMITS.responseBytes)}`,
        control: 'Reviewed grant',
      },
      {
        name: '`timeoutMs`',
        value: `Default and maximum ${duration(HTTP_LIMITS.timeoutMs)}`,
        control: 'Reviewed grant',
      },
    ],
  },
  {
    title: 'Run project commands and evaluations',
    explanation:
      'These fixed profiles bound reviewed tools and their collected outputs. Evaluation phases also share the evaluation deadline and original root lifetime.',
    sources: [
      'internal/private-project-command.ts',
      'internal/project-evaluation-policy.ts',
      'internal/project-evaluator-policy.ts',
    ],
    limits: [
      fixed(
        'Project Command input files / aggregate bytes',
        `${PROJECT_COMMAND_LIMITS.files} / ${bytes(PROJECT_COMMAND_LIMITS.bytes)}`,
      ),
      fixed(
        'Project Command arguments / bytes per argument',
        `${PROJECT_COMMAND_LIMITS.args} / ${bytes(PROJECT_COMMAND_LIMITS.argumentBytes)}`,
      ),
      fixed(
        'Project Command stdin / retained stream',
        `${bytes(PROJECT_COMMAND_LIMITS.stdinBytes)} / ${bytes(PROJECT_COMMAND_LIMITS.streamBytes)}`,
      ),
      fixed('Project Command deadline', duration(PROJECT_COMMAND_LIMITS.timeoutMs)),
      fixed(
        'Evaluation candidate source',
        `${PROJECT_EVALUATION_LIMITS.candidateFiles} files / ${bytes(PROJECT_EVALUATION_LIMITS.candidateBytes)}`,
      ),
      fixed(
        'Evaluation collected outputs',
        `${PROJECT_EVALUATION_LIMITS.outputFiles} files / ${bytes(PROJECT_EVALUATION_LIMITS.outputBytes)} aggregate / ${bytes(PROJECT_EVALUATION_LIMITS.outputFileBytes)} per file`,
      ),
      fixed(
        'Evaluation memory / scratch capacity',
        `${bytes(PROJECT_EVALUATION_LIMITS.memoryBytes)} / ${bytes(PROJECT_EVALUATION_LIMITS.scratchBytes)}`,
      ),
      fixed(
        'Evaluation total / generate / compile / test deadlines',
        [
          PROJECT_EVALUATION_LIMITS.timeoutMs,
          PROJECT_EVALUATION_LIMITS.generateMs,
          PROJECT_EVALUATION_LIMITS.compileMs,
          PROJECT_EVALUATION_LIMITS.testMs,
        ]
          .map(duration)
          .join(' / '),
      ),
      fixed(
        'Author declarations evaluated per review',
        integer(PRIVATE_AUTHOR_EVALUATOR_MAX_ENTRIES),
      ),
      fixed(
        'Author evaluation deadline per entry: Linux / Mac',
        `${duration(PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS)} / ${duration(PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS)}`,
      ),
    ],
  },
  {
    title: 'Exchange Agent protocol messages',
    explanation:
      'These fixed ACP bounds protect one finite conversation. Additional reviewed turns share its byte and frame budgets. Environment variables cannot change the wire contract.',
    sources: ['internal/finite-acp-policy.ts'],
    limits: [
      fixed('One protocol frame', bytes(PRIVATE_FINITE_ACP_LIMITS.frameBytes)),
      fixed(
        'Adapter aggregate bytes / frames',
        `${bytes(PRIVATE_FINITE_ACP_LIMITS.adapterBytes)} / ${integer(PRIVATE_FINITE_ACP_LIMITS.adapterFrames)}`,
      ),
      fixed(
        'Client aggregate bytes / frames',
        `${bytes(PRIVATE_FINITE_ACP_LIMITS.clientBytes)} / ${integer(PRIVATE_FINITE_ACP_LIMITS.clientFrames)}`,
      ),
      fixed(
        'Prompt / public answer text',
        `${bytes(PRIVATE_FINITE_ACP_LIMITS.promptBytes)} / ${bytes(PRIVATE_FINITE_ACP_LIMITS.textBytes)}`,
      ),
      fixed(
        'Updates / permissions',
        `${integer(PRIVATE_FINITE_ACP_LIMITS.updates)} / ${PRIVATE_FINITE_ACP_LIMITS.permissions}`,
      ),
      fixed('Protocol identifier', bytes(PRIVATE_FINITE_ACP_LIMITS.identifierBytes)),
    ],
  },
  {
    title: 'Save checkpoints',
    explanation:
      'The fixed checkpoint profile bounds retained evidence during one root lifetime. Checkpoint success does not reset any Run allowance.',
    sources: ['internal/private-run-checkpoint.ts'],
    limits: [
      fixed('Encoded checkpoint request', bytes(RUN_CHECKPOINT_LIMITS.bytes)),
      fixed(
        'Checkpoint text files / aggregate text content',
        `${RUN_CHECKPOINT_LIMITS.files} / ${bytes(RUN_CHECKPOINT_LIMITS.fileBytes)}`,
      ),
      fixed('Checkpoint saves', integer(RUN_CHECKPOINT_LIMITS.saves)),
    ],
  },
  {
    title: 'Represent JSON values',
    explanation:
      'JSON/0 is an interoperable value contract. Its representation bounds remain fixed, including when another configurable allowance is larger.',
    sources: ['json.ts'],
    limits: [
      fixed(
        'Encoded document / string',
        `${bytes(JSON_1_LIMITS.bytes)} / ${bytes(JSON_1_LIMITS.stringBytes)}`,
      ),
      fixed(
        'Nesting depth / total value nodes',
        `${JSON_1_LIMITS.depth} / ${integer(JSON_1_LIMITS.nodes)}`,
      ),
      fixed('Entries in one object or array', integer(JSON_1_LIMITS.containerEntries)),
      fixed(
        'Member name / number token',
        `${bytes(JSON_1_LIMITS.memberNameBytes)} / ${bytes(JSON_1_LIMITS.numberTokenBytes)}`,
      ),
    ],
  },
]

const START = '<!-- limit-reference:start -->'
const END = '<!-- limit-reference:end -->'
export const LIMIT_REFERENCE_PATH = 'docs/jig/guide/limits.md'

export function renderLimitReference(groups: readonly Group[] = LIMIT_REFERENCE): string {
  return groups
    .map((group) =>
      [
        `## ${group.title}`,
        '',
        group.explanation,
        '',
        '| Setting or bound | Value | Control |',
        '| --- | --- | --- |',
        ...group.limits.map((limit) => `| ${limit.name} | ${limit.value} | ${limit.control} |`),
        '',
        `Policy owners: ${group.sources.map(source).join(', ')}.`,
      ].join('\n'),
    )
    .join('\n\n')
}

export function updateLimitReference(text: string, generated = renderLimitReference()): string {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (
    start < 0 ||
    end <= start ||
    text.indexOf(START, start + START.length) >= 0 ||
    text.indexOf(END, end + END.length) >= 0
  )
    throw new Error('Limits reference must contain exactly one ordered marker pair.')
  return `${text.slice(0, start + START.length)}\n\n${generated}\n\n${text.slice(end)}`
}

export function limitReferenceCurrent(text: string, generated = renderLimitReference()): boolean {
  return updateLimitReference(text, generated) === text
}

if (import.meta.main) {
  const path = process.argv[3] ?? resolve(import.meta.dirname, '..', LIMIT_REFERENCE_PATH)
  const current = readFileSync(path, 'utf8')
  if (
    process.argv.length < 3 ||
    process.argv.length > 4 ||
    !['--write', '--check'].includes(process.argv[2])
  )
    throw new Error('Usage: bun scripts/limit-reference.ts --write|--check [FILE]')
  const updated = updateLimitReference(current)
  if (process.argv[2] === '--write') writeFileSync(path, updated)
  else if (current !== updated)
    throw new Error(
      'Limits reference differs from policy owners. Run bun scripts/limit-reference.ts --write.',
    )
}
