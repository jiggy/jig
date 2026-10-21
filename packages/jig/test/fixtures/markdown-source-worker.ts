import { basename, dirname, resolve } from 'node:path'
import { handle } from '@jigging/flow'
import { runCapturedMarkdown } from '../../src/internal/markdown-runtime-invocation.js'
import { capturePackageDirectory } from '../../src/package/capture.js'

// Real host capture and FLOW/0 exchange for the shared Markdown invocation.
// The installed worker separately qualifies contained package acquisition.
await handle(async (run) => {
  if (process.argv.length !== 3 || basename(process.argv[2]!) !== 'FLOW.md')
    throw new TypeError('the Markdown runtime requires one FLOW.md entrypoint')
  const captured = await capturePackageDirectory(dirname(resolve(process.argv[2]!)))
  try {
    return await runCapturedMarkdown(captured, run)
  } finally {
    await captured.dispose()
  }
})
