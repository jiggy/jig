import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const fixture = fileURLToPath(new URL('./image-preview-process-fixture.ts', import.meta.url))
const bytes = Buffer.from(process.argv[2]!)
const child = spawn(process.execPath, ['--no-env-file', fixture, String(bytes.length)], {
  env: {},
  stdio: ['pipe', 'ignore', 'ignore'],
})
child.stdin.write(bytes)
console.log(child.pid)
await new Promise((resolve) => child.once('close', resolve))
