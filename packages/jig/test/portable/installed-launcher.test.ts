import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { settleTestCommand } from '../fixtures/bounded-command.js'

test('built public launcher uses fixed system tools and owned Bun despite hostile ambient configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-real-launcher-'))
  let passed = false
  try {
    const packageRoot = resolve(import.meta.dir, '../..')
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    for (const [index, args] of [['--version'], ['--help']].entries()) {
      const child = Bun.spawn([join(packageRoot, 'bin/jig'), ...args], {
        env: { PATH: '/nonexistent', BUN_OPTIONS: 'invalid', NODE_OPTIONS: 'invalid', NO_COLOR: '1' },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      })
      const result = await settleTestCommand(child, {
        evidence: join(root, String(index)), timeoutMs: 15_000,
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      if (index === 0) expect(result.stdout).toBe(`${manifest.version}\n`)
      else expect(result.stdout).toContain('Jig runs reusable methods')
    }
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Real launcher evidence retained at ${root}`)
  }
})
