import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  initializePrivateActivationState,
  listPrivateRootExecutionWork,
} from '../src/internal/activation-admission-store.js'
import { openPrivateProjectSessionOwner } from '../src/internal/project-session-owner.js'
import { retainOpenedPackageProject } from '../src/project/retained-project.js'

describe('private project-session ownership', () => {
  test('bootstraps inert state and admits only one coordinator', async () => {
    await withDirectory(async (temporary) => {
      const project = join(temporary, 'project')
      await mkdir(project)
      const first = await openPrivateProjectSessionOwner(project)
      let reopened: Awaited<ReturnType<typeof openPrivateProjectSessionOwner>> | undefined
      try {
        const protectedState = await stat(join(project, '.jig'), { bigint: true })
        expect(protectedState.isDirectory()).toBe(true)
        expect(protectedState.mode & 0o7777n).toBe(0o700n)
        expect(await readdir(join(project, '.jig'))).toEqual(
          expect.arrayContaining(['coordinator.sqlite3', 'jig.sqlite3']),
        )

        await expect(openPrivateProjectSessionOwner(project)).rejects.toMatchObject({
          code: 'COORDINATOR_BUSY',
        })
        expect(first.coordinator.epoch).toBe(1)

        await first.dispose()
        reopened = await openPrivateProjectSessionOwner(project)
        expect(reopened.coordinator.epoch).toBe(2)
      } finally {
        await reopened?.dispose()
        await first.dispose()
      }
    })
  }, 15_000)

  test('never switches an open owner to a replacement path', async () => {
    await withDirectory(async (temporary) => {
      const project = join(temporary, 'project')
      const moved = join(temporary, 'moved')
      await mkdir(project)
      const owner = await openPrivateProjectSessionOwner(project)
      try {
        await rename(project, moved)
        await mkdir(project)

        await expect(owner.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CHANGED' })
        await expect(
          initializePrivateActivationState({ projectRoot: owner.root }),
        ).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CHANGED' })
        expect(await readdir(project)).toEqual([])
      } finally {
        await owner.dispose()
      }
    })
  }, 15_000)

  test('binds coordinator operations to device and inode, not a path string', async () => {
    await withDirectory(async (temporary) => {
      const firstPath = join(temporary, 'first')
      const secondPath = join(temporary, 'second')
      await mkdir(firstPath)
      await mkdir(secondPath)
      const first = await openPrivateProjectSessionOwner(firstPath)
      const second = await openPrivateProjectSessionOwner(secondPath)
      try {
        await expect(
          listPrivateRootExecutionWork({
            coordinator: first.coordinator,
            projectRoot: secondPath,
            epoch: 'current',
          }),
        ).rejects.toMatchObject({ code: 'COORDINATOR_PROJECT_MISMATCH' })
        expect(
          await listPrivateRootExecutionWork({
            coordinator: first.coordinator,
            projectRoot: firstPath,
            epoch: 'current',
          }),
        ).toEqual([])
      } finally {
        await second.dispose()
        await first.dispose()
      }
    })
  }, 15_000)

  test('a failed borrowed capture never disposes the session root', async () => {
    await withDirectory(async (temporary) => {
      const project = join(temporary, 'project')
      await mkdir(project)
      const owner = await openPrivateProjectSessionOwner(project)
      try {
        await expect(
          retainOpenedPackageProject({
            projectRoot: owner.root,
            storeRoot: join(project, '.jig', 'missing-store'),
            evaluator: undefined as never,
          }),
        ).rejects.toBeDefined()
        await expect(owner.verify()).resolves.toBeUndefined()
      } finally {
        await owner.dispose()
      }
    })
  }, 15_000)
})

async function withDirectory(action: (temporary: string) => Promise<void>): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-project-session-owner-'))
  try {
    await action(temporary)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
