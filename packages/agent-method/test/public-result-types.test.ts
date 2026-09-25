import { test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('public Agent results compose with FLOW JSON without casts', async () => {
  const method = fileURLToPath(new URL('../', import.meta.url))
  const flow = fileURLToPath(new URL('../../flow-sdk/', import.meta.url))
  const consumer = await mkdtemp(join(tmpdir(), 'agent-public-types-'))
  try {
    await mkdir(join(consumer, 'node_modules/@jigging'), { recursive: true })
    await symlink(method, join(consumer, 'node_modules/@jigging/agent-method'))
    await symlink(flow, join(consumer, 'node_modules/@jigging/flow'))
    await copyFile(
      new URL('./fixtures/public-result-types.ts', import.meta.url),
      join(consumer, 'consumer.ts'),
    )
    execFileSync(
      process.execPath,
      [
        join(method, 'node_modules/typescript/bin/tsc'),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--exactOptionalPropertyTypes',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'consumer.ts',
      ],
      { cwd: consumer, stdio: 'pipe' },
    )
  } finally {
    await rm(consumer, { recursive: true, force: true })
  }
})
