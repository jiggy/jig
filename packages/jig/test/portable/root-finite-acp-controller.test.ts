import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateAcpAgentProvider } from '../../src/internal/acp-agent-provider.js'
import { PrivateAcpSetupError } from '../../src/internal/acp-setup-diagnostics.js'
import { PrivateFiniteAcpPolicyError } from '../../src/internal/finite-acp-policy.js'
import { PrivateFiniteAcpTaskPromptEvidence } from '../../src/internal/finite-acp-prompt-evidence.js'
import {
  isPrivateRootFiniteAcpOwner,
  privateFiniteAcpFailureTerminal,
  privateFiniteAcpSessionScope,
} from '../../src/internal/root-finite-acp-controller.js'

describe('finite ACP cleanup-ledger kind classifier (ordinary data only)', () => {
  test('classifies only its own cleanup-ledger allocation kind', () => {
    const base = {
      parentRunId: `sha256:${'1'.repeat(64)}`,
      operationId: 'agent:1',
    }
    expect(
      isPrivateRootFiniteAcpOwner({
        ...base,
        allocation: {
          digest: `sha256:${'2'.repeat(64)}`,
          value: { kind: 'private-root-agent-owner-allocation/1' },
        },
      }),
    ).toBe(true)
    expect(
      isPrivateRootFiniteAcpOwner({
        ...base,
        allocation: {
          digest: `sha256:${'3'.repeat(64)}`,
          value: { kind: 'private-root-child-owner-allocation/1' },
        },
      }),
    ).toBe(false)
  })
})

