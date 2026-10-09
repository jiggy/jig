import { describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectPlanResult, ProjectSession } from '../src/administration/project.js'
import { main, type PrivateCliCommandHost, type PrivateCliOptions } from '../src/cli.js'
import type { PrivateAgentReadinessReport } from '../src/internal/review-agent-setup.js'
import type { AcpGrant } from '../src/project/grants.js'

const grantPath = 'configuration/interpreter.json'
const original = '{"kind":"acp","client":"pi"}\n'

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-review-setup-'))
  try {
    await mkdir(join(root, 'configuration'))
    await writeFile(join(root, grantPath), original)
    await writeFile(join(root, 'jig.lock'), 'previous exact approval')
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function readiness(
  root: string,
  allUnavailable = false,
): Promise<PrivateAgentReadinessReport> {
  const information = await lstat(root, { bigint: true })
  const bytes = await readFile(join(root, grantPath))
  const policy = JSON.parse(bytes.toString()) as AcpGrant
  const unavailable = policy.client === 'pi'
  return {
    projectIdentity: { device: String(information.dev), inode: String(information.ino) },
    complete: true,
    readyTargets: allUnavailable ? 0 : unavailable ? 1 : 2,
    unavailableTargets: allUnavailable ? 2 : unavailable ? 1 : 0,
    issues: unavailable
      ? [
          {
            target: { kind: 'binding', id: 'model' },
            declaration: 'bindings/model.ts',
            slot: 'native',
            client: policy.client,
            code: 'PROJECT_ACP_PI_EXECUTABLE',
            alternatives: ['codex'],
            grant: {
              path: grantPath,
              bytes,
              policy,
              recipients: [{ binding: 'model', declaration: 'bindings/model.ts', slot: 'native' }],
            },
          },
        ]
      : [],
  }
}

function plan(round: number, unchanged = false): ProjectPlanResult {
  return unchanged
    ? { state: 'unchanged' }
    : {
        state: 'applicable',
        operation: 'admission',
        planDigest: `sha256:${String(round).repeat(64)}`,
        review: {
          mediaType: 'text/plain; charset=utf-8',
          text: `Exact candidate ${round}\n`,
          details: `Complete candidate ${round}\n`,
          authorityChanges: true,
        },
      }
}

function outputOptions(
  root: string,
  host: PrivateCliCommandHost,
  extra: Partial<PrivateCliOptions> = {},
) {
  const output: string[] = [],
    errors: string[] = []
  return {
    output,
    errors,
    options: {
      currentDirectory: root,
      host,
      terminalError: false,
      terminalOutput: false,
      writeOutput: (text: string) => {
        output.push(text)
      },
      writeError: (text: string) => {
        errors.push(text)
      },
      ...extra,
    } satisfies PrivateCliOptions,
  }
}

describe('review guided source correction lifecycle', () => {
  test('closes the captured session before publishing, captures the new client, and asks separately for approval', async () => {
    await fixture(async (root) => {
      const events: string[] = []
      let round = 0
      const host: PrivateCliCommandHost = {
        async acquire(_project, options) {
          const current = ++round
          const value = await readiness(root)
          events.push(
            `acquire:${current}:${JSON.parse((await readFile(join(root, grantPath))).toString()).client}`,
          )
          return {
            rootAdministration: {} as ProjectSession['rootAdministration'],
            async plan() {
              events.push(`plan:${current}`)
              options?.onAgentReadiness?.(value)
              return plan(current)
            },
            async apply() {
              events.push(`apply:${current}`)
              expect(current).toBe(2)
              expect(JSON.parse((await readFile(join(root, grantPath))).toString()).client).toBe(
                'codex',
              )
              return { operation: 'admission', planDigest: `sha256:${String(current).repeat(64)}` }
            },
            async close() {
              const client = JSON.parse((await readFile(join(root, grantPath))).toString()).client
              events.push(`close:${current}:${client}`)
              if (current === 1) expect(client).toBe('pi')
            },
          }
        },
      }
      const invocation = outputOptions(root, host, {
        interactive: true,
        async answer() {
          events.push('choice')
          return '1'
        },
        async confirm(prompt) {
          events.push(prompt.startsWith('Update ') ? 'source-consent' : 'execution-approval')
          if (prompt.startsWith('Update ')) expect(round).toBe(1)
          else expect(round).toBe(2)
          return true
        },
      })
      expect(await main(['review'], invocation.options)).toBe(0)
      expect(events).toEqual([
        'acquire:1:pi',
        'plan:1',
        'choice',
        'source-consent',
        'close:1:pi',
        'acquire:2:codex',
        'plan:2',
        'execution-approval',
        'apply:2',
        'close:2:codex',
      ])
      expect(invocation.errors.join('')).toContain('Capturing the project again')
      expect(invocation.output.join('')).not.toContain('Exact candidate 1')
      expect(invocation.output.join('')).toContain('Exact candidate 2')
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe('previous exact approval')
    })
  })

  test('declined source consent keeps the source and only approves its original exact configuration', async () => {
    await fixture(async (root) => {
      let acquisitions = 0,
        sourceConsents = 0,
        executionConsents = 0,
        applied = 0
      const host: PrivateCliCommandHost = {
        async acquire(_project, options) {
          acquisitions++
          const value = await readiness(root)
          return {
            rootAdministration: {} as ProjectSession['rootAdministration'],
            async plan() {
              options?.onAgentReadiness?.(value)
              return plan(1)
            },
            async apply() {
              applied++
              expect(await readFile(join(root, grantPath), 'utf8')).toBe(original)
              return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
            },
            async close() {},
          }
        },
      }
      const invocation = outputOptions(root, host, {
        interactive: true,
        answer: async () => '1',
        confirm: async (prompt) => {
          if (prompt.startsWith('Update ')) {
            sourceConsents++
            return false
          }
          executionConsents++
          return true
        },
      })
      expect(await main(['review'], invocation.options)).toBe(0)
      expect([acquisitions, sourceConsents, executionConsents, applied]).toEqual([1, 1, 1, 1])
      expect(await readFile(join(root, grantPath), 'utf8')).toBe(original)
      expect(invocation.output.join('')).toContain('1 targets ready; 1 unavailable')
    })
  })

  test('noninteractive and --yes never mutate source or choose an alternative', async () => {
    for (const args of [['review'], ['review', '--yes', '--allow-authority-changes']]) {
      await fixture(async (root) => {
        let applied = 0,
          acquired = 0
        const host: PrivateCliCommandHost = {
          async acquire(_project, options) {
            acquired++
            const value = await readiness(root)
            return {
              rootAdministration: {} as ProjectSession['rootAdministration'],
              async plan() {
                options?.onAgentReadiness?.(value)
                return plan(1)
              },
              async apply() {
                applied++
                return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
              },
              async close() {},
            }
          },
        }
        const invocation = outputOptions(root, host, {
          interactive: args.length > 1,
          answer: async () => {
            throw new Error('must not select a client')
          },
          confirm: async () => {
            throw new Error('must not prompt')
          },
        })
        expect(await main(args, invocation.options)).toBe(args.length > 1 ? 0 : 2)
        expect(acquired).toBe(1)
        expect(applied).toBe(args.length > 1 ? 1 : 0)
        expect(await readFile(join(root, grantPath), 'utf8')).toBe(original)
      })
    }
  })

  test('zero-ready and unchanged reviews disclose retained unavailability without saying Project ready', async () => {
    for (const unchanged of [false, true]) {
      await fixture(async (root) => {
        let applies = 0
        const host: PrivateCliCommandHost = {
          async acquire(_project, options) {
            const value = await readiness(root, true)
            return {
              rootAdministration: {} as ProjectSession['rootAdministration'],
              async plan() {
                options?.onAgentReadiness?.(value)
                return plan(1, unchanged)
              },
              async apply() {
                applies++
                return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
              },
              async close() {},
            }
          },
        }
        const invocation = outputOptions(root, host, { interactive: false })
        expect(
          await main(['review', '--yes', '--allow-authority-changes'], invocation.options),
        ).toBe(0)
        expect(applies).toBe(unchanged ? 0 : 1)
        expect(invocation.output.join('')).toContain('No targets can run')
        expect(invocation.output.join('')).not.toContain('Project ready')
        expect(invocation.errors.join('')).toContain('Pi is selected')
      })
    }
  })

  test('an unavailable default does not promise a bare run when alternatives are ready', async () => {
    await fixture(async (root) => {
      const invocation = outputOptions(
        root,
        {
          async acquire(_project, options) {
            const value = await readiness(root)
            return {
              rootAdministration: {} as ProjectSession['rootAdministration'],
              async plan() {
                options?.onAgentReadiness?.({
                  ...value,
                  entrypoint: { target: { kind: 'binding', id: 'model' }, state: 'unavailable' },
                })
                return plan(1, true)
              },
              async apply() {
                throw new Error('unchanged review must not apply')
              },
              async close() {},
            }
          },
        },
        { interactive: false },
      )
      expect(await main(['review'], invocation.options)).toBe(0)
      expect(invocation.output.join('')).toContain('default target is unavailable')
      expect(invocation.output.join('')).toContain('$ jig inspect')
      expect(invocation.output.join('')).not.toContain('$ jig run\n')
      expect(invocation.output.join('')).not.toContain('Project ready')
    })
  })

  test('an external edit during source consent survives and receives a fresh exact capture', async () => {
    await fixture(async (root) => {
      const replacement = ' {"kind":"acp","client":"codex","maxTurns":2}\n'
      let round = 0,
        applied = 0
      const host: PrivateCliCommandHost = {
        async acquire(_project, options) {
          const current = ++round
          const value = await readiness(root)
          return {
            rootAdministration: {} as ProjectSession['rootAdministration'],
            async plan() {
              options?.onAgentReadiness?.(value)
              return plan(current)
            },
            async apply() {
              applied++
              expect(current).toBe(2)
              return { operation: 'admission', planDigest: `sha256:${String(current).repeat(64)}` }
            },
            async close() {},
          }
        },
      }
      const invocation = outputOptions(root, host, {
        interactive: true,
        answer: async () => '1',
        confirm: async (prompt) => {
          if (prompt.startsWith('Update ')) await writeFile(join(root, grantPath), replacement)
          return true
        },
      })
      expect(await main(['review'], invocation.options)).toBe(0)
      expect([round, applied]).toEqual([2, 1])
      expect(await readFile(join(root, grantPath), 'utf8')).toBe(replacement)
      expect(invocation.errors.join('')).toContain('no source was overwritten')
    })
  })

  test('a failed first-session close prevents source publication, recapture and approval', async () => {
    await fixture(async (root) => {
      let acquisitions = 0,
        applies = 0
      const host: PrivateCliCommandHost = {
        async acquire(_project, options) {
          acquisitions++
          const value = await readiness(root)
          return {
            rootAdministration: {} as ProjectSession['rootAdministration'],
            async plan() {
              options?.onAgentReadiness?.(value)
              return plan(1)
            },
            async apply() {
              applies++
              return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
            },
            async close() {
              throw new Error('private close fault')
            },
          }
        },
      }
      const invocation = outputOptions(root, host, {
        interactive: true,
        answer: async () => '1',
        confirm: async () => true,
      })
      expect(await main(['review'], invocation.options)).toBe(2)
      expect([acquisitions, applies]).toEqual([1, 0])
      expect(await readFile(join(root, grantPath), 'utf8')).toBe(original)
      expect(invocation.errors.join('')).toContain('JIG_CLEANUP_FAILED')
      expect(invocation.errors.join('')).not.toContain('private close fault')
    })
  })

  test('cancel review and interruption during source consent leave previous source and approval untouched', async () => {
    for (const mode of ['cancel', 'interrupt']) {
      await fixture(async (root) => {
        const controller = new AbortController()
        let acquisitions = 0,
          applies = 0,
          closes = 0
        const host: PrivateCliCommandHost = {
          async acquire(_project, options) {
            acquisitions++
            const value = await readiness(root)
            return {
              rootAdministration: {} as ProjectSession['rootAdministration'],
              async plan() {
                options?.onAgentReadiness?.(value)
                return plan(1)
              },
              async apply() {
                applies++
                return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
              },
              async close() {
                closes++
              },
            }
          },
        }
        const invocation = outputOptions(root, host, {
          interactive: true,
          signal: controller.signal,
          answer: async () => (mode === 'cancel' ? '3' : '1'),
          confirm: async () => {
            controller.abort()
            return true
          },
        })
        expect(await main(['review'], invocation.options)).toBe(mode === 'cancel' ? 1 : 2)
        expect([acquisitions, applies, closes]).toEqual([1, 0, 1])
        expect(await readFile(join(root, grantPath), 'utf8')).toBe(original)
        expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe('previous exact approval')
      })
    }
  })

  test('repeated source changes stop at the bounded correction limit without overwriting external edits', async () => {
    await fixture(async (root) => {
      let round = 0,
        applies = 0,
        changes = 0
      let latest = original
      const host: PrivateCliCommandHost = {
        async acquire(_project, options) {
          const current = ++round
          const value = await readiness(root)
          return {
            rootAdministration: {} as ProjectSession['rootAdministration'],
            async plan() {
              options?.onAgentReadiness?.(value)
              return plan(current)
            },
            async apply() {
              applies++
              return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
            },
            async close() {},
          }
        },
      }
      const invocation = outputOptions(root, host, {
        interactive: true,
        answer: async () => '1',
        confirm: async (prompt) => {
          if (!prompt.startsWith('Update '))
            throw new Error('unstable source must not reach execution approval')
          latest = ' '.repeat(++changes) + original
          await writeFile(join(root, grantPath), latest)
          return true
        },
      })
      expect(await main(['review'], invocation.options)).toBe(2)
      expect(round).toBeLessThanOrEqual(9)
      expect(applies).toBe(0)
      expect(await readFile(join(root, grantPath), 'utf8')).toBe(latest)
      expect(invocation.errors.join('')).toContain('JIG_REVIEW_SETUP_LIMIT')
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe('previous exact approval')
    })
  })
})
