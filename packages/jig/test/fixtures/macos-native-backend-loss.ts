import { readFile, writeFile } from 'node:fs/promises'
import {
  PrivateMacosBackend,
  type PrivateMacosLaunchPlan,
} from '../../src/internal/macos-native-backend.js'

const fixture = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  readonly mode: 'prepared' | 'active'
  readonly identityPath: string
  readonly options: ConstructorParameters<typeof PrivateMacosBackend>[0]
  readonly allocation: Parameters<PrivateMacosBackend['seal']>[1]
  readonly plan: PrivateMacosLaunchPlan
}
const backend = new PrivateMacosBackend(fixture.options)
const sealed = await backend.seal(fixture.plan, fixture.allocation)
await writeFile(fixture.identityPath, JSON.stringify(sealed.identity), { mode: 0o600, flag: 'wx' })
if (fixture.mode === 'prepared') {
  await sealed.admit(undefined, async () => process.exit(76))
} else {
  await sealed.admit()
  process.exit(77)
}
throw new Error('coordinator-loss fixture did not exit')
