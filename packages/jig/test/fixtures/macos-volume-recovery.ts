import {
  createPrivateMacosVolume,
  recoverPrivateMacosVolume,
} from '../../src/internal/macos-volume.js'

// Protected test-only IPC; credentials are never command arguments.
let text = ''
for await (const chunk of process.stdin) {
  text += chunk.toString()
  if (text.length > 4096) process.exit(2)
}
const { mode, control, token, mount } = JSON.parse(text)
if (mode === 'create') {
  await createPrivateMacosVolume(control, token, mount, 16 * 1024 * 1024)
  // Abrupt coordinator exit discards the returned live directory descriptor.
  process.exit(76)
}
if (mode !== 'recover') process.exit(2)
await recoverPrivateMacosVolume(control, token)
process.stdout.write('recovered\n')
