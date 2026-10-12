import { readPrivateMacosOwner } from '../../src/internal/macos-owner-state.js'
import { recoverPrivateMacosCoalition } from '../../src/internal/macos-process-controls.js'

const directory = process.argv[2] as string
const owner = readPrivateMacosOwner(directory, 'a'.repeat(64))
const end = performance.now() + 2000
for (;;) {
  try {
    await recoverPrivateMacosCoalition(owner, 3000)
    break
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'macOS recovery guardian is still alive' ||
      performance.now() >= end
    )
      throw error
    await Bun.sleep(10)
  }
}
await recoverPrivateMacosCoalition(readPrivateMacosOwner(directory, 'a'.repeat(64)), 3000)
console.log(JSON.stringify({ empty: true, passed: true }))
