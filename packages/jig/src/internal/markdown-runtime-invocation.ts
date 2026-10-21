import { createHash } from 'node:crypto'
import type { RunContext, RunResult } from '@jigging/flow'
import { runMarkdown } from '../markdown/runtime.js'
import type { CapturedPackage } from '../package/capture.js'
import { inspectCapturedPackage, requireSupportedPackageProfile } from '../package/inspect.js'

/** Execute one captured Markdown package through the ordinary FLOW SDK invocation. */
export async function runCapturedMarkdown(
  captured: CapturedPackage,
  run: RunContext,
): Promise<RunResult> {
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
}
