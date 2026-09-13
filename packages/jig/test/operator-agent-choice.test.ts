import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import {
  readPrivateAgentChoice,
  writePrivateAgentChoice,
} from '../src/internal/operator-agent-choice.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

async function fixture(
  work: (root: string, project: string, environment: Record<string, string>) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'jig-agent-choice-'))
  const project = join(root, 'project')
  await mkdir(project)
  try {
    await work(root, project, {
      XDG_STATE_HOME: join(root, 'state'),
      PATH: '',
      CODEX_PATH: '/missing/codex',
      CLAUDE_PATH: '/missing/claude',
      PI_PATH: '/missing/pi',
      OPENROUTER_API_KEY: 'synthetic-secret-never-send',
      OPENROUTER_MODEL: 'provider/model',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('credentials do not select an Agent; selection is explicit, reusable, and secret-free', async () => {
  await fixture(async (root, project, environment) => {
    let prompts = 0
    const host = await openPrivateInstalledBunHost(
      installedBunLocation,
      environment,
      project,
      undefined,
      {
        remember: true,
        choose: async (choices) => {
          prompts++
          expect(
            choices.filter((choice) => choice.unavailable === undefined).map((choice) => choice.id),
          ).toEqual(['api'])
          expect(choices.find((choice) => choice.id === 'api')?.label).toContain(
            'final result only',
          )
          expect(JSON.stringify(choices)).not.toContain('synthetic-secret')
          return 'api'
        },
      },
    )
    expect(host.agentProvider).toBeUndefined()
    expect(await readPrivateAgentChoice(environment, project)).toBeUndefined()
    const provider = await host.prepareAgent!(new AbortController().signal)
    expect(provider?.kind).toBe('private-openai-agent-provider/1')
    expect(await host.prepareAgent!(new AbortController().signal)).toBe(provider)
    expect(prompts).toBe(1)
    expect(await readPrivateAgentChoice(environment, project)).toBe('api')
    const files = await readdir(join(root, 'state/jig/agent-choices'))
    expect(files).toHaveLength(1)
    expect(await readFile(join(root, 'state/jig/agent-choices', files[0]!), 'utf8')).toBe('"api"\n')
    const reopened = await openPrivateInstalledBunHost(
      installedBunLocation,
      environment,
      project,
      undefined,
      { remember: false },
    )
    expect(reopened.agentProvider?.digest).toBe(provider?.digest)
    const override = await openPrivateInstalledBunHost(
      installedBunLocation,
      { ...environment, JIG_AGENT_CLIENT: 'codex' },
      project,
      undefined,
      { remember: false },
    )
    expect(override.agentProvider).toBeUndefined()
    expect(override.agentUnavailableHint).toContain('native codex')
    expect(await readPrivateAgentChoice(environment, project)).toBe('api')
  })
}, 15_000)

test('noninteractive, declined, invalid and aborted choices never save a client', async () => {
  await fixture(async (_root, project, environment) => {
    const unattended = await openPrivateInstalledBunHost(
      installedBunLocation,
      environment,
      project,
      undefined,
      { remember: false },
    )
    expect(await unattended.prepareAgent!(new AbortController().signal)).toBeUndefined()
    expect(unattended.agentUnavailableHint).toContain('run jig review in a terminal')
    for (const choice of [undefined, 'codex', 'invented']) {
      const host = await openPrivateInstalledBunHost(
        installedBunLocation,
        environment,
        project,
        undefined,
        { remember: true, choose: async () => choice },
      )
      expect(await host.prepareAgent!(new AbortController().signal)).toBeUndefined()
      expect(await readPrivateAgentChoice(environment, project)).toBeUndefined()
    }
    const controller = new AbortController()
    const host = await openPrivateInstalledBunHost(
      installedBunLocation,
      environment,
      project,
      undefined,
      {
        remember: true,
        choose: async () => {
          controller.abort()
          return 'api'
        },
      },
    )
    await expect(host.prepareAgent!(controller.signal)).rejects.toThrow()
    expect(await readPrivateAgentChoice(environment, project)).toBeUndefined()
  })
}, 15_000)

test('preferences are isolated by canonical project and reject unsafe files and project routes', async () => {
  await fixture(async (root, project, environment) => {
    const alias = join(root, 'alias')
    await symlink(project, alias)
    await writePrivateAgentChoice(environment, project, 'api')
    expect(await readPrivateAgentChoice(environment, alias)).toBe('api')
    const other = join(root, 'other')
    await mkdir(other)
    expect(await readPrivateAgentChoice(environment, other)).toBeUndefined()
    const directory = join(root, 'state/jig/agent-choices')
    const file = join(directory, (await readdir(directory))[0]!)
    await writeFile(file, '"invented"\n')
    await expect(readPrivateAgentChoice(environment, project)).rejects.toThrow()
    await writePrivateAgentChoice(environment, project, 'api')
    await chmod(file, 0o666)
    await expect(readPrivateAgentChoice(environment, project)).rejects.toThrow()
    await rm(file)
    await symlink(join(root, 'victim'), file)
    await expect(readPrivateAgentChoice(environment, project)).rejects.toThrow()
    await expect(
      writePrivateAgentChoice({ XDG_STATE_HOME: project }, project, 'api'),
    ).rejects.toThrow()
    const route = join(root, 'route')
    await symlink(project, route)
    await expect(
      writePrivateAgentChoice({ XDG_STATE_HOME: route }, project, 'api'),
    ).rejects.toThrow()
    expect(await readdir(project)).toEqual([])
  })
})
