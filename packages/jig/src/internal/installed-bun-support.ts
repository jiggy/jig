import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { JsonValue } from '../json.js'
import type { PrivateLinuxReadOnlyMount } from './linux-rootless-backend.js'
import { privateDomainDigest, privateFileDigest } from './identity.js'
import { resolvePrivateLinuxHostLoader } from './linux-host-paths.js'

const ELF_INTERPRETER = '/lib64/ld-linux-x86-64.so.2'
const LIBRARIES = Object.freeze([
  'libc.so.6',
  'libm.so.6',
  'libdl.so.2',
  'libpthread.so.0',
] as const)
const BUN_DESTINATION = '/jig-runtime/bun'
const LIBRARY_DESTINATION = '/jig-runtime/lib'
const EVALUATOR_DESTINATION = '/jig-evaluator'
const PREPARATION_WORKER_DESTINATION = '/jig-preparation-worker.js'
const AGENT_WORKER_DESTINATION = '/jig-agent-worker.js'
const BUN_PACKAGE = join('@oven', 'bun-linux-x64-baseline', 'bin', 'bun')
const BUN_VERSION = '1.3.3'
const BUN_REVISION = '274e01c737e85f8142070a9745b43a2ba09fce4c'
const BUN_DIGEST = 'sha256:e666c943af70078a72bad00757a094776a54621fecd83eb4aa982760f9186839'
const authenticSupports = new WeakSet<object>()

export interface PrivateInstalledBunLocation {
  readonly releaseRoot: string
  readonly executablePath: string
  readonly installedCliPath: string
}

export interface PrivateInstalledBunSupport {
  readonly kind: 'private-installed-bun-support/1'
  readonly digest: string
  readonly releaseRoot: string
  readonly executablePath: string
  readonly executableDigest: string
  readonly sandboxExecutablePath: typeof BUN_DESTINATION
  readonly installedCliPath: string
  readonly installedCliDigest: string
  readonly hostLibraryDirectory: string
  readonly runtimeMounts: readonly PrivateLinuxReadOnlyMount[]
  readonly supervisorPath: string
  readonly supervisorDigest: string
  readonly evaluatorSupportPath: string
  readonly evaluatorSupportDigest: string
  readonly preparationWorkerPath: string
  readonly preparationWorkerDigest: string
  readonly sandboxPreparationWorkerPath: typeof PREPARATION_WORKER_DESTINATION
  readonly agentWorkerPath: string
  readonly agentWorkerDigest: string
  readonly sandboxAgentWorkerPath: typeof AGENT_WORKER_DESTINATION
}

/**
 * Resolve the one fixed Linux-x64 release layout and exact npm-supplied Bun.
 */
