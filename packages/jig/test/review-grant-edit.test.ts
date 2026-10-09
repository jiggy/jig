import { describe, expect, test } from 'bun:test'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { renamePrivateFile } from '../src/internal/descriptor-files.js'
import {
  type PrivateReviewGrantEdit,
  PrivateReviewGrantEditError,
  type PrivateReviewGrantEditTestHooks,
  publishReviewGrantEdit,
} from '../src/internal/review-grant-edit.js'
import type { AcpGrant } from '../src/project/grants.js'
import { createProject } from '../src/project-init.js'

const selected = 'grants/agent.json'
const source = '{"kind":"acp","client":"codex"}\n'
const policy: AcpGrant = { kind: 'acp', client: 'codex' }
async function withProject(run: (root: string) => Promise<void>, bytes = source): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-review-grant-'))
  const root = join(temporary, 'project')
  try {
    await mkdir(join(root, 'grants'), { recursive: true })
    await writeFile(join(root, selected), bytes)
    await run(root)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
async function correction(
  root: string,
  proposed: AcpGrant = { kind: 'acp', client: 'pi' },
  expectedBytes = source,
  previous = policy,
  path = selected,
): Promise<PrivateReviewGrantEdit> {
  const identity = await lstat(root, { bigint: true })
  return {
    path,
    expectedBytes: Buffer.from(expectedBytes),
    previous,
    proposed,
    projectIdentity: { device: String(identity.dev), inode: String(identity.ino) },
  }
}
async function edit(
  root: string,
  next: { client: AcpGrant['client'] },
  signal?: AbortSignal,
  testing?: PrivateReviewGrantEditTestHooks,
) {
  return publishReviewGrantEdit(
    root,
    await correction(root, { kind: 'acp', ...next }),
    signal,
    testing,
  )
}
async function files(root: string): Promise<string[]> {
  return (await readdir(join(root, 'grants'))).sort()
}
async function expectFailure(
  operation: Promise<unknown>,
  code: string,
  published = false,
): Promise<PrivateReviewGrantEditError> {
  try {
    await operation
    throw new Error('expected review correction refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateReviewGrantEditError)
    expect(error).toMatchObject({ code, published })
    expect((error as Error).message).not.toContain('private-secret')
    return error as PrivateReviewGrantEditError
  }
}

describe('captured review grant publication', () => {
  test('matches exact captured bytes, preserves turn policy, and evaluates no project source', async () => {
    const bytes =
      '  { "kind": "acp", "client": "codex", "model": "old-model", "maxTurns": 3, "retainSessions": true }\n'
    await withProject(async (root) => {
      await writeFile(join(root, 'jig.ts'), 'throw new Error("must not evaluate")')
      await writeFile(join(root, 'jig.lock'), 'unchanged approval')
      await chmod(join(root, selected), 0o640)
      const original: AcpGrant = {
        kind: 'acp',
        client: 'codex',
        model: 'old-model',
        maxTurns: 3,
        retainSessions: true,
      }
      const next: AcpGrant = { kind: 'acp', client: 'claude', model: 'new-model', maxTurns: 3 }
      const result = await publishReviewGrantEdit(
        root,
        await correction(root, next, bytes, original),
      )
      expect(result).toEqual({ path: selected, changed: true })
      expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual(next)
      expect((await lstat(join(root, selected))).mode & 0o7777).toBe(0o640)
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe('unchanged approval')
      expect(await files(root)).toEqual(['agent.json'])
    }, bytes)
  })
  test('semantic no-op preserves exact captured bytes and inode', async () => {
    const bytes = ' { "client": "codex", "kind": "acp" }\n'
    await withProject(async (root) => {
      const before = await lstat(join(root, selected), { bigint: true })
      expect(await publishReviewGrantEdit(root, await correction(root, policy, bytes))).toEqual({
        path: selected,
        changed: false,
      })
      const after = await lstat(join(root, selected), { bigint: true })
      expect(after.ino).toBe(before.ino)
      expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
    }, bytes)
  })
  test('an edit between capture and publication is refused without overwriting it', async () => {
    await withProject(async (root) => {
      const proposal = await correction(root)
      const replacement = '{"kind":"acp","client":"codex","maxTurns":2}\n'
      await writeFile(join(root, selected), replacement)
      await expectFailure(publishReviewGrantEdit(root, proposal), 'REVIEW_GRANT_CHANGED')
      expect(await readFile(join(root, selected), 'utf8')).toBe(replacement)
    })
  })
  test('a replacement project root cannot receive an earlier captured correction', async () => {
    await withProject(async (root) => {
      const proposal = await correction(root)
      await rename(root, join(dirname(root), 'earlier-project'))
      await mkdir(join(root, 'grants'), { recursive: true })
      await writeFile(join(root, selected), source)
      await expectFailure(publishReviewGrantEdit(root, proposal), 'REVIEW_GRANT_CHANGED')
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
    })
  })
  test('the publication owner cannot raise turns or introduce session retention', async () => {
    await withProject(async (root) => {
      for (const next of [
        { ...policy, maxTurns: 2 },
        { ...policy, retainSessions: true as const },
      ])
        await expectFailure(
          publishReviewGrantEdit(root, await correction(root, next)),
          'REVIEW_GRANT_INVALID',
        )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
    })
  })
  test('refuses invalid captured policy and unsafe paths before any source write', async () => {
    await withProject(async (root) => {
      for (const path of [
        '../agent.json',
        '/agent.json',
        '.jig/agent.json',
        '.JIG/agent.json',
        'grants/Agent.json',
        'grants/agent.txt',
        'grants/agent.JSON',
        'grants//agent.json',
        'grants\\agent.json',
      ])
        await expectFailure(
          publishReviewGrantEdit(
            root,
            await correction(root, undefined, undefined, undefined, path),
          ),
          'REVIEW_GRANT_INVALID',
        )
      for (const bytes of [
        '',
        '{',
        '{"kind":"acp","client":"codex","client":"pi"}',
        source + ' '.repeat(32768),
      ])
        await expectFailure(
          publishReviewGrantEdit(root, await correction(root, undefined, bytes)),
          'REVIEW_GRANT_INVALID',
        )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
    })
  })
  test('refuses missing captured source, file/ancestor links, hardlinks and special files', async () => {
    await withProject(async (root) => {
      await expectFailure(
        publishReviewGrantEdit(
          root,
          await correction(root, undefined, undefined, undefined, 'missing/agent.json'),
        ),
        'REVIEW_GRANT_CHANGED',
      )
      await symlink('grants', join(root, 'linked'))
      await expectFailure(
        publishReviewGrantEdit(
          root,
          await correction(root, undefined, undefined, undefined, 'linked/agent.json'),
        ),
        'REVIEW_GRANT_UNSAFE',
      )
      await symlink('agent.json', join(root, 'grants/link.json'))
      await expectFailure(
        publishReviewGrantEdit(
          root,
          await correction(root, undefined, undefined, undefined, 'grants/link.json'),
        ),
        'REVIEW_GRANT_UNSAFE',
      )
      await link(join(root, selected), join(root, 'grants/hard.json'))
      await expectFailure(edit(root, { client: 'pi' }), 'REVIEW_GRANT_UNSAFE')
      expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, 'grants/pipe.json')]).exitCode).toBe(0)
      await expectFailure(
        publishReviewGrantEdit(
          root,
          await correction(root, undefined, undefined, undefined, 'grants/pipe.json'),
        ),
        'REVIEW_GRANT_UNSAFE',
      )
    })
  })
  test('original concurrent edits are fenced and their new bytes survive', async () => {
    await withProject(async (root) => {
      const bytes = '{"kind":"acp","client":"codex","maxTurns":2}'
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase === 'staged') await writeFile(join(root, selected), bytes)
          },
        }),
        'REVIEW_GRANT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('concurrent ancestor replacement cannot redirect publication', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase !== 'staged') return
            await rename(join(root, 'grants'), join(root, 'old-grants'))
            await mkdir(join(root, 'grants'))
            await writeFile(join(root, selected), 'unfamiliar source')
          },
        }),
        'REVIEW_GRANT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe('unfamiliar source')
      expect(await readFile(join(root, 'old-grants/agent.json'), 'utf8')).toBe(source)
      expect(await readdir(join(root, 'old-grants'))).toEqual(['agent.json'])
    })
  })

  test('concurrent root replacement is fenced', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase !== 'staged') return
            await rename(root, join(dirname(root), 'old-project'))
            await mkdir(join(root, 'grants'), { recursive: true })
            await writeFile(join(root, selected), 'unfamiliar root source')
          },
        }),
        'REVIEW_GRANT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe('unfamiliar root source')
      expect(await readdir(join(dirname(root), 'old-project/grants'))).toEqual(['agent.json'])
    })
  })

  test('staged bytes and permissions are checked before publication', async () => {
    for (const attack of ['bytes', 'permissions'])
      await withProject(async (root) => {
        await expectFailure(
          edit(root, { client: 'pi' }, undefined, {
            checkpoint: async (phase, state) => {
              if (phase !== 'staged') return
              if (attack === 'bytes')
                await writeFile(join(root, 'grants', state.stageName!), 'unfamiliar staged bytes')
              else await chmod(join(root, 'grants', state.stageName!), 0o777)
            },
          }),
          'REVIEW_GRANT_UNSAFE',
        )
        expect(await readFile(join(root, selected), 'utf8')).toBe(source)
        expect(await files(root)).toEqual(['agent.json'])
      })
  })

  test('a hardlink to the staging inode prevents publication', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          checkpoint: async (phase, state) => {
            if (phase === 'staged')
              await link(join(root, 'grants', state.stageName!), join(root, 'grants/extra'))
          },
        }),
        'REVIEW_GRANT_UNSAFE',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect(await files(root)).toEqual(['agent.json', 'extra'])
    })
  })

  test('unfamiliar staging replacements survive cleanup and cleanup failure stays visible', async () => {
    for (const attack of ['file', 'symlink', 'hardlink'])
      await withProject(async (root) => {
        let stageName = ''
        const error = await expectFailure(
          edit(root, { client: 'pi' }, undefined, {
            checkpoint: async (phase, state) => {
              if (phase !== 'staged') return
              stageName = state.stageName!
              const path = join(root, 'grants', stageName)
              await unlink(path)
              if (attack === 'file') await writeFile(path, 'unfamiliar staged replacement')
              else if (attack === 'symlink') await symlink('agent.json', path)
              else await link(join(root, selected), path)
            },
          }),
          'REVIEW_GRANT_CLEANUP_FAILED',
        )
        expect(error.message).toContain('cleanup did not complete')
        expect(await readFile(join(root, selected), 'utf8')).toBe(source)
        expect(await files(root)).toEqual([stageName, 'agent.json'].sort())
        if (attack === 'file')
          expect(await readFile(join(root, 'grants', stageName), 'utf8')).toBe(
            'unfamiliar staged replacement',
          )
      })
  })

  test('prepublication cancellation cleans staging without changing source', async () => {
    for (const phase of ['initial', 'staged', 'before-publish'])
      await withProject(async (root) => {
        const controller = new AbortController()
        if (phase === 'initial') controller.abort(new Error('private-secret'))
        await expectFailure(
          edit(root, { client: 'pi' }, controller.signal, {
            checkpoint: async (observed) => {
              if (observed === phase) controller.abort(new Error('private-secret'))
            },
          }),
          'REVIEW_GRANT_CANCELLED',
        )
        expect(await readFile(join(root, selected), 'utf8')).toBe(source)
        expect(await files(root)).toEqual(['agent.json'])
      })
  })

  test('cancellation after publication still completes verification', async () => {
    await withProject(async (root) => {
      const controller = new AbortController()
      const result = await edit(root, { client: 'pi' }, controller.signal, {
        checkpoint: async (phase) => {
          if (phase === 'published') controller.abort()
        },
      })
      expect(result.changed).toBe(true)
      expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual({
        kind: 'acp',
        client: 'pi',
      })
    })
  })

  test('write failure is closed and distinct from publication uncertainty', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          write: async () => {
            throw new Error('private-secret')
          },
        }),
        'REVIEW_GRANT_UNAVAILABLE',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('an attempted rename failure reports uncertainty without changing unrelated source', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          rename: async () => {
            throw new Error('private-secret')
          },
        }),
        'REVIEW_GRANT_PUBLISHED_UNCERTAIN',
        true,
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('rename success followed by an exception is not rolled back or mistaken for failed cleanup', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          rename: async (from, to) => {
            await renamePrivateFile(from, to)
            throw new Error('private-secret')
          },
        }),
        'REVIEW_GRANT_PUBLISHED_UNCERTAIN',
        true,
      )
      expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual({
        kind: 'acp',
        client: 'pi',
      })
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('postpublication sync failure and source replacement disclose uncertainty without rollback', async () => {
    for (const failure of ['sync', 'replace'])
      await withProject(async (root) => {
        const hooks: PrivateReviewGrantEditTestHooks =
          failure === 'sync'
            ? {
                syncParent: async () => {
                  throw new Error('private-secret')
                },
              }
            : {
                checkpoint: async (phase) => {
                  if (phase === 'published')
                    await writeFile(join(root, selected), 'unfamiliar published content')
                },
              }
        const error = await expectFailure(
          edit(root, { client: 'pi' }, undefined, hooks),
          'REVIEW_GRANT_PUBLISHED_UNCERTAIN',
          true,
        )
        expect(error.message).toContain('may already have changed')
        if (failure === 'replace')
          expect(await readFile(join(root, selected), 'utf8')).toBe('unfamiliar published content')
        else
          expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual({
            kind: 'acp',
            client: 'pi',
          })
      })
  })

  test('failed staging cleanup stays visible', async () => {
    await withProject(async (root) => {
      await expectFailure(
        edit(root, { client: 'pi' }, undefined, {
          write: async () => {
            throw new Error('private-secret')
          },
          unlink: async () => {
            throw new Error('private-secret')
          },
        }),
        'REVIEW_GRANT_CLEANUP_FAILED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect((await files(root)).length).toBe(2)
    })
  })

  test('Agent starters discover ordinary named grants and remain separately reviewable', async () => {
    await withProject(async (root) => {
      for (const client of ['codex', 'claude', 'pi'] as const) {
        const project = join(root, client)
        await createProject(project, undefined, true, client)
        expect(JSON.parse(await readFile(join(project, selected), 'utf8'))).toEqual({
          kind: 'acp',
          client,
        })
        expect(await readFile(join(project, 'jig.ts'), 'utf8')).toContain(
          'grants: discover("./grants")',
        )
        expect(await readFile(join(project, 'bindings/agent.ts'), 'utf8')).toContain(
          'native: "grant:agent"',
        )
        expect(await readFile(join(project, 'README.md'), 'utf8')).toContain('grants/agent.json')
        expect(await readFile(join(project, 'README.md'), 'utf8')).not.toContain('jig agent')
        expect(await readdir(project)).not.toContain('.jig')
      }
    })
  })
})
