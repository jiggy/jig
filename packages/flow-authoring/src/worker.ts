import { parentPort, workerData } from 'node:worker_threads'
import { AuthoringError } from './errors.js'
import { compileProgram } from './host.js'
import { lower } from './lower.js'
import { checkText, encode } from './values.js'

try {
  const { source, types, channelContracts } = workerData as {
    source: string
    types: boolean
    channelContracts: string[]
  }
  const result = lower(await compileProgram(source), new Set(channelContracts))
  const artifacts: Record<string, string> = Object.create(null)
  artifacts['FLOW.contract.json'] = encode(result.descriptor)
  for (const [path, schema] of Object.entries(result.projections)) artifacts[path] = encode(schema)
  for (const [path, channel] of Object.entries(result.channels)) artifacts[path] = encode(channel)
  if (types) {
    checkText(result.declarations, 262144)
    artifacts['FLOW.contract.d.ts'] = result.declarations
  }
  checkText(JSON.stringify(artifacts), 1048576)
  parentPort!.postMessage({ artifacts })
} catch (error) {
  parentPort!.postMessage({
    diagnostic:
      error instanceof AuthoringError
        ? error.diagnostic
        : {
            code: 'COMPILER_FAILED',
            message: 'The bounded authoring compiler failed; no artifacts were returned.',
            line: 1,
            column: 1,
          },
  })
}
