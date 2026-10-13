import { readFile } from 'node:fs/promises'
import { writePrivateDeliveryFile } from '../../src/internal/file-delivery-storage.js'
import { preparePrivateMacosGuardian } from '../../src/internal/macos-guardian-client.js'
import type { PrivateMacosGuardianStart } from '../../src/internal/macos-native-supervisor.js'

const fixture = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  readonly phase: 'roots-transfer' | 'active-stage' | 'committed-stage'
  readonly marker: string
  readonly input: {
    readonly bun: string
    readonly supervisor: string
    readonly configuration: PrivateMacosGuardianStart
  }
}
const guardian = await preparePrivateMacosGuardian(fixture.input)
void guardian.completion.catch(() => undefined)
guardian.stderr.resume()
let output = ''
guardian.stdout.on('data', (bytes: Buffer) => {
  output += bytes.toString()
})
const admission = guardian.admit()
void admission.catch(() => undefined)
if (fixture.phase === 'roots-transfer') {
  const end = performance.now() + 20_000
  while ((await readFile(fixture.marker, 'utf8').catch(() => undefined)) !== 'held') {
    if (performance.now() >= end) throw new Error('import roots were not held')
    await Bun.sleep(5)
  }
} else {
  await admission
  guardian.continue()
  const end = performance.now() + 5000
  while (!output.includes('ready')) {
    if (performance.now() >= end) throw new Error('import caller was not ready')
    await Bun.sleep(5)
  }
  const signal = new AbortController().signal
  const stage = await guardian.outputImport!.stage({
    directory: 'copies',
    operationId: 'loss',
    deadlineUnixMs: fixture.input.configuration.limits.deadlineUnixMs,
    signal,
  })
  await writePrivateDeliveryFile(stage.directory, 'copy.txt', Buffer.from('copy'), () => {})
  if (fixture.phase === 'committed-stage' && (await stage.commit()) !== 'committed')
    throw new Error('import did not commit before coordinator loss')
}
console.log(fixture.phase)
// The parent kills this exact coordinator. The ordinary guardian retains cleanup.
await Bun.sleep(120_000)
throw new Error('coordinator-loss fixture was not killed')
