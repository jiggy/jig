import { test } from 'bun:test'
import { qualifyInstalledSoftwareFactory } from '../fixtures/installed-software-factory.js'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

test(
  'installed software factory retains blocked admitted bytes after editable repair removal',
  () => qualifyInstalledSoftwareFactory('blocked'),
  600_000,
)
