import { expect } from 'bun:test'
import { access, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
function killGuardian(identity: { guardianPid: number; guardianVersion: number }) {
  const ffi = createRequire(import.meta.url)('bun:ffi')
  const api = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
  })
  try {
    const token = Buffer.alloc(32)
    token.writeUInt32LE(identity.guardianPid, 20)
    token.writeUInt32LE(identity.guardianVersion, 28)
    expect(api.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
  } finally {
    api.close()
  }
}
const preparationFailures = [
  [
    'storage',
    '      const storage = await preparePrivateMacosGuardianStorage(',
    "new Error('macOS volume create failed', { cause: new Error('private-canary') })",
    'MACOS_GUARDIAN_STORAGE_VOLUME_CREATE',
    30_000,
  ],
  [
    'scope',
    '    execution = await preparePrivateMacosScope({',
    "new Error('private-canary /private/owner/path')",
    'MACOS_GUARDIAN_SCOPE_PREPARATION_OTHER',
    30_000,
  ],
  [
    'storage-deadline',
    '      const storage = await preparePrivateMacosGuardianStorage(',
    "(await new Promise<void>((resolve) => { if (cancellation.signal.aborted) resolve(); else cancellation.signal.addEventListener('abort', () => resolve(), { once: true }) }), new Error('macOS volume create failed', { cause: new Error('private-canary') }))",
    'EXECUTION_PREPARATION_DEADLINE',
    1500,
  ],
  [
    'storage-cancelled',
    '      const storage = await preparePrivateMacosGuardianStorage(',
    "(await new Promise<void>((resolve) => { if (cancellation.signal.aborted) resolve(); else cancellation.signal.addEventListener('abort', () => resolve(), { once: true }) }), new Error('macOS volume create failed', { cause: new Error('private-canary') }))",
    'MACOS_GUARDIAN_STORAGE_VOLUME_CREATE',
    30_000,
  ],
] as const
async function preJournalAllocationModule(root: string): Promise<string> {
  const directory = fileURLToPath(new URL('../src/internal/', import.meta.url))
  const source = await readFile(join(directory, 'macos-guardian-storage.ts'), 'utf8')
  const boundary =
    '  await allocatePrivateMacosVolume(controlPath(owner), token, storage.mountPath, storage.bytes)'
  expect(source.split(boundary)).toHaveLength(2)
  const module = join(root, 'pre-journal-storage.ts')
  await writeFile(
    module,
    source.replaceAll("from './", `from '${directory}`).replace(
      boundary,
      `  await (await import('node:fs/promises')).writeFile(${JSON.stringify(join(root, 'pre-journal.paused'))}, '', { mode: 0o600, flag: 'wx' })
  await new Promise<void>(() => setInterval(() => {}, 60_000))
${boundary}`,
    ),
    { mode: 0o600, flag: 'wx' },
  )
  return module
}

async function journalLossSupervisor(root: string): Promise<string> {
  const directory = fileURLToPath(new URL('../src/internal/', import.meta.url))
  const volume = join(root, 'volume.ts'),
    storage = join(root, 'storage.ts')
  const supervisor = join(root, 'supervisor.ts')
  const volumeSource = await readFile(join(directory, 'macos-volume.ts'), 'utf8')
  const write = '    await file.writeFile(`${JSON.stringify({ value, mac })}\\n`)'
  expect(volumeSource.split(write)).toHaveLength(2)
  await writeFile(
    volume,
    volumeSource
      .replace(
        write,
        `    if (signatureName === 'volume-image.json') await new Promise<void>(() => {})\n${write}`,
      )
      .replaceAll("from './", `from '${directory}`),
  )
  const storageSource = await readFile(join(directory, 'macos-guardian-storage.ts'), 'utf8')
  expect(storageSource.split("from './macos-volume.js'")).toHaveLength(2)
  await writeFile(
    storage,
    storageSource
      .replace("from './macos-volume.js'", `from '${volume}'`)
      .replaceAll("from './", `from '${directory}`),
  )
  const supervisorSource = await readFile(join(directory, 'macos-native-supervisor.ts'), 'utf8')
  expect(supervisorSource.split("from './macos-guardian-storage.js'")).toHaveLength(2)
  await writeFile(
    supervisor,
    supervisorSource
      .replace("from './macos-guardian-storage.js'", `from '${storage}'`)
      .replaceAll("from './", `from '${directory}`),
  )
  return supervisor
}
async function preparationFailureSupervisor(
  root: string,
  [step, marker, failure]: (typeof preparationFailures)[number],
): Promise<string> {
  const sourceUrl = new URL('../src/internal/macos-native-supervisor.ts', import.meta.url)
  const source = await readFile(sourceUrl, 'utf8')
  expect(source.split(marker)).toHaveLength(2)
  const supervisor = join(root, `failure-${step}.ts`)
  const paused = step.startsWith('storage-')
    ? `await (await import('node:fs/promises')).writeFile(${JSON.stringify(join(root, `${step}.paused`))}, 'paused', { mode: 0o600, flag: 'wx' });\n`
    : ''
  await writeFile(
    supervisor,
    source
      .replace(marker, `${paused}throw ${failure}\n${marker}`)
      .replaceAll("from './", `from '${fileURLToPath(new URL('.', sourceUrl))}`),
  )
  return supervisor
}

export {
  exists,
  journalLossSupervisor,
  killGuardian,
  preJournalAllocationModule,
  preparationFailureSupervisor,
  preparationFailures,
}
