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
  ProjectAgentError,
  type ProjectAgentTestHooks,
  selectProjectAgent,
} from '../src/project-agent.js'
import { createProject } from '../src/project-init.js'

const selected = 'grants/agent.json'
const source = '{"kind":"acp","client":"codex"}\n'

async function withProject(run: (root: string) => Promise<void>, bytes = source): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-agent-authoring-'))
  const root = join(temporary, 'project')
  try {
    await mkdir(join(root, 'grants'), { recursive: true })
    await writeFile(join(root, selected), bytes)
    await run(root)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function files(root: string): Promise<string[]> {
  return (await readdir(join(root, 'grants'))).sort()
}

async function expectFailure(
  operation: Promise<unknown>,
  code: string,
  published = false,
): Promise<ProjectAgentError> {
  try {
    await operation
    throw new Error('expected grant editing refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectAgentError)
    expect(error).toMatchObject({ code, published })
    expect((error as Error).message).not.toContain('private-secret')
    return error as ProjectAgentError
  }
}

describe('explicit ACP grant source selection', () => {
  test('preserves a same-client pin, retention, turns and exact no-op source bytes', async () => {
    const bytes =
      '  { "maxTurns": 4, "client": "codex", "retainSessions": true, "model": "gpt-test", "kind": "acp" }\n'
    await withProject(async (root) => {
      await writeFile(join(root, 'jig.ts'), 'throw new Error("source must not be evaluated");')
      const before = await lstat(join(root, selected), { bigint: true })
      const result = await selectProjectAgent(root, './' + selected, { client: 'codex' })
      expect(result).toEqual({
        path: selected,
        previous: {
          kind: 'acp',
          client: 'codex',
          model: 'gpt-test',
          maxTurns: 4,
          retainSessions: true,
        },
        next: {
          kind: 'acp',
          client: 'codex',
          model: 'gpt-test',
          maxTurns: 4,
          retainSessions: true,
        },
        changed: false,
      })
      expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
      const after = await lstat(join(root, selected), { bigint: true })
      expect([after.ino, after.mtimeNs, after.mode]).toEqual([
        before.ino,
        before.mtimeNs,
        before.mode,
      ])
      expect(await files(root)).toEqual(['agent.json'])
      expect(await readdir(root)).toEqual(['grants', 'jig.ts'])
    }, bytes)
  })

  test('resets only the pin and preserves retained-session and turn policy and permissions', async () => {
    await withProject(async (root) => {
      await chmod(join(root, selected), 0o640)
      const result = await selectProjectAgent(root, selected, {
        client: 'codex',
        defaultModel: true,
      })
      expect(result.next).toEqual({
        kind: 'acp',
        client: 'codex',
        maxTurns: 3,
        retainSessions: true,
      })
      expect(result.changed).toBe(true)
      expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual(result.next)
      expect((await lstat(join(root, selected))).mode & 0o7777).toBe(0o640)
      expect(await files(root)).toEqual(['agent.json'])
    }, '{"kind":"acp","client":"codex","model":"gpt-test","maxTurns":3,"retainSessions":true}')
  })

  test('client switch requires explicit replacement or reset of an existing pin', async () => {
    await withProject(async (root) => {
      const original = await readFile(join(root, selected), 'utf8')
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'claude' }),
        'JIG_AGENT_MODEL_REQUIRED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(original)
      const replaced = await selectProjectAgent(root, selected, {
        client: 'claude',
        model: 'claude-test',
      })
      expect(replaced.next).toEqual({
        kind: 'acp',
        client: 'claude',
        model: 'claude-test',
        maxTurns: 2,
      })
      const reset = await selectProjectAgent(root, selected, { client: 'pi', defaultModel: true })
      expect(reset.next).toEqual({ kind: 'acp', client: 'pi', maxTurns: 2 })
    }, '{"kind":"acp","client":"codex","model":"gpt-test","maxTurns":2}')
  })

  test('a client switch without a source pin does not invent a model', async () => {
    await withProject(async (root) => {
      const result = await selectProjectAgent(root, selected, { client: 'pi' })
      expect(result.next).toEqual({ kind: 'acp', client: 'pi' })
    })
  })

  test('retention refuses a client switch even with an explicit model reset', async () => {
    const bytes = '{"kind":"acp","client":"codex","retainSessions":true}'
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'claude', defaultModel: true }),
        'JIG_AGENT_RETENTION',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
    }, bytes)
  })

  for (const bytes of [
    '',
    '{',
    '{"kind":"acp","client":"codex","client":"pi"}',
    '{"kind":"acp","client":"codex","secret":"private-secret"}',
    '{"kind":"acp","client":"claude","retainSessions":true}',
    '{"kind":"acp","client":"codex","retainSessions":false}',
    '{"kind":"acp","client":"codex","maxTurns":9}',
    '{"kind":"http","url":"https://example.org/","method":"GET"}',
    '{"kind":"acp","client":"codex"}' + ' '.repeat(32_768),
  ]) {
    test(`refuses invalid original policy ${bytes.slice(0, 50) || 'empty'}`, async () => {
      await withProject(async (root) => {
        await expectFailure(
          selectProjectAgent(root, selected, { client: 'claude' }),
          'JIG_AGENT_INVALID',
        )
        expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
        expect(await files(root)).toEqual(['agent.json'])
      }, bytes)
    })
  }

  test('refuses invalid models and conflicting model/reset options', async () => {
    await withProject(async (root) => {
      for (const selection of [
        { client: 'codex' as const, model: 'bad model' },
        { client: 'codex' as const, model: 'test', defaultModel: true },
      ])
        await expectFailure(selectProjectAgent(root, selected, selection), 'JIG_AGENT_INVALID')
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
    })
  })

  test('refuses traversal, absolute, protected and non-LocalName JSON paths', async () => {
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
        await expectFailure(selectProjectAgent(root, path, { client: 'pi' }), 'JIG_AGENT_INVALID')
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
    })
  })

  test('refuses missing source and unsafe file/ancestor links and hardlinks', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, 'missing/agent.json', { client: 'pi' }),
        'JIG_AGENT_MISSING',
      )
      await symlink('grants', join(root, 'linked'))
      await expectFailure(
        selectProjectAgent(root, 'linked/agent.json', { client: 'pi' }),
        'JIG_AGENT_UNSAFE',
      )
      await symlink('agent.json', join(root, 'grants/link.json'))
      await expectFailure(
        selectProjectAgent(root, 'grants/link.json', { client: 'pi' }),
        'JIG_AGENT_UNSAFE',
      )
      await link(join(root, selected), join(root, 'grants/hard.json'))
      await expectFailure(selectProjectAgent(root, selected, { client: 'pi' }), 'JIG_AGENT_UNSAFE')
      await mkdir(join(root, 'grants/directory.json'))
      await expectFailure(
        selectProjectAgent(root, 'grants/directory.json', { client: 'pi' }),
        'JIG_AGENT_UNSAFE',
      )
    })
  })

  test('refuses a special-file source without opening it', async () => {
    await withProject(async (root) => {
      expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, 'grants/pipe.json')]).exitCode).toBe(0)
      await expectFailure(
        selectProjectAgent(root, 'grants/pipe.json', { client: 'pi' }),
        'JIG_AGENT_UNSAFE',
      )
    })
  })

  test('original concurrent edits are fenced and their new bytes survive', async () => {
    await withProject(async (root) => {
      const bytes = '{"kind":"acp","client":"codex","maxTurns":2}'
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase === 'staged') await writeFile(join(root, selected), bytes)
          },
        }),
        'JIG_AGENT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(bytes)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('concurrent ancestor replacement cannot redirect publication', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase !== 'staged') return
            await rename(join(root, 'grants'), join(root, 'old-grants'))
            await mkdir(join(root, 'grants'))
            await writeFile(join(root, selected), 'unfamiliar source')
          },
        }),
        'JIG_AGENT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe('unfamiliar source')
      expect(await readFile(join(root, 'old-grants/agent.json'), 'utf8')).toBe(source)
      expect(await readdir(join(root, 'old-grants'))).toEqual(['agent.json'])
    })
  })

  test('concurrent root replacement is fenced', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          checkpoint: async (phase) => {
            if (phase !== 'staged') return
            await rename(root, join(dirname(root), 'old-project'))
            await mkdir(join(root, 'grants'), { recursive: true })
            await writeFile(join(root, selected), 'unfamiliar root source')
          },
        }),
        'JIG_AGENT_CHANGED',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe('unfamiliar root source')
      expect(await readdir(join(dirname(root), 'old-project/grants'))).toEqual(['agent.json'])
    })
  })

  test('staged bytes and permissions are checked before publication', async () => {
    for (const attack of ['bytes', 'permissions'])
      await withProject(async (root) => {
        await expectFailure(
          selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
            checkpoint: async (phase, state) => {
              if (phase !== 'staged') return
              if (attack === 'bytes')
                await writeFile(join(root, 'grants', state.stageName!), 'unfamiliar staged bytes')
              else await chmod(join(root, 'grants', state.stageName!), 0o777)
            },
          }),
          'JIG_AGENT_CHANGED',
        )
        expect(await readFile(join(root, selected), 'utf8')).toBe(source)
        expect(await files(root)).toEqual(['agent.json'])
      })
  })

  test('a hardlink to the staging inode prevents publication', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          checkpoint: async (phase, state) => {
            if (phase === 'staged')
              await link(join(root, 'grants', state.stageName!), join(root, 'grants/extra'))
          },
        }),
        'JIG_AGENT_UNSAFE',
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
          selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
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
          'JIG_AGENT_CLEANUP_FAILED',
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
          selectProjectAgent(root, selected, { client: 'pi' }, controller.signal, {
            checkpoint: async (observed) => {
              if (observed === phase) controller.abort(new Error('private-secret'))
            },
          }),
          'JIG_AGENT_CANCELLED',
        )
        expect(await readFile(join(root, selected), 'utf8')).toBe(source)
        expect(await files(root)).toEqual(['agent.json'])
      })
  })

  test('cancellation after publication still completes verification', async () => {
    await withProject(async (root) => {
      const controller = new AbortController()
      const result = await selectProjectAgent(root, selected, { client: 'pi' }, controller.signal, {
        checkpoint: async (phase) => {
          if (phase === 'published') controller.abort()
        },
      })
      expect(result.changed).toBe(true)
      expect(JSON.parse(await readFile(join(root, selected), 'utf8'))).toEqual(result.next)
    })
  })

  test('write failure is closed and distinct from publication uncertainty', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          write: async () => {
            throw new Error('private-secret')
          },
        }),
        'JIG_AGENT_UNAVAILABLE',
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('an attempted rename failure reports uncertainty without changing unrelated source', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          rename: async () => {
            throw new Error('private-secret')
          },
        }),
        'JIG_AGENT_PUBLISHED_UNCERTAIN',
        true,
      )
      expect(await readFile(join(root, selected), 'utf8')).toBe(source)
      expect(await files(root)).toEqual(['agent.json'])
    })
  })

  test('rename success followed by an exception is not rolled back or mistaken for failed cleanup', async () => {
    await withProject(async (root) => {
      await expectFailure(
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          rename: async (from, to) => {
            await renamePrivateFile(from, to)
            throw new Error('private-secret')
          },
        }),
        'JIG_AGENT_PUBLISHED_UNCERTAIN',
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
        const hooks: ProjectAgentTestHooks =
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
          selectProjectAgent(root, selected, { client: 'pi' }, undefined, hooks),
          'JIG_AGENT_PUBLISHED_UNCERTAIN',
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
        selectProjectAgent(root, selected, { client: 'pi' }, undefined, {
          write: async () => {
            throw new Error('private-secret')
          },
          unlink: async () => {
            throw new Error('private-secret')
          },
        }),
        'JIG_AGENT_CLEANUP_FAILED',
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
        expect(await readdir(project)).not.toContain('.jig')
      }
    })
  })
})
