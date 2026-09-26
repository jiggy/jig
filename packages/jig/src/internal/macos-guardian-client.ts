import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rmdir, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type PrivateCapturedInput, requirePrivateCapturedInput } from './input-capture.js'
import { privateMacosBefore, privateMacosControlChannel } from './macos-control-channel.js'
import {
  createPrivateMacosDescriptorReceiver,
  type PrivateMacosReceivedDescriptors,
  sendPrivateMacosDescriptors,
} from './macos-descriptor-handoff.js'
import {
  allocatePrivateMacosGuardianStorage,
  releasePrivateMacosGuardianStorage,
  requirePrivateMacosGuardianStorage,
} from './macos-guardian-storage.js'
import { normalizePrivateMacosInputs } from './macos-input-projection.js'
import type {
  PrivateMacosGuardianConfiguration,
  PrivateMacosGuardianStart,
} from './macos-native-supervisor.js'
import {
  privateMacosStorageRecoveryToken,
  readPrivateMacosOwner,
  recordPrivateMacosSockets,
  releasePrivateMacosGuardianRecords,
  removePrivateMacosSockets,
  requirePrivateMacosOwnerDirectory,
  resetPrivateMacosRecoveryState,
} from './macos-owner-state.js'
import {
  privateMacosCurrentProcessIdentity,
  privateMacosOwnerIsFromPriorBoot,
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
  runtime: Readonly<{ bun: string; supervisor: string }> = {
    bun: process.execPath,
    supervisor: fileURLToPath(
      new URL(
        import.meta.url.endsWith('.ts')
          ? './macos-native-supervisor.ts'
          : './macos-native-supervisor.js',
        import.meta.url,
      ),
    ),
  },
): Promise<void> {
  if (await present(join(ownerDirectory, 'owner.json')))
    await fenceDeadGuardian(ownerDirectory, ownerToken, cleanupTimeoutMs)
  else {
    // Without the first owner journal the admission gate was never opened. Stop
    // the exact job before it can become a late guardian, then retire its sockets.
    removeJob(`user/${process.getuid?.()}/${jobLabel(ownerToken)}`)
    if (await present(join(ownerDirectory, 'sockets.json')))
      removePrivateMacosSockets(ownerDirectory, ownerToken)
  }
  await recoverStorageWithGuardian(ownerDirectory, ownerToken, runtime)
}

/** Retire authenticated guardian and volume journals only after an authentic
 * guardian completion or successful recovery has proved fencing and cleanup. */
export async function releasePrivateMacosGuardian(
  ownerDirectory: string,
  ownerToken: string,
): Promise<void> {
  const uid = process.getuid?.()
  if (launchctl('print', `user/${uid}/${jobLabel(ownerToken)}`).status !== 113)
    throw new Error('macOS guardian job is still present')
  await releasePrivateMacosGuardianStorage(ownerDirectory, ownerToken)
  const recovery = join(ownerDirectory, 'recovery')
  if (await present(recovery)) {
    const recoveryToken = privateMacosStorageRecoveryToken(ownerToken)
    if (launchctl('print', `user/${uid}/${jobLabel(recoveryToken)}`).status !== 113)
      throw new Error('macOS storage recovery guardian job is still present')
    releasePrivateMacosGuardianRecords(recovery, recoveryToken)
  }
  releasePrivateMacosGuardianRecords(ownerDirectory, ownerToken)
}

