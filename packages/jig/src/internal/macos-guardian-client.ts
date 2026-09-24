import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rmdir, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { privateMacosBefore, privateMacosControlChannel } from './macos-control-channel.js'
import type { PrivateMacosGuardianStart } from './macos-native-supervisor.js'
import {
  readPrivateMacosOwner,
  recordPrivateMacosSockets,
  removePrivateMacosSockets,
  requirePrivateMacosOwnerDirectory,
} from './macos-owner-state.js'
import {
  privateMacosCurrentProcessIdentity,
  privateMacosPeerIdentity,
  recoverPrivateMacosCoalition,
} from './macos-process-controls.js'
import { privateMacosSandboxProfile } from './macos-sandbox-profile.js'
import {
  normalizePrivateMacosScopeResult,
  type PrivateMacosScopeResult,
} from './macos-scope-execution.js'

const xml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const launchctl = (...args: string[]) =>
  spawnSync('/bin/launchctl', args, { env: {}, encoding: 'utf8', timeout: 5000 })
const jobLabel = (token: string) =>
  `org.jig.native.${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
function removeJob(target: string): void {
  launchctl('bootout', target)
  if (launchctl('print', target).status !== 113)
    throw new Error('macOS guardian job removal is unconfirmed')
}

export async function recoverPrivateMacosGuardian(
  ownerDirectory: string,
  ownerToken: string,
  cleanupTimeoutMs: number,
): Promise<void> {
  const owner = readPrivateMacosOwner(ownerDirectory, ownerToken)
  const end = performance.now() + 16_000
  for (;;) {
    try {
      await recoverPrivateMacosCoalition(owner, cleanupTimeoutMs)
      break
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'macOS recovery guardian is still alive' ||
        performance.now() >= end
      )
        throw error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  removeJob(`user/${process.getuid?.()}/${jobLabel(ownerToken)}`)
  removePrivateMacosSockets(ownerDirectory, ownerToken)
}
export interface PrivateMacosGuardianResult {
  readonly result: PrivateMacosScopeResult | null
  readonly outputLost: boolean
  readonly recovered: boolean
  readonly fenced: true
}
export interface PrivateMacosGuardian {
  readonly identity: ReturnType<typeof readPrivateMacosOwner>['identity']
  readonly stdin: Socket
  readonly stdout: Socket
  readonly stderr: Socket
  readonly completion: Promise<PrivateMacosGuardianResult>
  admit(): Promise<Readonly<{ pid: number; version: number }>>
  continue(): void
  cancel(): void
}

/** Finite user-domain job. Installed-support sealing and admission remain caller responsibilities. */
export async function preparePrivateMacosGuardian(input: {
  readonly bun: string
  readonly supervisor: string
  readonly configuration: PrivateMacosGuardianStart
}): Promise<PrivateMacosGuardian> {
  const coordinator = privateMacosCurrentProcessIdentity()
  const configuration = structuredClone(input.configuration)
  requirePrivateMacosOwnerDirectory(configuration.ownerDirectory)
  if (
    !/^[0-9a-f]{64}$/.test(configuration.ownerToken) ||
    !input.bun.startsWith('/') ||
    !input.supervisor.startsWith('/') ||
    JSON.stringify(configuration).length > 65500
  )
    throw new Error('invalid macOS guardian launch')
  const directory = await mkdtemp('/private/tmp/jig-native-')
  const path = join(directory, 'c')
  const label = jobLabel(configuration.ownerToken)
  const domain = `user/${coordinator.uid}`
  const target = `${domain}/${label}`
  const servers: Server[] = []
  const sockets: Socket[] = []
  let guardian: ReturnType<typeof privateMacosPeerIdentity> | undefined
  let registered = false
  let socketsRecorded = false
  let control: Socket | undefined
  let finished = false
  let phase: 'prepared' | 'admitted' | 'ready' | 'running' | 'terminal' = 'prepared'
  const currentPhase = (): string => phase
  const endpoint = async (suffix: string): Promise<{ accepted: Promise<Socket> }> => {
    const server = createServer()
    servers.push(server)
    let accepted = false
    let attempts = 0
    const connected = new Promise<Socket>((resolve, reject) => {
      server.on('error', reject)
      server.on('connection', (socket) => {
        socket.on('error', () => undefined)
        try {
          const peer = privateMacosPeerIdentity(socket)
          if (
            accepted ||
            ++attempts > 16 ||
            peer.uid !== coordinator.uid ||
            peer.realUid !== coordinator.uid ||
            (suffix !== '' &&
              (guardian === undefined ||
                peer.pid !== guardian.pid ||
                peer.version !== guardian.version))
          )
            throw new Error('macOS guardian connection identity does not match')
          if (suffix === '') guardian = peer
          accepted = true
          sockets.push(socket)
          resolve(socket)
        } catch {
          socket.destroy()
          if (attempts > 16) reject(new Error('macOS guardian connection limit exceeded'))
        }
      })
    })
    void connected.catch(() => undefined)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(`${path}${suffix}`, resolve)
    })
    return { accepted: connected }
  }
  const cleanup = async () => {
    if (finished) return
    if (registered) {
      removeJob(target)
    }
    for (const server of servers) server.close()
    if (socketsRecorded)
      removePrivateMacosSockets(configuration.ownerDirectory, configuration.ownerToken)
    else await rmdir(directory)
    finished = true
  }
  const recover = async (): Promise<PrivateMacosGuardianResult> => {
    control?.destroy()
    for (const socket of sockets) socket.destroy()
    for (const server of servers) server.close()
    await recoverPrivateMacosGuardian(
      configuration.ownerDirectory,
      configuration.ownerToken,
      configuration.limits.cleanupTimeoutMs,
    )
    finished = true
    return Object.freeze({ result: null, outputLost: true, recovered: true, fenced: true })
  }
  try {
    privateMacosSandboxProfile({
      ...configuration.files,
      protectedRoots: [
        ...configuration.files.protectedRoots,
        configuration.ownerDirectory,
        directory,
      ],
    })
    recordPrivateMacosSockets(configuration.ownerDirectory, configuration.ownerToken, directory)
    socketsRecorded = true
    const controlEndpoint = await endpoint('')
    const stdinEndpoint = await endpoint('.in')
    const stdoutEndpoint = await endpoint('.out')
    const stderrEndpoint = await endpoint('.err')
    const argv = [
      '/usr/bin/env',
      '-i',
      input.bun,
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      input.supervisor,
      '--guardian',
      path,
      String(coordinator.pid),
      String(coordinator.version),
    ]
    const plist = join(configuration.ownerDirectory, 'guardian.plist')
    await writeFile(
      plist,
      `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${argv.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array><key>WorkingDirectory</key><string>/</string><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>LimitLoadToSessionType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>`,
      { mode: 0o600, flag: 'wx' },
    )
    const started = launchctl('bootstrap', domain, plist)
    registered = started.status === 0 || launchctl('print', target).status === 0
    if (started.status !== 0) throw new Error('macOS guardian bootstrap failed')
    control = await privateMacosBefore(controlEndpoint.accepted, 12_000)
    const channel = privateMacosControlChannel(control)
    channel.send(configuration)
    const [stdin, stdout, stderr] = await privateMacosBefore(
      Promise.all([stdinEndpoint.accepted, stdoutEndpoint.accepted, stderrEndpoint.accepted]),
      12_000,
    )
    const prepared = (await privateMacosBefore(channel.receive(), 12_000)) as {
      type?: unknown
      identity?: unknown
    }
    const record = readPrivateMacosOwner(configuration.ownerDirectory, configuration.ownerToken)
    if (
      prepared?.type !== 'prepared' ||
      Object.keys(prepared).sort().join() !== 'identity,type' ||
      JSON.stringify(prepared.identity) !== JSON.stringify(record.identity) ||
      record.identity.guardianPid !== guardian?.pid ||
      record.identity.guardianVersion !== guardian.version
    )
      throw new Error('macOS prepared ownership does not match')
    let resolveReady: (identity: { pid: number; version: number }) => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const ready = new Promise<{ pid: number; version: number }>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void ready.catch(() => undefined)
    const completion = (async (): Promise<PrivateMacosGuardianResult> => {
      try {
        for (;;) {
          const message = (await channel.receive()) as Record<string, unknown>
          if (
            message?.type === 'ready' &&
            currentPhase() === 'admitted' &&
            Object.keys(message).sort().join() === 'pid,type,version' &&
            Number.isSafeInteger(message.pid) &&
            (message.pid as number) > 1 &&
            Number.isSafeInteger(message.version) &&
            (message.version as number) >= 0
          ) {
            phase = 'ready'
            resolveReady({ pid: message.pid as number, version: message.version as number })
          } else if (
            message?.type === 'terminal' &&
            Object.keys(message).sort().join() === 'outputLost,result,type' &&
            typeof message.outputLost === 'boolean' &&
            (message.result === null ||
              (typeof message.result === 'object' &&
                (message.result as { fenced?: unknown }).fenced === true))
          ) {
            phase = 'terminal'
            rejectReady(new Error('macOS guardian ended before readiness'))
            await cleanup()
            control?.destroy()
            stdin.destroy()
            return Object.freeze({
              result:
                message.result === null ? null : normalizePrivateMacosScopeResult(message.result),
              outputLost: message.outputLost,
              recovered: false,
              fenced: true,
            })
          } else throw new Error('invalid macOS guardian response')
        }
      } catch {
        phase = 'terminal'
        rejectReady(new Error('macOS guardian connection lost'))
        return await recover()
      }
    })()
    void completion.catch(() => undefined)
    return Object.freeze({
      identity: record.identity,
      stdin,
      stdout,
      stderr,
      completion,
      admit() {
        if (phase !== 'prepared') throw new Error('macOS guardian is not prepared')
        phase = 'admitted'
        channel.send({ type: 'admit' })
        return ready
      },
      continue() {
        if (phase !== 'ready') throw new Error('macOS guardian is not ready')
        phase = 'running'
        channel.send({ type: 'continue' })
      },
      cancel() {
        if (phase !== 'terminal') channel.send({ type: 'cancel' })
      },
    })
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    // This function has not exposed admission yet: no payload can have started.
    await cleanup()
    throw error
  }
}
