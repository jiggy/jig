import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { resolvePrivateNativeAgentExecutable as discover } from '../src/internal/native-agent-executable.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-agent-discovery-')))
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

  for (const client of ['codex', 'claude', 'pi'] as const) {
    test(`${client}: invalid overrides never fall back to an available client`, async () => {
      const { project, first } = await fixture()
      for (const selected of [
        '',
        client,
        `./${client}`,
        join(first, 'missing'),
        `${first}/${client}\0`,
        first,
      ]) {
        await expect(
          discover(client, { PATH: first, [`${client.toUpperCase()}_PATH`]: selected }, project),
        ).rejects.toThrow('unavailable')
      }
      await chmod(join(first, client), 0o600)
      await expect(
        discover(
          client,
          { PATH: first, [`${client.toUpperCase()}_PATH`]: join(first, client) },
          project,
        ),
      ).rejects.toThrow('unavailable')
    })

    test(`${client}: skips missing and non-executable entries without falling back to fixed locations`, async () => {
      const { project, first, second } = await fixture()
      await chmod(join(first, client), 0o600)
      expect(await discover(client, { PATH: `/does-not-exist:${first}:${second}` }, project)).toBe(
        join(second, client),
      )
      await expect(discover(client, {}, project)).rejects.toThrow('unavailable')
      await expect(discover(client, { PATH: ':.:bin:./bin:' }, project)).rejects.toThrow(
        'unavailable',
      )
    })

    test(`${client}: excludes the actual project, project aliases, and ancestor dependency binaries`, async () => {
      const { root, project, first } = await fixture()
      const local = join(project, 'bin')
      const dependencies = join(dirname(project), 'node_modules', '.bin')
      const alias = join(root, 'project-alias')
      const dependencyAlias = join(root, 'dependency-alias')
      await mkdir(local)
      await mkdir(dependencies, { recursive: true })
      await writeFile(join(local, client), 'project-selected', { mode: 0o700 })
      await writeFile(join(dependencies, client), 'dependency-selected', { mode: 0o700 })
      await symlink(local, alias)
      await symlink(dependencies, dependencyAlias)
      const unsafe = `${local}:${alias}:${dependencies}:${dependencyAlias}`
      expect(await discover(client, { PATH: `${unsafe}:${first}` }, project)).toBe(
        join(first, client),
      )
      await expect(discover(client, { PATH: unsafe }, project)).rejects.toThrow('unavailable')
      // Only an explicit operator override can select a project executable.
      expect(
        await discover(client, { [`${client.toUpperCase()}_PATH`]: join(alias, client) }, project),
      ).toBe(join(local, client))
    })

    test(`${client}: resolves operator symlinks but excludes links into or out of the project`, async () => {
      const { root, project, first, second } = await fixture()
      const profile = join(root, 'profile')
      await symlink(first, profile)
      expect(await discover(client, { PATH: profile }, project)).toBe(join(first, client))
      await symlink(first, join(project, 'operator-link'))
      await symlink(join(second, client), join(project, client))
      await rm(join(first, client))
      await symlink(join(project, client), join(first, client))
      await expect(discover(client, { PATH: first }, project)).rejects.toThrow('unavailable')
      // A project path itself is excluded even when its destination is external.
      await expect(
        discover(client, { PATH: join(project, 'operator-link') }, project),
      ).rejects.toThrow('unavailable')
    })

    test(`${client}: snapshots PATH and override values before filesystem work`, async () => {
      const { project, first, second } = await fixture()
      const environment: Record<string, string> = { PATH: first }
      const pending = discover(client, environment, project)
      environment.PATH = second
      environment[`${client.toUpperCase()}_PATH`] = join(second, client)
      expect(await pending).toBe(join(first, client))
    })

    test(`${client}: preserves filesystem semantics for symlinks followed by parent segments`, async () => {
      const { root, project, first, second } = await fixture()
      const profile = join(root, 'profile')
      await symlink(first, profile)
      expect(await discover(client, { PATH: `${profile}/../bin:${second}` }, project)).toBe(
        join(first, client),
      )
    })
  }
})