async function fenceDeadGuardian(
  ownerDirectory: string,
  ownerToken: string,
  cleanupTimeoutMs: number,
): Promise<void> {
  const owner = readPrivateMacosOwner(ownerDirectory, ownerToken)
  if (privateMacosOwnerIsFromPriorBoot(owner)) {
    // The kernel reboot fenced every former task. Only authenticated exact
    // job/socket records are retired here; storage uses fresh live mappings.
    removeJob(`user/${process.getuid?.()}/${jobLabel(ownerToken)}`)
    removePrivateMacosSockets(ownerDirectory, ownerToken)
    return
  }
  // A live guardian may be finishing bounded image-tool cleanup after fencing.
  const end = performance.now() + 90_000
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

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** A fixed, restartable cleanup slot owns image tools independently of this caller. */
async function recoverStorageWithGuardian(
  targetDirectory: string,
  targetToken: string,
  runtime: Readonly<{ bun: string; supervisor: string }>,
): Promise<void> {
  if (!(await present(join(targetDirectory, 'storage')))) return
  requirePrivateMacosOwnerDirectory(targetDirectory)
  const ownerDirectory = join(targetDirectory, 'recovery')
  const ownerToken = privateMacosStorageRecoveryToken(targetToken)
  await mkdir(ownerDirectory, { mode: 0o700 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  requirePrivateMacosOwnerDirectory(ownerDirectory)
  if (await present(join(ownerDirectory, 'owner.json')))
    await fenceDeadGuardian(ownerDirectory, ownerToken, 5000)
  else {
    // A job without its first journal cannot yet have created a child. Remove
    // it before replacing setup records so it can never become a late owner.
    removeJob(`user/${process.getuid?.()}/${jobLabel(ownerToken)}`)
    if (await present(join(ownerDirectory, 'sockets.json')))
      removePrivateMacosSockets(ownerDirectory, ownerToken)
  }
  resetPrivateMacosRecoveryState(ownerDirectory)
  const recovery = await prepareGuardian({
    bun: runtime.bun,
    supervisor: runtime.supervisor,
    configuration: {
      type: 'recover-storage',
      ownerDirectory,
      ownerToken,
      targetDirectory,
      targetToken,
      deadlineUnixMs: Date.now() + 30_000,
    },
  })
  recovery.stdout.resume()
  recovery.stderr.resume()
  void recovery.admit().catch(() => undefined) // Recovery has no payload readiness gate.
  const result = await recovery.completion
  if (result.recovered || result.outputLost || result.result !== null)
    throw new Error('macOS storage recovery is unconfirmed')
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
  /** Fencing precedes collection; completion also proves storage cleanup. */
  readonly fenced: Promise<PrivateMacosGuardianResult & { readonly outputFd?: number }>
  /** Close the borrowed collector after reading and before awaiting completion. */
  release(): void
  admit(): Promise<Readonly<{ pid: number; version: number }>>
  continue(): void
  cancel(): void
}
export interface PrivateMacosGuardianCapturedInput {
  readonly path: string
  readonly input: PrivateCapturedInput
}

/** Finite user-domain job. Installed-support sealing and admission remain caller responsibilities. */
export async function preparePrivateMacosGuardian(input: {
  readonly bun: string
  readonly supervisor: string
  readonly configuration: PrivateMacosGuardianStart
  readonly capturedInputs?: readonly PrivateMacosGuardianCapturedInput[]
}): Promise<PrivateMacosGuardian> {
  return prepareGuardian(input)
}

async function prepareGuardian(input: {
  readonly bun: string
  readonly supervisor: string
  readonly configuration: PrivateMacosGuardianConfiguration
  readonly capturedInputs?: readonly PrivateMacosGuardianCapturedInput[]
}): Promise<PrivateMacosGuardian> {
  const coordinator = privateMacosCurrentProcessIdentity()
  const configuration = structuredClone(input.configuration)
  const captures = (input.capturedInputs ?? []).map((file) =>
    Object.freeze({ path: file.path, input: file.input }),
  )
  const identities = normalizePrivateMacosInputs(
    configuration.type === 'start' ? (configuration.inputs ?? []) : [],
  )
  const descriptors = () => {
    const held = captures.map((file) => ({
      path: file.path,
      ...requirePrivateCapturedInput(file.input),
    }))
    const observed = normalizePrivateMacosInputs(
      held.map(({ path, bytes, digest }) => ({ path, bytes, digest })),
    )
    if (JSON.stringify(observed) !== JSON.stringify(identities))
      throw new Error('macOS input captures do not match the admitted manifest')
    return held.map((file) => file.fd)
  }
  descriptors()
  const storage = configuration.type === 'start' ? configuration.storage : undefined
  const cleanupTimeoutMs =
    configuration.type === 'start' ? configuration.limits.cleanupTimeoutMs : 5000
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
  let descriptorReceiver:
    | Awaited<ReturnType<typeof createPrivateMacosDescriptorReceiver>>
    | undefined
  let received: PrivateMacosReceivedDescriptors | undefined
  let collectionTimer: ReturnType<typeof setTimeout> | undefined
  let collectionLost = false
  let storageAllocated = false
  const transferCancellation = new AbortController()
  let finished = false
  let phase: 'prepared' | 'admitted' | 'ready' | 'running' | 'collecting' | 'terminal' = 'prepared'
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
    await descriptorReceiver?.close()
    if (socketsRecorded)
      removePrivateMacosSockets(configuration.ownerDirectory, configuration.ownerToken)
    else await rmdir(directory)
    finished = true
  }
  const recover = async (): Promise<PrivateMacosGuardianResult> => {
    transferCancellation.abort()
    clearTimeout(collectionTimer)
    received?.close()
    received = undefined
    await descriptorReceiver?.close()
    control?.destroy()
    for (const socket of sockets) socket.destroy()
    for (const server of servers) server.close()
    await recoverPrivateMacosGuardian(
      configuration.ownerDirectory,
      configuration.ownerToken,
      cleanupTimeoutMs,
      input,
    )
    finished = true
    return Object.freeze({ result: null, outputLost: true, recovered: true, fenced: true })
  }
  try {
    if (configuration.type === 'start')
      privateMacosSandboxProfile({
        ...configuration.files,
        protectedRoots: [
          ...configuration.files.protectedRoots,
          configuration.ownerDirectory,
          directory,
        ],
      })
    if (configuration.type === 'start' && storage !== undefined) {
      requirePrivateMacosGuardianStorage(storage, configuration.files, configuration.cwd)
      await allocatePrivateMacosGuardianStorage(
        configuration.ownerDirectory,
        configuration.ownerToken,
        storage,
      )
      storageAllocated = true
    }
    recordPrivateMacosSockets(configuration.ownerDirectory, configuration.ownerToken, directory)
    socketsRecorded = true
    if (storage?.collect !== undefined && storage.collect !== null)
      descriptorReceiver = await createPrivateMacosDescriptorReceiver(directory, 'output')
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
    let resolveFenced: (
      value: PrivateMacosGuardianResult & { readonly outputFd?: number },
    ) => void = () => {}
    let rejectFenced: (error: unknown) => void = () => {}
    const fenced = new Promise<PrivateMacosGuardianResult & { readonly outputFd?: number }>(
      (resolve, reject) => {
        resolveFenced = resolve
        rejectFenced = reject
      },
    )
    void fenced.catch(() => undefined)
    const closeCollector = () => {
      clearTimeout(collectionTimer)
      received?.close()
      received = undefined
    }
    const release = () => {
      if (phase !== 'collecting' || received === undefined)
        throw new Error('macOS collector is not available')
      closeCollector()
      channel.send({ type: 'release' })
    }
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
            message?.type === 'fenced' &&
            storage !== undefined &&
            ['ready', 'running'].includes(currentPhase()) &&
            Object.keys(message).sort().join() === 'collect,outputLost,result,type' &&
            typeof message.collect === 'boolean' &&
            typeof message.outputLost === 'boolean'
          ) {
            const result = normalizePrivateMacosScopeResult(message.result)
            phase = 'collecting'
            if (message.collect) {
              if (
                descriptorReceiver === undefined ||
                result.exitCode !== 0 ||
                result.reason !== 'payload_exit' ||
                message.outputLost
              )
                throw new Error('macOS collector has no successful fenced owner')
              received = await descriptorReceiver.receive(
                guardian!,
                5000,
                transferCancellation.signal,
              )
              transferCancellation.signal.throwIfAborted()
              if (received.descriptors.length !== 1)
                throw new Error('macOS collector descriptor count changed')
              collectionTimer = setTimeout(() => {
                collectionLost = true
                closeCollector()
                if (phase === 'collecting') {
                  try {
                    channel.send({ type: 'cancel' })
                  } catch {
                    control?.destroy()
                  }
                }
              }, 20_000)
            }
            resolveFenced(
              Object.freeze({
                result,
                outputLost: message.outputLost,
                recovered: false,
                fenced: true,
                ...(received === undefined ? {} : { outputFd: received.descriptors[0]! }),
              }),
            )
          } else if (
            message?.type === 'terminal' &&
            Object.keys(message).sort().join() === 'outputLost,result,type' &&
            typeof message.outputLost === 'boolean' &&
            (message.result === null ||
              (typeof message.result === 'object' &&
                (message.result as { fenced?: unknown }).fenced === true))
          ) {
            phase = 'terminal'
            const normalizedResult =
              message.result === null ? null : normalizePrivateMacosScopeResult(message.result)
            rejectReady(
              new Error(
                `macOS guardian ended before readiness (${normalizedResult?.reason ?? 'recovery'})`,
              ),
            )
            closeCollector()
            await cleanup()
            control?.destroy()
            stdin.destroy()
            const terminal = Object.freeze({
              result: normalizedResult,
              outputLost: message.outputLost || collectionLost,
              recovered: false,
              fenced: true as const,
            })
            resolveFenced(terminal)
            return terminal
          } else throw new Error('invalid macOS guardian response')
        }
      } catch {
        phase = 'terminal'
        rejectReady(new Error('macOS guardian connection lost'))
        try {
          const result = await recover()
          resolveFenced(result)
          return result
        } catch (error) {
          rejectFenced(error)
          throw error
        }
      }
    })()
    void completion.catch(() => undefined)
    return Object.freeze({
      identity: record.identity,
      stdin,
      stdout,
      stderr,
      completion,
      fenced,
      release,
      async admit() {
        if (phase !== 'prepared') throw new Error('macOS guardian is not prepared')
        try {
          const fds = descriptors()
          phase = 'admitted'
          channel.send({ type: 'admit' })
          if (fds.length)
            await sendPrivateMacosDescriptors(
              join(directory, 'fd-inputs'),
              guardian!,
              fds,
              5000,
              transferCancellation.signal,
            )
          return await ready
        } catch (error) {
          if (currentPhase() !== 'terminal') {
            try {
              channel.send({ type: 'cancel' })
            } catch {
              control?.destroy()
            }
          }
          await completion
          throw error
        }
      },
      continue() {
        if (phase !== 'ready') throw new Error('macOS guardian is not ready')
        phase = 'running'
        channel.send({ type: 'continue' })
      },
      cancel() {
        transferCancellation.abort()
        closeCollector()
        if (phase !== 'terminal') channel.send({ type: 'cancel' })
      },
    })
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    // This function has not exposed admission yet: no payload can have started.
    await cleanup()
    if (storageAllocated)
      await recoverStorageWithGuardian(
        configuration.ownerDirectory,
        configuration.ownerToken,
        input,
      )
    throw error
  }
}
