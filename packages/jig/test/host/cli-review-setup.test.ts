import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  foundationEnvironment,
  foundationResidue,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

async function fixture(run: (root: string, command: Command) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-native-review-setup-'))
  let passed = false
  let sequence = 0
  const command: Command = async (args) => {
    const child = Bun.spawn([join(installedBunLocation.releaseRoot, 'bin/jig'), ...args], {
      cwd: root,
      env: {
        ...foundationEnvironment(),
        PI_PATH: join(root, 'absent-pi'),
        CODEX_PATH: join(root, 'absent-codex'),
        CLAUDE_PATH: join(root, 'absent-claude'),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return settleTestCommand(child, {
      evidence: join(root, `command-${++sequence}`),
      timeoutMs: 120_000,
    })
  }
  // The residue observer also uses bounded real commands.
  const observe = async (args: string[], cwd: string, timeoutMs = 120_000) => {
    const result = await settleTestCommand(
      Bun.spawn(args, { cwd, env: foundationEnvironment(), stdout: 'pipe', stderr: 'pipe' }),
      { evidence: join(root, `observer-${++sequence}`), timeoutMs },
    )
    expect(result.code, result.stderr).toBe(0)
    return result
  }
  try {
    const before = await foundationResidue(qualification, observe, root)
    await run(root, command)
    expect(await foundationResidue(qualification, observe, root)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Native review setup evidence retained at ${root}`)
  }
}
type Command = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

async function put(root: string, path: string, value: unknown) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
}
async function codeProject(root: string) {
  await put(
    root,
    'jig.ts',
    `import {defineJig, discover} from '@jigging/jig';
export default defineJig({flows: discover('flows'), bindings: discover('bindings')});`,
  )
  await mkdir(join(root, 'bindings'))
  await put(root, 'flows/code/FLOW.meta.json', { name: 'code' })
  await put(root, 'flows/code/FLOW.ts', 'throw new Error("Review must not run package code")')
}
async function addUnavailableAgent(root: string) {
  await cp(
    join(installedBunLocation.releaseRoot, 'libexec/contracts/finite-acp'),
    join(root, 'flows/agent/contracts/finite-acp'),
    { recursive: true },
  )
  await put(root, 'flows/agent/FLOW.meta.json', {
    name: 'agent',
    uses: { native: { contract: './contracts/finite-acp/contract.json' } },
  })
  await put(root, 'flows/agent/FLOW.ts', 'throw new Error("Review must not launch an Agent")')
  await put(
    root,
    'bindings/model.ts',
    `import {defineBinding} from '@jigging/jig';
export default defineBinding({package: 'flows/agent', slots: {native: {kind: 'acp', client: 'pi'}}});`,
  )
}

describe.serial('installed review setup with actual configuration evaluation', () => {
  test('selected ACP refusal preserves actual prior approval for ordinary, details and automated review', async () => {
    await fixture(async (root, command) => {
      await codeProject(root)
      const initial = await command(['review', '--yes', '--allow-authority-changes'])
      expect(initial.code, initial.stderr).toBe(0)
      const lock = await readFile(join(root, 'jig.lock'))
      await addUnavailableAgent(root)
      const source = await readFile(join(root, 'bindings/model.ts'))
      for (const args of [
        ['review'],
        ['review', '--details'],
        ['review', '--yes', '--allow-authority-changes'],
      ]) {
        const result = await command(args)
        expect(result.code, result.stderr).toBe(2)
        expect(result.stderr).toContain('Review could not finish')
        expect(result.stderr).toContain('bindings/model.ts')
        expect(result.stderr).toContain(
          args.includes('--details')
            ? 'Any existing approval remains unchanged'
            : 'Previous approval unchanged',
        )
        expect(result.stdout).not.toContain('Project ready')
        expect(await readFile(join(root, 'jig.lock'))).toEqual(lock)
        expect(await readFile(join(root, 'bindings/model.ts'))).toEqual(source)
      }
      const retry = await command([
        'review',
        '--agent',
        'pi',
        '--allow-resolution-network',
        '--generate-contracts',
        '--verification',
        'strict',
        '--yes',
      ])
      expect(retry.code, retry.stderr).toBe(2)
      expect(retry.stderr).toContain(
        '$ jig review --agent pi --allow-resolution-network --generate-contracts --verification strict',
      )
      expect(retry.stderr).not.toContain('--yes')
      expect(await readFile(join(root, 'jig.lock'))).toEqual(lock)
    })
  }, 600_000)

  test('feature-only unavailable default records real admission and permits unchanged review without claiming readiness', async () => {
    await fixture(async (root, command) => {
      const id = 'https://example.org/contracts/review-setup'
      const contract = {
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        id,
        version: '1.0.0',
        features: { conversation: 'Serial follow-up requests.' },
        input: { type: 'string' },
        result: { type: 'string' },
      }
      await put(
        root,
        'jig.ts',
        `import {defineJig} from '@jigging/jig';
export default defineJig({
  flows: ['flows/consumer', 'flows/provider'],
  defaultProviders: {${JSON.stringify(id)}: 'flow:flows/provider'},
  entrypoint: 'flow:flows/consumer',
});`,
      )
      await put(root, 'flows/provider/FLOW.meta.json', { name: 'provider', supports: [] })
      await put(root, 'flows/provider/FLOW.contract.json', contract)
      await put(root, 'flows/provider/FLOW.ts', 'throw new Error("Review must not run provider")')
      await put(root, 'flows/consumer/FLOW.meta.json', {
        name: 'consumer',
        uses: { review: { contract: './contracts/review.json', requires: ['conversation'] } },
      })
      await put(root, 'flows/consumer/contracts/review.json', contract)
      await put(root, 'flows/consumer/FLOW.ts', 'throw new Error("Review must not run consumer")')
      const source = await readFile(join(root, 'jig.ts'))
      let approvedLock: Buffer | undefined
      for (let review = 0; review < 2; review++) {
        const result = await command(['review', '--yes', '--allow-authority-changes'])
        expect(result.code, result.stderr).toBe(0)
        expect(result.stderr).not.toContain('Review could not finish')
        expect(result.stdout).toContain('Review recorded')
        expect(result.stdout).toContain('$ jig inspect')
        expect(result.stdout).not.toContain('Project ready')
        expect(result.stdout).not.toContain('$ jig run\n')
        expect(await readFile(join(root, 'jig.ts'))).toEqual(source)
        const lock = await readFile(join(root, 'jig.lock'))
        if (review === 0) approvedLock = lock
        else {
          expect(lock).toEqual(approvedLock)
          expect(result.stdout).toBe(
            'Review recorded\n\n  The approved default target is unavailable. Inspect its retained cause, or choose a ready target explicitly.\n  No Flow was started.\n\n  $ jig inspect\n',
          )
        }
      }
      const inspected = await command(['inspect'])
      expect(inspected.code, inspected.stderr).toBe(0)
      expect(inspected.stdout).toContain('unavailable')
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).not.toBe('')
    })
  }, 360_000)
})
