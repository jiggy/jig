import { basename, dirname, resolve } from 'node:path'
import { handle } from '@jigging/flow'
import { capturePrivateContainedPackageDirectory } from '../package/capture.js'
import { runCapturedMarkdown } from './markdown-runtime-invocation.js'

// This entry runs inside the same contained FLOW/0 process as a code runner.
// The sole argument names its immutable package; provider credentials, host
// paths and session-changing tools are absent from this process.
await handle(async (run) => {
  if (process.argv.length !== 3 || basename(process.argv[2]!) !== 'FLOW.md')
    throw new TypeError('the Markdown runtime requires one FLOW.md entrypoint')
  const captured = await capturePrivateContainedPackageDirectory(dirname(resolve(process.argv[2]!)))
  try {
    return await runCapturedMarkdown(captured, run)
  } finally {
    await captured.dispose()
  }
})
