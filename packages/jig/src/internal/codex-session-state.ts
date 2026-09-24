import { closeSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { decodeJson1, Json1Error, type JsonObject } from '../json.js'
import type { PrivateAcpAgentRuntime } from './acp-agent-provider.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PrivateFileInputError,
  privateInputDirectory,
  privateOpenAt,
  privateReadRegularFile,
} from './file-input.js'

export const PRIVATE_CODEX_SESSION_BYTES = 8 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/
const PATH = /^sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[0-9T-]+-([0-9a-f-]{36})\.jsonl(?![\s\S])/
const decoder = new TextDecoder('utf-8', { fatal: true })

export type PrivateNativeSessionRequest =
  | { readonly retain: true; readonly lifetime?: 'run' }
  | { readonly restore: string }
export interface PrivateCodexSessionState {
  readonly nativeId: string
  readonly rolloutPath: string
  readonly bytes: Uint8Array
}

/** Expected rejection of native history, distinct from I/O or implementation failure. */
export class PrivateNativeHistoryUnavailable extends TypeError {
  constructor(readonly reason: 'missing-history' | 'unsupported-history' = 'unsupported-history') {
    super('Native session history cannot be retained')
  }
}

export function parsePrivateNativeSessionRequest(
  input: unknown,
): PrivateNativeSessionRequest | undefined {
  if (input === null) return undefined
  const outer = object(input)
  if (Object.keys(outer).join() !== 'session') invalid()
  const session = object(outer.session)
  if (session.retain === true && session.lifetime === 'run' && Object.keys(session).length === 2)
    return { retain: true, lifetime: 'run' }
  if (Object.keys(session).length !== 1) invalid()
  if (session.retain === true) return { retain: true }
  if (typeof session.restore === 'string' && UUID.test(session.restore))
    return { restore: session.restore }
  return invalid()
}

/** Fixed first native profile. Unknown native records cannot become restore authority. */
export function validatePrivateCodexSession(
  state: PrivateCodexSessionState,
  secrets: readonly string[] = [],
): void {
  if (
    !UUID.test(state.nativeId) ||
    PATH.exec(state.rolloutPath)?.[1] !== state.nativeId ||
    state.bytes.byteLength === 0 ||
    state.bytes.byteLength > PRIVATE_CODEX_SESSION_BYTES
  )
    invalid()
  let text: string
  try {
    text = decoder.decode(state.bytes)
  } catch (error) {
    if (error instanceof TypeError) invalid()
    throw error
  }
  if (!text.endsWith('\n')) invalid()
  for (const secret of secrets) {
    if (
      secret.length &&
      (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)))
    )
      invalid()
  }
  const lines = text.slice(0, -1).split('\n')
  if (lines.length > 16_384) invalid()
  let active: string | undefined
  let completions = 0
  let complete = false
  for (let ordinal = 0; ordinal < lines.length; ordinal++) {
    let decoded: unknown
    try {
      decoded = decodeJson1(Buffer.from(lines[ordinal]!))
    } catch (error) {
      if (error instanceof Json1Error) invalid()
      throw error
    }
    const record = object(decoded)
    if (
      Object.keys(record).some(
        (key) => !['timestamp', 'ordinal', 'type', 'payload'].includes(key),
      ) ||
      typeof record.timestamp !== 'string' ||
      record.ordinal !== ordinal
    )
      invalid()
    const payload = object(record.payload)
    if (ordinal === 0) {
      if (
        record.type !== 'session_meta' ||
        payload.cli_version !== '0.154.0' ||
        payload.id !== state.nativeId ||
        payload.session_id !== state.nativeId ||
        payload.cwd !== '/work' ||
        Object.keys(payload).some(
          (key) =>
            ![
              'session_id',
              'id',
              'timestamp',
              'cwd',
              'originator',
              'cli_version',
              'source',
              'model_provider',
              'base_instructions',
              'history_mode',
              'context_window',
            ].includes(key),
        )
      )
        invalid()
      continue
    }
    complete = false
    switch (record.type) {
      case 'event_msg':
        if (payload.type === 'task_started') {
          if (active !== undefined || typeof payload.turn_id !== 'string') invalid()
          active = payload.turn_id
        } else if (payload.type === 'task_complete') {
          if (active === undefined || payload.turn_id !== active) invalid()
          active = undefined
          completions++
          complete = true
        } else if (payload.type === 'item_completed') {
          const item = object(payload.item)
          if (
            active === undefined ||
            payload.turn_id !== active ||
            payload.thread_id !== state.nativeId ||
            !['UserMessage', 'AgentMessage', 'Reasoning'].includes(String(item.type))
          )
            invalid()
        } else if (
          ![
            'token_count',
            'thread_settings_applied',
            'agent_reasoning',
            'agent_reasoning_raw_content',
            'agent_message',
            'user_message',
          ].includes(String(payload.type))
        )
          invalid()
        break
      case 'response_item':
        if (!['message', 'reasoning'].includes(String(payload.type))) invalid()
        if (
          payload.type === 'message' &&
          (!['system', 'developer', 'user', 'assistant'].includes(String(payload.role)) ||
            !Array.isArray(payload.content) ||
            payload.content.some(
              (part) => !['input_text', 'output_text'].includes(String(object(part).type)),
            ))
        )
          invalid()
        break
      case 'turn_context':
        if (
          active === undefined ||
          payload.turn_id !== active ||
          payload.cwd !== '/work' ||
          !['never', 'on-request'].includes(String(payload.approval_policy)) ||
          !supportedSandboxPolicy(object(payload.sandbox_policy))
        )
          invalid()
        break
      case 'world_state':
      case 'token_usage_record':
        break
      default:
        invalid()
    }
  }
  if (active !== undefined || completions === 0 || !complete) invalid()
}

