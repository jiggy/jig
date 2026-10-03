import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { privateMacosPeerIdentity } from '../src/internal/macos-process-controls.js'
import { runMacosFixture } from './fixtures/macos-launchd.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'Unix control identity comes from the kernel even when a peer claims another identity',
  async () => {
    const directory = await mkdtemp('/private/tmp/jig-macos-peer-')
    const address = `${directory}/socket`
    const server = createServer()
    let child: ReturnType<typeof spawn> | undefined
    let exited: Promise<void> | undefined
    try {
      const connected = new Promise<ReturnType<typeof privateMacosPeerIdentity>>(
        (resolve, reject) => {
          server.once('connection', (socket) => {
            try {
              const identity = privateMacosPeerIdentity(socket)
              socket.once('data', () => {
                socket.end()
                resolve(identity)
              })
              socket.once('error', reject)
            } catch (error) {
              socket.destroy()
              reject(error)
            }
          })
        },
      )
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, resolve)
      })
      child = spawn(
        process.execPath,
        [
          '--no-env-file',
          '--config=/dev/null',
          '-e',
          `import {connect} from 'node:net';const s=connect(${JSON.stringify(address)});s.on('connect',()=>s.write('{"uid":0,"pid":1}'));s.on('end',()=>process.exit(0));setTimeout(()=>process.exit(1),2000);`,
        ],
        { env: {}, stdio: 'ignore' },
      )
      exited = new Promise<void>((resolve, reject) => {
        child?.once('exit', () => resolve())
        child?.once('error', reject)
      })
      const identity = await Promise.race([
        connected,
        exited.then(() => {
          throw new Error('peer exited before authentication')
        }),
      ])
      expect(identity.uid).toBe(process.getuid?.())
      expect(identity.realUid).toBe(process.getuid?.())
      expect(identity.pid).toBe(child.pid)
      expect(identity.version).toBeGreaterThan(0)
      await exited
      expect(child.exitCode).toBe(0)
    } finally {
      child?.kill('SIGKILL')
      await exited
      server.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  5000,
)
native(
  'exclusive owner accounts and signals its exact coalition without touching an outside child',
  async () => {
    await runMacosFixture(
      fileURLToPath(new URL('./fixtures/macos-process-owner.ts', import.meta.url)),
      [],
      { empty: true, signal: 'SIGKILL', passed: true },
    )
  },
  25_000,
)
