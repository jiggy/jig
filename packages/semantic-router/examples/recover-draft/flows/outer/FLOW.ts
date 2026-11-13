import { handle, type Artifact, type JsonValue } from '@jigging/flow'

await handle(async (run) => {
  const { cases } = run.input as { cases: { label: string; mode: string }[] }
  if (!Array.isArray(cases) || cases.length > 10) throw Error('Supply at most ten draft cases.')
  const results: JsonValue[] = []
  const artifacts: Record<string, Artifact> = {}
  for (let index = 0; index < cases.length; index++) {
    const request = cases[index]!
    const result = await run.call({ operationId: `recover:${index}`, slot: 'recovery', input: request })
    results.push({ outcome: result.outcome, output: result.output })
    if (result.outcome === 'done' && result.artifacts?.report) {
      if (request.label === 'first' || request.label === 'second') artifacts[request.label] = result.artifacts.report
      else await run.release({ operationId: `release:${index}`, artifact: result.artifacts.report })
    }
  }
  return { outcome: 'done', output: { results }, artifactResults: artifacts }
})