// codex-acp 1.8.0 represents its read-only mode as workspace-write plus
// on-request approval. This is history, not authority: the host refuses tools
// and reapplies the current reviewed policy when resuming the session.
function supportedSandboxPolicy(policy: JsonObject): boolean {
  if (policy.type === 'read-only') return Object.keys(policy).every((key) => key === 'type')
  return (
    policy.type === 'workspace-write' &&
    policy.network_access === false &&
    policy.exclude_tmpdir_env_var === false &&
    policy.exclude_slash_tmp === false &&
    (policy.writable_roots === undefined ||
      (Array.isArray(policy.writable_roots) && policy.writable_roots.length === 0)) &&
    Object.keys(policy).every((key) =>
      [
        'type',
        'network_access',
        'exclude_tmpdir_env_var',
        'exclude_slash_tmp',
        'writable_roots',
      ].includes(key),
    )
  )
}

/** Read only the one owned rollout through the already-fenced anonymous output descriptor. */
export function collectPrivateCodexSession(
  output: FileHandle,
  nativeId: string,
  secrets: readonly string[],
): PrivateCodexSessionState {
  const files: string[] = []
  let entries = 0
  const walk = (relative: string): void => {
    const fd =
      relative === '' ? output.fd : privateOpenAt(output.fd, relative, PRIVATE_DIRECTORY_OPEN_FLAGS)
    let directory: ReturnType<typeof privateInputDirectory> | undefined
    try {
      directory = privateInputDirectory(fd)
      for (;;) {
        const entry = directory.readSync()
        if (entry === null) break
        if (++entries > 16) invalid()
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (!/^sessions(?:\/\d{4}(?:\/\d{2}(?:\/\d{2})?)?)?$/.test(path)) invalid()
          walk(path)
        } else {
          if (!entry.isFile() || files.length || PATH.exec(path)?.[1] !== nativeId) invalid()
          files.push(path)
        }
      }
    } finally {
      try {
        directory?.closeSync()
      } finally {
        if (fd !== output.fd) closeSync(fd)
      }
    }
  }
  walk('')
  if (files.length === 0) throw new PrivateNativeHistoryUnavailable('missing-history')
  let bytes: Uint8Array
  try {
    bytes = privateReadRegularFile(output.fd, files[0]!, PRIVATE_CODEX_SESSION_BYTES)
  } catch (error) {
    if (
      error instanceof PrivateFileInputError &&
      (error.reason === 'bytes' || error.reason === 'linked')
    )
      invalid()
    throw error
  }
  const state = {
    nativeId,
    rolloutPath: files[0]!,
    bytes,
  }
  validatePrivateCodexSession(state, secrets)
  return state
}

/** Snapshot current credential-bearing values solely for rejection; never store or report them. */
export function privateCodexSessionSecrets(
  runtime: PrivateAcpAgentRuntime,
  startup: Uint8Array | undefined,
): string[] {
  const secrets: string[] = []
  for (const [key, value] of Object.entries(runtime.environment))
    if (/(AUTH|CREDENTIAL|KEY|SECRET|TOKEN)/i.test(key)) secrets.push(value)
  const leaves = (value: unknown): void => {
    if (typeof value === 'string') secrets.push(value)
    else if (value && typeof value === 'object')
      for (const child of Object.values(value)) leaves(child)
  }
  if (runtime.authentication) {
    const metadata = runtime.authentication.request._meta as Record<string, any> | undefined
    leaves(metadata?.gateway?.headers)
  }
  if (startup?.byteLength) leaves(JSON.parse(decoder.decode(startup.subarray(4))).tokens)
  return secrets
    .flatMap((value) => (/^Bearer /i.test(value) ? [value, value.slice(7)] : [value]))
    .filter((value) => value.length > 0)
}

/** Private length framing follows any credential bootstrap, before ACP bytes. */
export function privateCodexSessionBootstrap(state?: PrivateCodexSessionState): Uint8Array {
  const bytes = state === undefined ? Buffer.alloc(0) : Buffer.from(state.bytes)
  const path = state === undefined ? Buffer.alloc(0) : Buffer.from(state.rolloutPath)
  if (bytes.byteLength > PRIVATE_CODEX_SESSION_BYTES || path.byteLength > 256) invalid()
  const header = Buffer.alloc(8)
  header.writeUInt32BE(path.byteLength, 0)
  header.writeUInt32BE(bytes.byteLength, 4)
  return Buffer.concat([header, path, bytes])
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as JsonObject
}
function invalid(): never {
  throw new PrivateNativeHistoryUnavailable()
}