export async function openPrivateInstalledBunSupport(
  location: PrivateInstalledBunLocation,
): Promise<PrivateInstalledBunSupport> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('the installed Bun host requires Linux x64')
  }
  const releaseRoot = await exactDirectory(location.releaseRoot, 'installed Jig release')
  if (releaseRoot !== location.releaseRoot) {
    throw new Error('the installed Jig release path is not canonical')
  }
  const executablePath = await exactRegularFile(
    location.executablePath,
    true,
    'installed Bun executable',
  )
  if (executablePath !== location.executablePath) {
    throw new Error('the installed Bun executable path is not canonical')
  }
  const selectedExecutable = await resolveInstalledBun(releaseRoot)
  if (executablePath !== selectedExecutable) {
    throw new Error('Jig was not started with its exact installed Bun dependency')
  }
  const installedCliPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'installed-cli.js'),
    false,
    'installed Jig command',
  )
  if (installedCliPath !== location.installedCliPath) {
    throw new Error('Jig was not started with its exact installed command')
  }
  const supervisorPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'linux-rootless-supervisor.js'),
    false,
    'installed rootless supervisor',
  )
  const evaluatorSupportPath = await exactDirectory(
    join(releaseRoot, 'libexec', 'evaluator'),
    'installed evaluator support',
  )
  const evaluatorFiles = await Promise.all(
    [
      'project-evaluator-worker.js',
      'project-evaluator-sdk.bundle.js',
      'project-authoring-1.schema.json',
    ].map(async (name) =>
      Object.freeze({
        name,
        path: await exactRegularFile(
          join(evaluatorSupportPath, name),
          false,
          `installed evaluator asset ${name}`,
        ),
      }),
    ),
  )
  const preparationWorkerPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'preparation', 'bun-native-preparation-worker.js'),
    false,
    'installed Bun preparation worker',
  )
  const agentWorkerPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'agent', 'openai-agent-worker.js'),
    false,
    'installed Agent provider worker',
  )

  const loaderPath = await exactRegularFile(
    await resolvePrivateLinuxHostLoader(),
    true,
    'supported-host ELF interpreter',
  )
  const hostLibraryDirectory = dirname(loaderPath)
  const libraries = await Promise.all(
    LIBRARIES.map(async (name) =>
      Object.freeze({
        name,
        path: await exactRegularFile(
          join(hostLibraryDirectory, name),
          false,
          `supported-host library ${name}`,
        ),
      }),
    ),
  )
  const [
    executableDigest,
    installedCliDigest,
    supervisorDigest,
    loaderDigest,
    libraryDigests,
    evaluatorDigests,
    preparationWorkerDigest,
    agentWorkerDigest,
  ] = await Promise.all([
    privateFileDigest(executablePath),
    privateFileDigest(installedCliPath),
    privateFileDigest(supervisorPath),
    privateFileDigest(loaderPath),
    Promise.all(
      libraries.map(async ({ name, path }) =>
        Object.freeze({
          name,
          digest: await privateFileDigest(path),
        }),
      ),
    ),
    Promise.all(
      evaluatorFiles.map(async ({ name, path }) =>
        Object.freeze({
          name,
          digest: await privateFileDigest(path),
        }),
      ),
    ),
    privateFileDigest(preparationWorkerPath),
    privateFileDigest(agentWorkerPath),
  ])
  const bun = (
    globalThis as typeof globalThis & {
      readonly Bun?: { readonly version?: unknown; readonly revision?: unknown }
    }
  ).Bun
  if (
    bun?.version !== BUN_VERSION ||
    bun.revision !== BUN_REVISION ||
    executableDigest !== BUN_DIGEST
  ) {
    throw new Error('the exact installed Bun runtime is unavailable')
  }
  const evaluatorSupportDigest = privateDomainDigest(
    'JIG-Installed-Evaluator-Support/1',
    evaluatorDigests as unknown as JsonValue,
  )
  const identity = Object.freeze({
    kind: 'private-installed-bun-support/1' as const,
    platform: 'linux-x64-glibc',
    executableDigest,
    installedCliDigest,
    supervisorDigest,
    loader: Object.freeze({ destination: ELF_INTERPRETER, digest: loaderDigest }),
    libraries: libraryDigests,
    evaluatorSupportDigest,
    preparationWorkerDigest,
    agentWorkerDigest,
  })
  const runtimeMounts = Object.freeze([
    Object.freeze({ source: executablePath, destination: BUN_DESTINATION }),
    Object.freeze({ source: loaderPath, destination: ELF_INTERPRETER }),
    ...libraries.map(({ name, path }) =>
      Object.freeze({
        source: path,
        destination: `${LIBRARY_DESTINATION}/${name}`,
      }),
    ),
  ])
  const support = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest('JIG-Installed-Bun-Support/1', identity as unknown as JsonValue),
    releaseRoot,
    executablePath,
    executableDigest,
    sandboxExecutablePath: BUN_DESTINATION,
    installedCliPath,
    installedCliDigest,
    hostLibraryDirectory,
    runtimeMounts,
    supervisorPath,
    supervisorDigest,
    evaluatorSupportPath,
    evaluatorSupportDigest,
    preparationWorkerPath,
    preparationWorkerDigest,
    sandboxPreparationWorkerPath: PREPARATION_WORKER_DESTINATION,
    agentWorkerPath,
    agentWorkerDigest,
    sandboxAgentWorkerPath: AGENT_WORKER_DESTINATION,
  })
  authenticSupports.add(support)
  return support
}

export function requirePrivateInstalledBunSupport(value: unknown): PrivateInstalledBunSupport {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Object.isFrozen(value) ||
    !authenticSupports.has(value)
  ) {
    throw new TypeError('installed Bun support was not produced by the fixed host factory')
  }
  return value as PrivateInstalledBunSupport
}

/** Re-read every trusted byte immediately before an evaluator or Flow launch. */
export async function revalidatePrivateInstalledBunSupport(value: unknown): Promise<void> {
  const support = requirePrivateInstalledBunSupport(value)
  const current = await openPrivateInstalledBunSupport({
    releaseRoot: support.releaseRoot,
    executablePath: support.executablePath,
    installedCliPath: support.installedCliPath,
  })
  if (
    current.digest !== support.digest ||
    current.executablePath !== support.executablePath ||
    current.installedCliPath !== support.installedCliPath ||
    current.supervisorPath !== support.supervisorPath ||
    current.evaluatorSupportPath !== support.evaluatorSupportPath ||
    current.preparationWorkerPath !== support.preparationWorkerPath ||
    current.agentWorkerPath !== support.agentWorkerPath
  ) {
    throw new Error('installed Bun support changed after selection')
  }
}

async function resolveInstalledBun(releaseRoot: string): Promise<string> {
  const candidates = [
    join(releaseRoot, 'node_modules', BUN_PACKAGE),
    join(releaseRoot, '..', '..', BUN_PACKAGE),
  ]
  for (const candidate of candidates) {
    try {
      return await exactRegularFile(candidate, true, 'installed Bun executable')
    } catch {
      // npm may install the exact direct dependency nested or hoisted.
    }
  }
  throw new Error('the exact installed Bun dependency is unavailable')
}

async function exactRegularFile(path: string, executable: boolean, label: string): Promise<string> {
  const resolved = await realpath(path)
  const information = await lstat(resolved)
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    (executable && (information.mode & 0o111) === 0)
  ) {
    throw new Error(`${label} is unavailable`)
  }
  if (executable) await access(resolved, constants.X_OK)
  return resolved
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const resolved = await realpath(path)
  const information = await lstat(resolved)
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error(`${label} is unavailable`)
  }
  return resolved
}
