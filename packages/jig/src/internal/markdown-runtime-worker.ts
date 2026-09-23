import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { handle } from '@jigging/flow'
import { runMarkdown } from '../markdown/runtime.js'
import { capturePackageDirectory } from '../package/capture.js'
import { inspectCapturedPackage, requireSupportedPackageProfile } from '../package/inspect.js'

// This entry runs inside the same contained FLOW/0 process as a code runner.
// The sole argument names its immutable package; provider credentials, host
// paths and session-changing tools are absent from this process.
await handle(async (run) => {
  if (process.argv.length !== 3 || basename(process.argv[2]!) !== 'FLOW.md')
    throw new TypeError('the Markdown runtime requires one FLOW.md entrypoint')
  const captured = await capturePackageDirectory(dirname(resolve(process.argv[2]!)))
  try {
    const inspected = await inspectCapturedPackage(captured)
    requireSupportedPackageProfile(inspected)
    if (inspected.entrypoint.path !== 'FLOW.md' || inspected.markdown === undefined)
      throw new TypeError('the captured package has no Markdown invocation')
    const manifest = []
    for (const file of captured.files) {
      run.signal.throwIfAborted()
      const hash = createHash('sha256')
      for await (const bytes of captured.stream(file.path, file.size)) hash.update(bytes)
      manifest.push(Object.freeze({ ...file, digest: `sha256:${hash.digest('hex')}` }))
    }
    return await runMarkdown(inspected.markdown, run, {
      manifest: Object.freeze(manifest),
      read: (path, maximumBytes) => captured.read(path, maximumBytes),
    })
  } finally {
    await captured.dispose()
  }
})
