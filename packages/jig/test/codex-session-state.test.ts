import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { codexStartupFeatures } from '../src/internal/codex-agent-launcher.js'
import { settleTestCommand } from './fixtures/bounded-command.js'
import {
  collectPrivateCodexSession,
  parsePrivateNativeSessionRequest,
  privateCodexSessionBootstrap,
  privateCodexSessionSecrets,
  PrivateNativeHistoryUnavailable,
  validatePrivateCodexSession,
} from '../src/internal/codex-session-state.js'

const nativeId = '01a0a189-e9a2-76c3-a8ca-964e885f05e6'
test('only known collected-file profile violations become optional retention loss', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-history-error-evidence-'))
  const child = Bun.spawn(
    [process.execPath, new URL('./fixtures/native-history-errors.ts', import.meta.url).pathname],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const result = await settleTestCommand(child, { evidence: join(root, 'classification') })
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('native history error classification passed')
})
test('expected missing history has a reason; descriptor failures remain errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-history-empty-'))
  const output = await open(root, 'r')
  try {
    expect(() => collectPrivateCodexSession(output, nativeId, [])).toThrow(
      PrivateNativeHistoryUnavailable,
    )
    try {
      collectPrivateCodexSession(output, nativeId, [])
    } catch (error) {
      expect(error).toMatchObject({ reason: 'missing-history' })
    }
    await output.close()
    let failure: unknown
    try {
      collectPrivateCodexSession(output, nativeId, [])
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(PrivateNativeHistoryUnavailable)
  } finally {
    await output.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('native startup receives the same inert feature flags before thread creation', () => {
  expect(
    codexStartupFeatures(
      JSON.stringify({
        features: { code_mode: false, code_mode_host: false },
        model: 'not copied',
      }),
    ),
  ).toBe('[features]\ncode_mode = false\ncode_mode_host = false\n')
  for (const features of [
    null,
    [],
    { 'bad\nkey': false },
    { 'key\n': false },
    { code_mode: 'false' },
    { code_mode: {} },
  ])
    expect(() => codexStartupFeatures(JSON.stringify({ features }))).toThrow()
})
test('credential screening includes bare tokens without treating endpoint metadata as secrets', () => {
  const values = privateCodexSessionSecrets(
    {
      environment: {},
      authentication: {
        request: {
          methodId: 'gateway',
          _meta: {
            gateway: {
              baseUrl: 'https://public.example',
              providerName: 'Public endpoint',
              headers: { Authorization: 'Bearer private-token' },
            },
          },
        },
      },
    } as any,
    undefined,
  )
  expect(values).toContain('private-token')
  expect(values).toContain('Bearer private-token')
  expect(values).not.toContain('https://public.example')
})
const rolloutPath = `sessions/2026/09/14/rollout-2026-09-14T20-09-25-${nativeId}.jsonl`
function state(change?: (records: any[]) => void) {
  const records = [
    {
      type: 'session_meta',
      payload: { id: nativeId, session_id: nativeId, cli_version: '0.154.0', cwd: '/work' },
    },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    {
      type: 'turn_context',
      payload: {
        turn_id: 'turn-1',
        cwd: '/work',
        approval_policy: 'never',
        sandbox_policy: { type: 'read-only' },
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '48 minutes' }],
      },
    },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } },
  ] as any[]
  change?.(records)
  return {
    nativeId,
    rolloutPath,
    bytes: Buffer.from(
      records
        .map((record, ordinal) =>
          JSON.stringify({ timestamp: '2026-09-14T00:00:00Z', ordinal, ...record }),
        )
        .join('\n') + '\n',
    ),
  }
}
test('session input is an exact optional request, never a native path or ID', () => {
  expect(parsePrivateNativeSessionRequest(null)).toBeUndefined()
  expect(parsePrivateNativeSessionRequest({ session: { retain: true } })).toEqual({ retain: true })
  expect(parsePrivateNativeSessionRequest({ session: { restore: nativeId } })).toEqual({
    restore: nativeId,
  })
  for (const value of [
    {},
    { session: {} },
    { session: { retain: false } },
    { session: { restore: '/private' } },
    { session: { retain: true, restore: nativeId } },
    { session: { retain: true }, extra: 1 },
  ])
    expect(() => parsePrivateNativeSessionRequest(value)).toThrow()
})
test('only one identified complete qualified native history is reusable', () => {
  expect(() => validatePrivateCodexSession(state())).not.toThrow()
  for (const bytes of [Buffer.from('not JSON\n'), Buffer.from([0xff, 0x0a])])
    expect(() => validatePrivateCodexSession({ ...state(), bytes })).toThrow(
      PrivateNativeHistoryUnavailable,
    )
  for (const change of [
    (r: any[]) => {
      r[0].payload.cli_version = 'unknown'
    },
    (r: any[]) => {
      r[0].payload.id = 'foreign'
    },
    (r: any[]) => {
      r[0].payload.dynamic_tools = []
    },
    (r: any[]) => {
      r[2].payload.sandbox_policy.type = 'danger-full-access'
    },
    (r: any[]) => {
      r[3].payload.type = 'function_call'
    },
    (r: any[]) => {
      r[3].type = 'compacted'
    },
    (r: any[]) => {
      r[4].payload.turn_id = 'other'
    },
    (r: any[]) => {
      r.pop()
    },
  ])
    expect(() => validatePrivateCodexSession(state(change))).toThrow()
  expect(() => validatePrivateCodexSession({ ...state(), rolloutPath: '../auth.json' })).toThrow()
  expect(() =>
    validatePrivateCodexSession({ ...state(), bytes: state().bytes.subarray(0, -1) }),
  ).toThrow()
  expect(() => validatePrivateCodexSession(state(), ['48 minutes'])).toThrow()
  expect(() =>
    validatePrivateCodexSession({ ...state(), bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }),
  ).toThrow()
})
test('private bootstrap contains only bounded path and history, not authentication', () => {
  const value = state(),
    bootstrap = Buffer.from(privateCodexSessionBootstrap(value))
  const pathBytes = bootstrap.readUInt32BE(0)
  expect(bootstrap.readUInt32BE(4)).toBe(value.bytes.length)
  expect(bootstrap.subarray(8, 8 + pathBytes).toString()).toBe(rolloutPath)
  expect(bootstrap.subarray(8 + pathBytes)).toEqual(value.bytes)
  expect(privateCodexSessionBootstrap()).toEqual(Buffer.alloc(8))
})
test('accepts the qualified ACP read-only representation without admitting broader policies', () => {
  const policy = {
    type: 'workspace-write',
    network_access: false,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false,
  }
  const withPolicy = (value: unknown) =>
    state((records) => {
      records[2].payload.sandbox_policy = value
    })
  expect(() => validatePrivateCodexSession(withPolicy(policy))).not.toThrow()
  expect(() =>
    validatePrivateCodexSession(withPolicy({ ...policy, writable_roots: [] })),
  ).not.toThrow()
  for (const value of [
    { ...policy, network_access: true },
    { ...policy, writable_roots: ['/private'] },
    { ...policy, future_authority: true },
    { type: 'workspace-write' },
    { type: 'read-only', network_access: true },
  ])
    expect(() => validatePrivateCodexSession(withPolicy(value))).toThrow()
})
test('collector uses bounded no-follow regular reads and rejects extra state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-session-collector-'))
  const output = await open(root, 0x10000)
  try {
    await mkdir(dirname(join(root, rolloutPath)), { recursive: true })
    await writeFile(join(root, rolloutPath), state().bytes)
    expect(collectPrivateCodexSession(output, nativeId, []).bytes).toEqual(state().bytes)
    await writeFile(join(root, 'auth.json'), 'private')
    expect(() => collectPrivateCodexSession(output, nativeId, [])).toThrow()
    await rm(join(root, 'auth.json'))
    await rm(join(root, rolloutPath))
    await symlink('/etc/passwd', join(root, rolloutPath))
    expect(() => collectPrivateCodexSession(output, nativeId, [])).toThrow()
  } finally {
    await output.close()
    await rm(root, { recursive: true, force: true })
  }
})