describe('finite ACP session scope & failover terminal mapping', () => {
  test('session scope matches across Codex authProfile, model, and credentialMode but isolates executables/adapters/clients', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-controller-scope-'))
    try {
      const adapterA = join(root, 'adapter-a.js')
      const adapterB = join(root, 'adapter-b.js')
      const execA = join(root, 'codex-a')
      const execB = join(root, 'codex-b')
      await writeFile(adapterA, 'adapter-a\n')
      await writeFile(adapterB, 'adapter-b\n')
      await writeFile(execA, 'exec-a\n')
      await writeFile(execB, 'exec-b\n')
      await chmod(execA, 0o700)
      await chmod(execB, 0o700)
      const makeProvider = (options: {
        client?: string
        authProfile?: string
        model?: string
        credentialMode?: string
        adapterPath?: string
        executablePath?: string
      }) =>
        createPrivateAcpAgentProvider({
          client: options.client ?? 'openai-codex',
          ...(options.authProfile === undefined ? {} : { authProfile: options.authProfile }),
          model: options.model ?? 'gpt-5',
          credentialMode: options.credentialMode ?? 'chatgpt',
          adapterPath: options.adapterPath ?? adapterA,
          sandboxAdapterPath: '/agent/adapter.js',
          executablePath: options.executablePath ?? execA,
          sandboxExecutablePath: '/agent/client',
          environment: { PROFILE: options.authProfile ?? 'ambient' },
          secrets: ['secret-token'],
        })
      const baseParent = {
        parent: {
          run: { target: { kind: 'flow', path: 'flows/main' } },
          intent: { requestDigest: `sha256:${'a'.repeat(64)}` },
        },
        parentFlow: {
          target: { kind: 'flow', path: 'flows/sub' },
          requestDigest: `sha256:${'b'.repeat(64)}`,
          operationId: 'agent:1',
        },
      }
      const primary = await makeProvider({
        authProfile: 'sub-a',
        model: 'gpt-5',
        credentialMode: 'chatgpt',
      })
      const backupKey = await makeProvider({
        authProfile: 'api-key',
        model: 'o3-mini',
        credentialMode: 'api',
      })
      const otherClient = await makeProvider({ client: 'anthropic-claude', authProfile: 'claude' })
      const otherExec = await makeProvider({ authProfile: 'sub-b', executablePath: execB })
      const otherAdapter = await makeProvider({ authProfile: 'sub-b', adapterPath: adapterB })

      const scope = privateFiniteAcpSessionScope(baseParent, primary)
      expect(privateFiniteAcpSessionScope(baseParent, backupKey)).toBe(scope)
      expect(privateFiniteAcpSessionScope(baseParent, otherClient)).not.toBe(scope)
      expect(privateFiniteAcpSessionScope(baseParent, otherExec)).not.toBe(scope)
      expect(privateFiniteAcpSessionScope(baseParent, otherAdapter)).not.toBe(scope)
      expect(
        privateFiniteAcpSessionScope({ ...baseParent, parentFlow: undefined }, primary),
      ).not.toBe(scope)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('failure terminals attach confirmed pre-dispatch not-forwarded evidence and preserve post-dispatch boundaries', () => {
    for (const stage of ['managed-policy', 'preferences', 'executable'] as const) {
      expect(
        privateFiniteAcpFailureTerminal({
          error: new PrivateAcpSetupError(stage),
          phase: 'preparing containment',
          aborted: false,
          bootRemainingMs: 10_000,
          attemptedDispatch: false,
          cleanupRecovered: true,
          client: 'openai-codex',
        }),
      ).toMatchObject({
        status: 'failed',
        code: 'EXECUTION_FAILED',
        details: {
          nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
        },
      })
    }
    expect(
      privateFiniteAcpFailureTerminal({
        error: new PrivateAcpSetupError('managed-policy'),
        phase: 'preparing containment',
        aborted: false,
        bootRemainingMs: 10_000,
        attemptedDispatch: false,
        cleanupRecovered: false,
        client: 'openai-codex',
      }),
    ).not.toHaveProperty('details')

    const evidence = new PrivateFiniteAcpTaskPromptEvidence()
    const rejectedError = new PrivateFiniteAcpPolicyError(
      'native session failed',
      'native-session',
      'limit',
      429,
    )
    evidence.beforeNativeWrite('session/prompt')
    evidence.recordPreInsertionRejection()
    evidence.noteFailure(rejectedError, true)
    expect(
      privateFiniteAcpFailureTerminal({
        error: rejectedError,
        phase: 'exchanging native messages',
        aborted: false,
        bootRemainingMs: 10_000,
        attemptedDispatch: true,
        cleanupRecovered: true,
        client: 'openai-codex',
      }),
    ).toMatchObject({
      status: 'failed',
      code: 'UNCERTAIN',
      details: {
        nativePrompt: {
          forwarding: 'rejected-without-output',
          cleanup: 'confirmed',
          turnsSettled: 0,
        },
        nativeSession: { category: 'limit', httpStatusCode: 429 },
      },
    })

    // Post-acceptance session failure without output must omit nativePrompt replay attestation.
    const postAcceptEvidence = new PrivateFiniteAcpTaskPromptEvidence()
    const postAcceptError = new PrivateFiniteAcpPolicyError(
      'native session failed after acceptance',
      'native-session',
      'limit',
      429,
    )
    postAcceptEvidence.beforeNativeWrite('session/prompt')
    postAcceptEvidence.recordPromptAccepted()
    postAcceptEvidence.noteFailure(postAcceptError, true)
    const postAcceptTerminal = privateFiniteAcpFailureTerminal({
      error: postAcceptError,
      phase: 'exchanging native messages',
      aborted: false,
      bootRemainingMs: 10_000,
      attemptedDispatch: true,
      cleanupRecovered: true,
      client: 'openai-codex',
    })
    expect(postAcceptTerminal).toMatchObject({
      status: 'failed',
      code: 'UNCERTAIN',
      details: { nativeSession: { category: 'limit', httpStatusCode: 429 } },
    })
    expect(postAcceptTerminal).not.toHaveProperty('details.nativePrompt')

    expect(
      privateFiniteAcpFailureTerminal({
        error: rejectedError,
        phase: 'exchanging native messages',
        aborted: true,
        bootRemainingMs: 10_000,
        attemptedDispatch: false,
        cleanupRecovered: true,
        client: 'openai-codex',
      }),
    ).toMatchObject({ status: 'failed', code: 'CANCELLED' })
  })
})
