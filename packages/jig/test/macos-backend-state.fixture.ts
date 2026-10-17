import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp('/private/tmp/jig-backend-state-')
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true })
  }
}
async function unsafeRecordFixture(root: string): Promise<string> {
  const module = fileURLToPath(new URL('../src/internal/macos-backend-state.ts', import.meta.url))
  const ownerModule = fileURLToPath(
    new URL('../src/internal/macos-owner-state.ts', import.meta.url),
  )
  const runner = join(root, 'unsafe-record-runner.ts')
  await writeFile(
    runner,
    `import { readFile } from 'node:fs/promises'
import { openPrivateMacosBackendState, releasePrivateMacosOwnerState } from ${JSON.stringify(module)}
import { readPrivateMacosOwner, removePrivateMacosSockets } from ${JSON.stringify(ownerModule)}
const { allocation, proof, operation } = JSON.parse(await readFile(process.argv[2], 'utf8'))
try {
  if (operation === 'open') {
    const state = await openPrivateMacosBackendState(allocation)
    await state.close()
  } else if (operation === 'owner') {
    readPrivateMacosOwner(allocation.directory, allocation.ownerToken)
  } else if (operation === 'sockets') {
    removePrivateMacosSockets(allocation.directory, allocation.ownerToken)
  } else {
    await releasePrivateMacosOwnerState(allocation, proof)
  }
  throw new Error('unsafe record was accepted')
} catch (error) {
  if (!(error instanceof Error) || !['native execution record is unsafe', 'macOS ownership journal is unsafe'].includes(error.message)) throw error
  process.stdout.write('unsafe-record-refused\\n')
}
`,
  )
  return runner
}

export { fixture, unsafeRecordFixture }
