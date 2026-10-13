// One fresh test-owned HTTPS peer, run only by the independently qualified Node.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { join } from 'node:path'

if (
  process.release.name !== 'node' ||
  process.versions.bun !== undefined ||
  Number(process.versions.node.split('.')[0]) < 22
)
  throw Error('Real Node 22+ TLS peer required')
const root = process.argv[2]
if (process.argv.length !== 3 || !root?.startsWith('/'))
  throw Error('TLS peer fixture path required')
const configuration = JSON.parse(readFileSync(join(root, 'tls-peer-config.json'), 'utf8'))
if (
  Object.keys(configuration).sort().join() !== 'cert,key' ||
  typeof configuration.cert !== 'string' ||
  typeof configuration.key !== 'string'
)
  throw Error('Invalid test certificate input')
let connections = 0,
  requests = 0,
  stopping = false
const sockets = new Set()
const server = createServer(configuration, (_request, response) => {
  requests++
  response.end('must not arrive')
})
server.on('connection', (socket) => {
  if (stopping) {
    socket.destroy()
    return
  }
  connections++
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
})
server.on('tlsClientError', () => {})
function stop() {
  if (stopping) return
  stopping = true
  process.stdin.destroy()
  server.close((error) => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
      process.stderr.write('TLS peer closure failed\n')
      process.exitCode = 1
      return
    }
    process.stdout.write(JSON.stringify({ connections, requests }) + '\n')
  })
  for (const socket of sockets) socket.destroy()
}
server.once('error', () => {
  process.stderr.write('TLS peer failed\n')
  process.exitCode = 1
  stop()
})
process.stdin.once('end', stop)
process.stdin.resume()
process.once('SIGINT', stop)
server.listen(0, () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('TLS peer endpoint unavailable')
  const pending = join(root, 'tls-peer.ready.pending')
  writeFileSync(pending, JSON.stringify({ port: address.port }) + '\n', { flag: 'wx', mode: 0o600 })
  renameSync(pending, join(root, 'tls-peer.ready.json'))
})
