import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  createPrivateAcpAgentProvider,
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import type { PrivateActivationReviewPlan } from '../src/internal/activation-admission-store.js'
import { planPrivateBunDirectRun } from '../src/internal/bun-direct-run.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import {
  type PrivateLinuxBackendMechanismObservation,
  PrivateLinuxCgroupBackend,
} from '../src/internal/linux-rootless-backend.js'
import {
  openPrivateAcpResources,
  type PrivateAcpClientOpener,
  selectPrivateAcpResources,
} from '../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../src/internal/private-finite-acp-contract.js'
import { renderPrivateProjectPlanReview } from '../src/internal/project-plan-review.js'
import type { JsonValue } from '../src/json.js'
import type { AcpGrant } from '../src/project/grants.js'
import type { InvocationSlots } from '../src/project/invocation-slots.js'
import { restorePrivateActivationRequest } from '../src/project/package-resolution.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'
import {
  ACP_SETUP_HINTS,
  acpSetupCode,
  PrivateAcpSetupError,
  type AcpSetupStage,
} from '../src/internal/acp-setup-diagnostics.js'
import { nativeElf } from './fixtures/native-elf.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('target-selected private ACP resources', () => {
  test('real missing executable discovery retains each selected client diagnostic', async () => {
    const f = await fixture()
    const owner = openPrivateAcpResources(f.support, { PATH: '' }, f.project)
    for (const client of ['codex', 'claude', 'pi'] as const) {
      await expect(
        selectPrivateAcpResources(owner, slots({ native: client }), f.support),
      ).rejects.toMatchObject({ code: acpSetupCode(client, 'executable') })
    }
  })

  test('known setup stages survive planning while private errors and forged codes stay hidden', async () => {
    const f = await fixture()
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    for (const client of ['codex', 'claude', 'pi'] as const) {
      for (const stage of [
        'executable',
        'installation',
        'login',
        'api',
        'model',
      ] as const satisfies readonly AcpSetupStage[]) {
        const cause = new PrivateAcpSetupError(stage)
        cause.message = 'private-token /private/installation'
        const owner = openPrivateAcpResources(f.support, {}, f.project, async () => {
          throw cause
        })
        const error = await planPrivateBunDirectRun({
          request: activationRequest(slots({ native: client })),
          backend,
          installedSupport: f.support,
          acpResources: owner,
        }).catch((error) => error)
        expect(error.code).toBe(acpSetupCode(client, stage))
        expect(error.path).toBe('flows/example/FLOW.ts')
        expect(error.message).not.toContain('private-token')
        expect(error.message).not.toContain('/private/')
        expect(ACP_SETUP_HINTS[error.code]).toContain('jig review')
      }
    }
    const owner = openPrivateAcpResources(f.support, {}, f.project, async () => {
      throw { code: acpSetupCode('pi', 'login'), stage: 'login', message: 'secret' }
    })
    await expect(
      selectPrivateAcpResources(owner, slots({ native: 'pi' }), f.support),
    ).rejects.toMatchObject({ code: 'PROJECT_ACP_UNAVAILABLE' })
  })

  test('snapshots operator configuration before lazy discovery', async () => {
    const f = await fixture()
    const seen: unknown[] = []
    const environment = {
      PI_PATH: '/missing/unselected-pi',
      MODEL: 'original',
      TOKEN: 'private-credential',
    }
    const owner = openPrivateAcpResources(f.support, environment, f.project, async (...args) => {
      const [client, support, frozen, project] = args
      seen.push([client, support === f.support, frozen.MODEL, frozen.TOKEN, project])
      expect(Object.isFrozen(frozen)).toBe(true)
      return await f.open(...args)
    })
    expect(seen).toEqual([])
    environment.MODEL = 'changed'
    environment.TOKEN = 'changed-secret'
    const selected = await selectPrivateAcpResources(owner, slots({ session: 'codex' }), f.support)
    expect(selected.session?.client).toBe('openai-codex')
    expect(selected.session?.model).toBe('original')
    expect(seen).toEqual([['codex', true, 'original', 'private-credential', f.project]])
    expect(JSON.stringify(owner)).not.toContain('private-credential')
    expect(JSON.stringify(selected)).not.toContain('private-credential')
  })

  test('opens each exact selected client once across concurrent targets and independent slot names', async () => {
    const f = await fixture()
    const calls: string[] = []
    const owner = openPrivateAcpResources(f.support, {}, f.project, async (...args) => {
      calls.push(args[0])
      return await f.open(...args)
    })
    const [a, b] = await Promise.all([
      selectPrivateAcpResources(owner, slots({ second: 'claude', first: 'codex' }), f.support),
      selectPrivateAcpResources(owner, slots({ another: 'codex' }), f.support),
    ])
    expect(Object.keys(a)).toEqual(['first', 'second'])
    expect(a.first).toBe(b.another)
    expect(a.second?.client).toBe('anthropic-claude-code')
    expect(calls.sort()).toEqual(['claude', 'codex'])
    expect(Object.isFrozen(a)).toBe(true)
  })

  test('two Bindings can select different models of the same client without changing operator credentials', async () => {
    const f = await fixture()
    const calls: Array<string | undefined> = []
    const owner = openPrivateAcpResources(
      f.support,
      { MODEL: 'ambient', TOKEN: 'private' },
      f.project,
      async (...args) => {
        calls.push(args[4])
        expect(args[2]).toEqual({ MODEL: 'ambient', TOKEN: 'private' })
        return f.open(...args)
      },
    )
    const select = (model?: string) => {
      const route = slots({ session: 'codex' }).session!
      return selectPrivateAcpResources(
        owner,
        {
          session: {
            ...route,
            grant: { kind: 'acp', client: 'codex', ...(model === undefined ? {} : { model }) },
          },
        } as InvocationSlots,
        f.support,
      )
    }
    const [a, b, again, ambient] = await Promise.all([
      select('one'),
      select('two'),
      select('one'),
      select(),
    ])
    expect(a.session?.model).toBe('one')
    expect(b.session?.model).toBe('two')
    expect(ambient.session?.model).toBe('ambient')
    expect(a.session).toBe(again.session)
    expect(a.session?.digest).not.toBe(b.session?.digest)
    expect(calls).toEqual(['one', 'two', undefined])
  })

  test('unavailable clients stay target-scoped, with no retry or alternative client fallback', async () => {
    const f = await fixture()
    const calls: string[] = []
    const owner = openPrivateAcpResources(f.support, {}, f.project, async (...args) => {
      calls.push(args[0])
      if (args[0] === 'pi') throw new Error('unavailable fixture client')
      return await f.open(...args)
    })
    expect(await selectPrivateAcpResources(undefined, {}, f.support)).toEqual({})
    await expect(
      selectPrivateAcpResources(owner, slots({ agent: 'pi' }), f.support),
    ).rejects.toThrow()
    await expect(
      selectPrivateAcpResources(owner, slots({ agent: 'pi' }), f.support),
    ).rejects.toThrow()
    expect(
      (await selectPrivateAcpResources(owner, slots({ agent: 'claude' }), f.support)).agent?.client,
    ).toBe('anthropic-claude-code')
    expect(calls).toEqual(['pi', 'claude'])
  })

  test('rejects copied owners, foreign host supports, and authentic but mismatching client implementations', async () => {
    const f = await fixture()
    const selected = slots({ session: 'codex' })
    const owner = openPrivateAcpResources(f.support, {}, f.project, f.open)
    await expect(selectPrivateAcpResources({ ...owner }, selected, f.support)).rejects.toThrow(
      'owner',
    )
    const otherSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    await expect(selectPrivateAcpResources(owner, selected, otherSupport)).rejects.toThrow('owner')
    const wrong = openPrivateAcpResources(f.support, {}, f.project, async (_, ...rest) =>
      f.open('pi', ...rest),
    )
    await expect(selectPrivateAcpResources(wrong, selected, f.support)).rejects.toThrow(
      'does not match',
    )
    expect(() => openPrivateAcpResources(f.support, {}, './relative', f.open)).toThrow('absolute')
  })

  test('production lookup honors exact selected clients without probing unrelated unavailable ones', async () => {
    const f = await fixture()
    const environment = {
      CODEX_PATH: '/missing/unrelated-codex',
      PI_PATH: '/missing/unrelated-pi',
      CLAUDE_PATH: f.executable,
      ANTHROPIC_API_KEY: 'private-credential',
      ANTHROPIC_MODEL: 'qualified-model',
    }
    const owner = openPrivateAcpResources(f.support, environment, f.project)
    const selected = await selectPrivateAcpResources(owner, slots({ session: 'claude' }), f.support)
    expect(selected.session?.client).toBe('anthropic-claude-code')
    expect(selected.session?.model).toBe('qualified-model')
    expect(privateAcpAgentRuntime(selected.session!).executablePath).toBe(f.executable)
    await expect(
      selectPrivateAcpResources(owner, slots({ session: 'codex' }), f.support),
    ).rejects.toThrow()
    await expect(selectPrivateAcpResources(owner, {}, f.support)).resolves.toEqual({})
  })

  test('pins exact client policy in recipes while retaining launch-time executable revalidation', async () => {
    const f = await fixture()
    const routes = slots({ session: 'codex' })
    const request = activationRequest(routes)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const plan = (environment: Record<string, string>) =>
      planPrivateBunDirectRun({
        request,
        backend,
        installedSupport: f.support,
        acpResources: openPrivateAcpResources(f.support, environment, f.project, f.open),
      })
    const original = await plan({ MODEL: 'first', TOKEN: 'first-secret' })
    expect(original.acp.session?.client).toBe('openai-codex')
    expect((await plan({ MODEL: 'first', TOKEN: 'rotated-secret' })).digest).toBe(original.digest)
    const changedModel = await plan({ MODEL: 'second', TOKEN: 'first-secret' })
    const changedPolicy = await plan({ MODEL: 'first', MODE: 'other-auth-policy' })
    for (const changed of [changedModel, changedPolicy]) {
      expect(changed.request.digest).toBe(original.request.digest)
      expect(changed.digest).not.toBe(original.digest)
      expect(changed.observation.digest).not.toBe(original.observation.digest)
    }
    await revalidatePrivateAcpAgentProvider(original.acp.session!)
    await writeFile(f.executable, Buffer.concat([await readFile(f.executable), Buffer.from('\n')]))
    await expect(revalidatePrivateAcpAgentProvider(original.acp.session!)).rejects.toThrow(
      'support changed',
    )
    expect((await plan({ MODEL: 'first', TOKEN: 'first-secret' })).digest).not.toBe(original.digest)
  })

  test('review projects each exact target and slot without credentials or unrelated private runtime facts', async () => {
    const f = await fixture()
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const acpResources = openPrivateAcpResources(
      f.support,
      { TOKEN: 'private-review-secret' },
      f.project,
      (client, support, environment, project) =>
        f.open(client, support, { ...environment, MODEL: `review-${client}` }, project),
    )
    const recipes = await Promise.all(
      (['codex', 'claude'] as const).map((client) =>
        planPrivateBunDirectRun({
          request: activationRequest(slots({ session: client }), `flows/${client}`),
          backend,
          installedSupport: f.support,
          acpResources,
        }),
      ),
    )
    const review = {
      baseCandidate: null,
      plan: {
        proposed: {
          lock: { packages: {}, bindings: {} },
          targets: recipes.map((recipe) => ({
            request: recipe.request,
            disposition: {
              state: 'ready',
              recipeDigest: recipe.digest,
              observationDigest: recipe.observation.digest,
              execution: recipe.execution,
            },
          })),
        },
      },
    } as unknown as PrivateActivationReviewPlan
    const rendered = renderPrivateProjectPlanReview(review, undefined, recipes)
    const details = parseYaml(rendered.details.slice(rendered.details.indexOf('  "')))
    expect(details.proposedHostAcp).toEqual({
      'flow:flows/codex': {
        session: {
          client: 'codex',
          model: 'review-codex',
          authentication: 'fixture-auth',
          executable: f.executable,
        },
      },
      'flow:flows/claude': {
        session: {
          client: 'claude',
          model: 'review-claude',
          authentication: 'fixture-auth',
          executable: f.executable,
        },
      },
    })
    for (const text of [rendered.text, rendered.details]) {
      expect(text).toContain('review-codex')
      expect(text).toContain('review-claude')
      expect(text).toContain(f.executable)
      expect(text).not.toContain('private-review-secret')
      expect(text).not.toContain(f.adapter)
      expect(text).not.toContain('startupInput')
      expect(text).not.toContain('recipeDigest')
    }
    expect(rendered.text).toContain('ACP runtimes selected for resource slots:')
    expect(() => renderPrivateProjectPlanReview(review)).toThrow('exact proposed recipe')
    expect(() => renderPrivateProjectPlanReview(review, undefined, [recipes[0]!])).toThrow(
      'exact proposed recipe',
    )
    expect(() =>
      renderPrivateProjectPlanReview(review, undefined, [{ ...recipes[0]! }, recipes[1]!]),
    ).toThrow('private planner')
    expect(() =>
      renderPrivateProjectPlanReview(review, undefined, [...recipes, recipes[0]!]),
    ).toThrow('duplicate')
  })

  test('a finite ACP grant requires an authenticated resource owner', async () => {
    const f = await fixture()
    await expect(
      planPrivateBunDirectRun({
        request: activationRequest(slots({ session: 'codex' })),
        backend: new StaticMechanismBackend({
          bunPath: '/test/bun',
          bunHostLibraryPath: '/test/lib',
        }),
        installedSupport: f.support,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACP_UNAVAILABLE' })
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-acp-resources-'))
  temporary.push(root)
  const project = join(root, 'project')
  const executable = join(root, 'native-client')
  const adapter = join(root, 'adapter.js')
  await mkdir(project)
  await writeFile(executable, nativeElf(), { mode: 0o700 })
  await writeFile(adapter, 'inert ACP metadata fixture')
  const support = await openPrivateInstalledBunSupport(installedBunLocation)
  const open: PrivateAcpClientOpener = async (client, _, environment, _project, model) =>
    createPrivateAcpAgentProvider({
      client: { codex: 'openai-codex', claude: 'anthropic-claude-code', pi: 'pi' }[client],
      model: model ?? environment.MODEL ?? 'fixture-model',
      credentialMode: environment.MODE ?? 'fixture-auth',
      adapterPath: adapter,
      sandboxAdapterPath: '/agent/adapter.js',
      executablePath: executable,
      sandboxExecutablePath: '/agent/client',
      environment: {},
      authentication: {
        identity: { method: 'fixture' },
        request: {
          methodId: 'fixture',
          _meta: { credential: environment.TOKEN ?? 'fixture-secret' },
        },
      },
    })
  return { root, project, executable, adapter, support, open }
}

function slots(clients: Readonly<Record<string, AcpGrant['client']>>): InvocationSlots {
  return Object.fromEntries(
    Object.entries(clients).map(([name, client]) => [
      name,
      {
        kind: 'native',
        native: 'finite-acp',
        grant: { kind: 'acp', client },
        contract: {
          id: FINITE_ACP_CONTRACT_ID,
          version: FINITE_ACP_CONTRACT_VERSION,
          digest: FINITE_ACP_CONTRACT_DIGEST,
        },
      },
    ]),
  )
}

function activationRequest(slots: InvocationSlots, path = 'flows/example') {
  const fields = {
    kind: 'activation-request/4',
    target: { kind: 'flow', path },
    mode: 'run',
    packagePath: path,
    package: { kind: 'flow-package/1', digest: digest('package') },
    entrypoint: { path: 'FLOW.ts', suffix: 'ts', selector: 'bun' },
    settings: {},
    slots,
    attachments: {},
  }
  return restorePrivateActivationRequest({
    ...fields,
    digest: privateDomainDigest('JIG-Activation-Request/4', fields as unknown as JsonValue),
  })
}

/** Planning-only mechanism evidence; never used to execute or claim containment. */
class StaticMechanismBackend extends PrivateLinuxCgroupBackend {
  override async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    return {
      support: {
        kind: 'linux-rootless-cgroup-v2-bubblewrap-mechanism/1',
        digest: digest('backend'),
        trustedSupervisorDigest: digest('supervisor'),
        trustedSupervisorPath: '/test/supervisor',
        trustedBubblewrapPath: '/test/bwrap',
        trustedBubblewrapDigest: digest('bwrap'),
        bubblewrapVersion: 'test',
        trustedCoordinatorBunPath: '/test/bun',
        trustedCoordinatorBunDigest: digest('bun'),
        trustedCoordinatorLibraryPath: '/test/lib',
        cgroupVersion: 2,
        controllers: ['cpu', 'memory', 'pids'],
        payloadUid: 1000,
        payloadGid: 1000,
        startupTimeoutMs: 1000,
      },
      authority: {
        bootId: '00000000-0000-0000-0000-000000000000',
        delegatedCgroup: '/test/cgroup',
        delegatedCgroupDevice: '1',
        delegatedCgroupInode: '2',
      },
    }
  }
}

function digest(label: string) {
  return privateDomainDigest('JIG-Test-ACP-Resources/1', { label })
}
