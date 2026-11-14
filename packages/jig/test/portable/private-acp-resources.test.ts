import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACP_SETUP_HINTS,
  acpSetupCode,
  PrivateAcpSetupError,
} from '../../src/internal/acp-setup-diagnostics.js'
import { openPrivateInstalledBunSupport } from '../../src/internal/installed-bun-support.js'
import { privateLinuxProtectedDestination } from '../../src/internal/linux-rootless-backend.js'
import {
  openPrivateAcpResources,
  PrivateAcpResourceUnavailableError,
  privateAcpProfileEnvironment,
  selectPrivateAcpResources,
} from '../../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../../src/internal/private-finite-acp-contract.js'
import type { NativeAcpClient } from '../../src/project/grants.js'
import type { InvocationSlots } from '../../src/project/invocation-slots.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

function slots(client: NativeAcpClient): InvocationSlots {
  return {
    session: {
      kind: 'native',
      native: 'finite-acp',
      grant: { kind: 'acp', client },
      contract: {
        id: FINITE_ACP_CONTRACT_ID,
        version: FINITE_ACP_CONTRACT_VERSION,
        digest: FINITE_ACP_CONTRACT_DIGEST,
      },
    },
  }
}
describe('isolated operator-selected ACP authentication profiles', () => {
  const sources = {
    PATH: '/usr/bin',
    OPENAI_API_KEY: 'unselected-ambient-key',
    CLAUDE_CODE_OAUTH_TOKEN: 'unselected-ambient-token',
    PI_PROVIDER: 'unselected-provider',
    JIG_ACP_PROFILE_PERSONAL_CODEX__CODEX_HOME: '/operator/codex-personal',
    JIG_ACP_PROFILE_WORK_API__OPENAI_API_KEY: 'selected-api-key',
    JIG_ACP_PROFILE_CLAUDE_WORK__ANTHROPIC_AUTH_TOKEN: 'selected-claude-token',
    JIG_ACP_PROFILE_PI_HOME__PI_PROVIDER: 'openai-codex',
    JIG_ACP_PROFILE_PI_HOME__PI_CODING_AGENT_DIR: '/operator/pi-personal',
  }
  test('never forwards ambient credentials or credentials from a sibling profile', () => {
    const personal = privateAcpProfileEnvironment(sources, 'codex', 'personal-codex')
    expect(personal.CODEX_HOME).toBe('/operator/codex-personal')
    expect(personal.OPENAI_API_KEY).toBeUndefined()
    expect(personal.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(personal.PI_PROVIDER).toBeUndefined()
    expect(Object.keys(personal).some((key) => key.startsWith('JIG_ACP_PROFILE_'))).toBeFalse()
    const api = privateAcpProfileEnvironment(sources, 'codex', 'work-api')
    expect(api.OPENAI_API_KEY).toBe('selected-api-key')
    expect(api.CODEX_HOME).toBeUndefined()
    expect(api.PATH).toBe('/usr/bin')
    const claude = privateAcpProfileEnvironment(sources, 'claude', 'claude-work')
    expect(claude.ANTHROPIC_AUTH_TOKEN).toBe('selected-claude-token')
    expect(claude.OPENAI_API_KEY).toBeUndefined()
    const pi = privateAcpProfileEnvironment(sources, 'pi', 'pi-home')
    expect(pi.PI_CODING_AGENT_DIR).toBe('/operator/pi-personal')
    expect(pi.PI_PROVIDER).toBe('openai-codex')
    expect(pi.OPENAI_API_KEY).toBeUndefined()
  })
  test('rejects missing, ambiguous and cross-client profile data without fallback', () => {
    for (const [client, profile, value] of [
      ['codex', 'missing', {}],
      ['codex', 'personal-codex', { JIG_ACP_PROFILE_PERSONAL_CODEX__OPENAI_API_KEY: 'ambiguous' }],
      ['codex', 'personal-codex', { JIG_ACP_PROFILE_PERSONAL_CODEX__UNREVIEWED: 'secret' }],
      ['codex', 'personal-codex', { JIG_ACP_PROFILE_PERSONAL_CODEX__OPENAI_MODEL: 'model' }],
      [
        'claude',
        'claude-work',
        { JIG_ACP_PROFILE_CLAUDE_WORK__CLAUDE_CODE_OAUTH_TOKEN: 'conflict' },
      ],
      ['pi', 'pi-home', { JIG_ACP_PROFILE_PI_HOME__PI_API_KEY: 'conflict' }],
    ] as const) {
      expect(() =>
        privateAcpProfileEnvironment({ ...sources, ...value }, client, profile),
      ).toThrow()
    }
  })
})
describe('target-selected private ACP resources', () => {
  test('keeps native destinations outside reserved sandbox paths', () => {
    for (const destination of [
      '/tmp/client',
      '/work/lib.so',
      '/proc/client',
      '/run/client',
      '/sys/client',
      '/dev/client',
      '/jig/client',
    ]) {
      expect(privateLinuxProtectedDestination(destination)).toBeTrue()
    }
    expect(privateLinuxProtectedDestination('/agent/client')).toBeFalse()
  })
  test('maps ordinary setup errors without exposing private causes or accepting forged codes', () => {
    for (const client of ['codex', 'claude', 'pi'] as const) {
      for (const stage of [
        'executable',
        'installation',
        'location',
        'wrapper',
        'login',
        'login-layout',
        'api',
        'model',
        'preferences',
        'managed-policy',
      ] as const) {
        const cause = new PrivateAcpSetupError(stage)
        cause.message = 'private-token /private/installation'
        const error = new PrivateAcpResourceUnavailableError('session', client, cause)
        expect(error.code).toBe(acpSetupCode(client, stage))
        expect(error.message).not.toContain('private-token')
        expect(error.message).not.toContain('/private/')
        expect(ACP_SETUP_HINTS[error.code]).toContain('jig review')
      }
      expect(
        new PrivateAcpResourceUnavailableError('session', client, {
          code: acpSetupCode(client, 'login'),
          stage: 'login',
          message: 'secret',
        }).code,
      ).toBe('PROJECT_ACP_UNAVAILABLE')
    }
    expect(ACP_SETUP_HINTS.PROJECT_ACP_CODEX_MANAGED_POLICY).toContain(
      'Keep operator-managed settings intact',
    )
  })
  test('real missing discovery stays target scoped and snapshots operator configuration', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-acp-resources-')))
    try {
      const support = await openPrivateInstalledBunSupport(installedBunLocation)
      const environment = { PATH: '', CODEX_PATH: join(root, 'missing-codex') }
      const owner = openPrivateAcpResources(support, environment, root)
      environment.CODEX_PATH = process.execPath
      for (const client of ['codex', 'claude', 'pi'] as const) {
        await expect(
          selectPrivateAcpResources(owner, slots(client), support),
        ).rejects.toMatchObject({ code: acpSetupCode(client, 'executable') })
      }
      expect(await selectPrivateAcpResources(owner, {}, support)).toEqual({})
      expect(await selectPrivateAcpResources(undefined, {}, support)).toEqual({})
      for (const value of [undefined, { ...owner }]) {
        await expect(selectPrivateAcpResources(value, slots('codex'), support)).rejects.toThrow(
          'owner',
        )
      }
      const foreign = await openPrivateInstalledBunSupport(installedBunLocation)
      await expect(selectPrivateAcpResources(owner, slots('codex'), foreign)).rejects.toThrow(
        'owner',
      )
      expect(() => openPrivateAcpResources(support, {}, './relative')).toThrow('absolute')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
