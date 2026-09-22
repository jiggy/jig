// Trusted, finite Node entrypoint. Source travels as data; stdin remains a lease.
import { compileContract, stampSource } from '@jigging/flow-authoring'

const stop = new AbortController()
const timer = setTimeout(() => process.exit(2), 20000)
let input = '',
  started = false
process.stdin.on('end', () => stop.abort())
process.stdin.on('error', () => stop.abort())
process.on('SIGTERM', () => stop.abort())
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  if (started || Buffer.byteLength(input + chunk) > 524288) process.exit(2)
  input += chunk
  if (!input.endsWith('\n')) return
  started = true
  void execute()
})
async function execute() {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 required')
    const { source, channelContracts } = JSON.parse(input) as {
      source: string
      channelContracts?: string[]
    }
    let types = true
    if (source.startsWith('// flow-authoring: ')) {
      const header = JSON.parse(source.split('\n', 1)[0]!.slice(19))
      if (header.profile !== 'flow-authoring-typespec/1' || typeof header.types !== 'boolean')
        throw new Error('Unsupported authoring header')
      types = header.types
    }
    const result = await compileContract(await stampSource(source, { types }), {
      signal: stop.signal,
      ...(channelContracts === undefined ? {} : { channelContracts }),
    })
    process.stdout.write(
      JSON.stringify({ source: result.source, artifacts: result.artifacts }) + '\n',
      () => process.exit(0),
    )
  } catch (error) {
    const diagnostic =
      error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : undefined
    process.stdout.write(
      JSON.stringify({
        error: diagnostic ?? {
          code: 'AUTHORING_FAILED',
          message: 'Check the authoring header and Node 22+ installation.',
        },
      }) + '\n',
      () => process.exit(1),
    )
  } finally {
    // Keep the independent ceiling until the output acknowledgement exits.
    process.stdin.pause()
  }
}
