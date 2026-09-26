import { access, readFile } from 'node:fs/promises'
import { preparePrivateMacosGuardian } from '../../src/internal/macos-guardian-client.js'

const input = JSON.parse(await readFile(process.argv[2] as string, 'utf8'))
const owner = await preparePrivateMacosGuardian(input)
owner.stdout.resume()
owner.stderr.resume()
await owner.admit()
owner.continue()
const marker = input.configuration.command[2]
const end = performance.now() + 5000
while (
  !(await access(marker).then(
    () => true,
    () => false,
  )) &&
  performance.now() < end
)
  await Bun.sleep(10)
await access(marker)
if (input.fixturePhase === 'collecting') {
  const result = await owner.fenced
  if (result.outputFd === undefined) throw new Error('fixture collector was not handed off')
}
console.log('coordinator-exiting')
process.exit(0)
