import { readFile } from 'node:fs/promises'
import { openPrivateMacosBackendState } from '../../src/internal/macos-backend-state.js'

const allocation = JSON.parse(await readFile(process.argv[2]!, 'utf8'))
const state = await openPrivateMacosBackendState(allocation)
try {
  if (process.argv[3] === 'admit-hold') await state.admit()
  console.log((await state.read()).phase)
  if (process.argv[3] === 'admit-hold') {
    const timer = setTimeout(() => process.exit(2), 8000)
    for await (const _ of process.stdin) {
    }
    clearTimeout(timer)
  }
} finally {
  await state.close()
}
