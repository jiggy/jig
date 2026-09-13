import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { resolvePrivateNativeAgentExecutable as discover } from '../src/internal/native-agent-executable.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-agent-discovery-'))
  temporary.push(root)
  const project = join(root, 'workspace', 'project')
  const first = join(root, 'operator', 'bin')
  const second = join(root, 'another', 'bin')
  await Promise.all([project, first, second].map((path) => mkdir(path, { recursive: true })))
  for (const client of ['codex', 'claude', 'pi']) {
    for (const directory of [first, second]) {
      await writeFile(join(directory, client), 'native test fixture\n', { mode: 0o700 })
    }
  }
  return { root, project, first, second }
}

describe('operator native Agent executable discovery', () => {
  test.each(['codex', 'claude', 'pi'] as const)(
    '%s follows PATH order and explicit overrides',
    async (client) => {
      const { project, first, second } = await fixture()
      expect(await discover(client, { PATH: `${first}:${second}` }, project)).toBe(
        join(first, client),
      )
      expect(await discover(client, { PATH: `${second}:${first}` }, project)).toBe(
        join(second, client),
      )
      expect(
        await discover(
          client,
          { PATH: first, [`${client.toUpperCase()}_PATH`]: join(second, client) },
          project,
        ),
      ).toBe(join(second, client))
    },
  )

  test('invalid overrides never fall back to an available client', async () => {
    const { project, first } = await fixture()
    for (const selected of [
      '',
      'codex',
      './codex',
      join(first, 'missing'),
      `${first}/codex\0`,
      first,
    ]) {
      await expect(
        discover('codex', { PATH: first, CODEX_PATH: selected }, project),
      ).rejects.toThrow('unavailable')
    }
    await chmod(join(first, 'codex'), 0o600)
    await expect(
      discover('codex', { PATH: first, CODEX_PATH: join(first, 'codex') }, project),
    ).rejects.toThrow('unavailable')
  })

  test('skips missing and non-executable entries without falling back to fixed locations', async () => {
    const { project, first, second } = await fixture()
    await chmod(join(first, 'codex'), 0o600)
    expect(await discover('codex', { PATH: `/does-not-exist:${first}:${second}` }, project)).toBe(
      join(second, 'codex'),
    )
    await expect(discover('codex', {}, project)).rejects.toThrow('unavailable')
    await expect(discover('codex', { PATH: ':.:bin:./bin:' }, project)).rejects.toThrow(
      'unavailable',
    )
  })

  test('excludes the actual project, project aliases, and ancestor dependency binaries', async () => {
    const { root, project, first } = await fixture()
    const local = join(project, 'bin')
    const dependencies = join(dirname(project), 'node_modules', '.bin')
    const alias = join(root, 'project-alias')
    const dependencyAlias = join(root, 'dependency-alias')
    await mkdir(local)
    await mkdir(dependencies, { recursive: true })
    await writeFile(join(local, 'codex'), 'project-selected', { mode: 0o700 })
    await writeFile(join(dependencies, 'codex'), 'dependency-selected', { mode: 0o700 })
    await symlink(local, alias)
    await symlink(dependencies, dependencyAlias)
    const unsafe = `${local}:${alias}:${dependencies}:${dependencyAlias}`
    expect(await discover('codex', { PATH: `${unsafe}:${first}` }, project)).toBe(
      join(first, 'codex'),
    )
    await expect(discover('codex', { PATH: unsafe }, project)).rejects.toThrow('unavailable')
    // Only an explicit operator override can select a project executable.
    expect(await discover('codex', { CODEX_PATH: join(alias, 'codex') }, project)).toBe(
      join(local, 'codex'),
    )
  })

  test('resolves operator symlinks but excludes links into or out of the project', async () => {
    const { root, project, first, second } = await fixture()
    const profile = join(root, 'profile')
    await symlink(first, profile)
    expect(await discover('codex', { PATH: profile }, project)).toBe(join(first, 'codex'))
    await symlink(first, join(project, 'operator-link'))
    await symlink(join(second, 'codex'), join(project, 'codex'))
    await rm(join(first, 'codex'))
    await symlink(join(project, 'codex'), join(first, 'codex'))
    await expect(discover('codex', { PATH: first }, project)).rejects.toThrow('unavailable')
    // A project path itself is excluded even when its destination is external.
    await expect(
      discover('codex', { PATH: join(project, 'operator-link') }, project),
    ).rejects.toThrow('unavailable')
  })

  test('snapshots PATH and override values before filesystem work', async () => {
    const { project, first, second } = await fixture()
    const environment: Record<string, string> = { PATH: first }
    const pending = discover('codex', environment, project)
    environment.PATH = second
    environment.CODEX_PATH = join(second, 'codex')
    expect(await pending).toBe(join(first, 'codex'))
  })

  test('preserves filesystem semantics for symlinks followed by parent segments', async () => {
    const { root, project, first, second } = await fixture()
    const profile = join(root, 'profile')
    await symlink(first, profile)
    expect(await discover('codex', { PATH: `${profile}/../bin:${second}` }, project)).toBe(
      join(first, 'codex'),
    )
  })
})
