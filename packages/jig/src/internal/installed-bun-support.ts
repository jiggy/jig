import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { release as osRelease } from 'node:os'
import { dirname, join } from 'node:path'

import type { JsonValue } from '../json.js'
import { privateDomainDigest } from './identity.js'
import { privateInstallationFileDigest } from './installation-verification.js'
import { resolvePrivateLinuxHostLoader } from './linux-host-paths.js'
import type { PrivateLinuxReadOnlyMount } from './linux-rootless-backend.js'

const ELF_INTERPRETER = '/lib64/ld-linux-x86-64.so.2'
const LIBRARIES = Object.freeze([
  'libc.so.6',
  'libm.so.6',
  'libdl.so.2',
  'libpthread.so.0',
] as const)
const BUN_DESTINATION = '/jig-runtime/bun'
const LIBRARY_DESTINATION = '/jig-runtime/lib'
const PREPARATION_WORKER_DESTINATION = '/jig-preparation-worker.js'
const HTTP_WORKER_DESTINATION = '/jig-http-worker.js'
const MARKDOWN_RUNTIME_DESTINATION = '/jig-markdown-runtime.js'
const LINUX_BUN_PACKAGE = join('@oven', 'bun-linux-x64-baseline', 'bin', 'bun')
const MACOS_BUN_PACKAGE = join('@oven', 'bun-darwin-x64-baseline', 'bin', 'bun')
const LINUX_BUN = Object.freeze({
  version: '1.3.3',
  revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
  digest: 'sha256:e666c943af70078a72bad00757a094776a54621fecd83eb4aa982760f9186839',
})
const MACOS_BUN = Object.freeze({
  version: '1.4.2',
  revision: '744846f844374847c902b5e7fd59b4342a51ef99',
  digest: 'sha256:2fa513af22ac59e03aae640cad302e73cb1ddb0f6398501e2ddccf7dcd613596',
})
const authenticSupports = new WeakSet<object>()

export type PrivateInstalledBunPlatform = 'linux-x64-glibc' | 'darwin-x64-23.4.0-23E224'

export interface PrivateInstalledBunLocation {
  readonly releaseRoot: string
  readonly executablePath: string
  readonly installedCliPath: string
}

export interface PrivateInstalledBunSupport {
  readonly kind: 'private-installed-bun-support/1'
  readonly digest: string
  readonly platform: PrivateInstalledBunPlatform
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
  readonly launcherPath: string | null
  readonly launcherDigest: string | null
  readonly evaluatorSupportPath: string
  readonly evaluatorSupportDigest: string
  readonly preparationWorkerPath: string
  readonly preparationWorkerDigest: string
  readonly sandboxPreparationWorkerPath: typeof PREPARATION_WORKER_DESTINATION
  readonly httpWorkerPath: string
  readonly httpWorkerDigest: string
  readonly sandboxHttpWorkerPath: typeof HTTP_WORKER_DESTINATION
  readonly markdownRuntimePath: string
  readonly markdownRuntimeDigest: string
  readonly sandboxMarkdownRuntimePath: typeof MARKDOWN_RUNTIME_DESTINATION
}

/** Resolve the fixed qualified release layout and exact npm-supplied Bun. */
export async function openPrivateInstalledBunSupport(
  location: PrivateInstalledBunLocation,
): Promise<PrivateInstalledBunSupport> {
  const platform = installedPlatform()
  const runtime = platform === 'linux-x64-glibc' ? LINUX_BUN : MACOS_BUN
  const releaseRoot = await exactDirectory(location.releaseRoot, 'installed Jig release')
  if (releaseRoot !== location.releaseRoot)
    throw new Error('the installed Jig release path is not canonical')
  const executablePath = await exactRegularFile(
    location.executablePath,
    true,
    'installed Bun executable',
  )
  if (executablePath !== location.executablePath)
    throw new Error('the installed Bun executable path is not canonical')
  if (executablePath !== (await resolveInstalledBun(releaseRoot, platform)))
    throw new Error('Jig was not started with its exact installed Bun dependency')
  const installedCliPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'installed-cli.js'),
    false,
    'installed Jig command',
  )
  if (installedCliPath !== location.installedCliPath)
    throw new Error('Jig was not started with its exact installed command')
  const supervisorPath = await exactRegularFile(
    join(
      releaseRoot,
      'libexec',
      platform === 'linux-x64-glibc'
        ? 'linux-rootless-supervisor.js'
        : 'macos-native-supervisor.js',
    ),
    false,
    'installed execution supervisor',
  )
  const launcherPath =
    platform === 'linux-x64-glibc'
      ? null
      : await exactRegularFile(
          join(releaseRoot, 'libexec', 'macos-exec'),
          true,
          'installed macOS execution launcher',
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
  const httpWorkerPath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'http-request-worker.js'),
    false,
    'installed HTTP worker',
  )
  const markdownRuntimePath = await exactRegularFile(
    join(releaseRoot, 'libexec', 'markdown-runtime.js'),
    false,
    'installed Markdown interpreter',
  )
  const loaderPath =
    platform === 'linux-x64-glibc'
      ? await exactRegularFile(
          await resolvePrivateLinuxHostLoader(),
          true,
          'supported-host ELF interpreter',
        )
      : null
  const hostLibraryDirectory = loaderPath === null ? dirname(executablePath) : dirname(loaderPath)
  const libraries =
    loaderPath === null
      ? []
      : await Promise.all(
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
    launcherDigest,
    loaderDigest,
    libraryDigests,
    evaluatorDigests,
    preparationWorkerDigest,
    httpWorkerDigest,
    markdownRuntimeDigest,
  ] = await Promise.all([
    privateInstallationFileDigest(executablePath),
    privateInstallationFileDigest(installedCliPath),
    privateInstallationFileDigest(supervisorPath),
    launcherPath === null ? null : privateInstallationFileDigest(launcherPath),
    loaderPath === null ? null : privateInstallationFileDigest(loaderPath),
    Promise.all(
      libraries.map(async ({ name, path }) =>
        Object.freeze({ name, digest: await privateInstallationFileDigest(path) }),
      ),
    ),
    Promise.all(
      evaluatorFiles.map(async ({ name, path }) =>
        Object.freeze({ name, digest: await privateInstallationFileDigest(path) }),
      ),
    ),
    privateInstallationFileDigest(preparationWorkerPath),
    privateInstallationFileDigest(httpWorkerPath),
    privateInstallationFileDigest(markdownRuntimePath),
  ])
  const bun = (
    globalThis as typeof globalThis & {
      readonly Bun?: { readonly version?: unknown; readonly revision?: unknown }
    }
  ).Bun
  if (
    bun?.version !== runtime.version ||
    bun.revision !== runtime.revision ||
    executableDigest !== runtime.digest
  )
    throw new Error('the exact installed Bun runtime is unavailable')
  const evaluatorSupportDigest = privateDomainDigest(
    'JIG-Installed-Evaluator-Support/1',
    evaluatorDigests as unknown as JsonValue,
  )
  const identity = Object.freeze({
    kind: 'private-installed-bun-support/1' as const,
    platform,
    executableDigest,
    installedCliDigest,
    supervisorDigest,
    launcherDigest,
    loader:
      loaderDigest === null
        ? null
        : Object.freeze({ destination: ELF_INTERPRETER, digest: loaderDigest }),
    libraries: libraryDigests,
    evaluatorSupportDigest,
    preparationWorkerDigest,
    httpWorkerDigest,
    markdownRuntimeDigest,
  })
  const runtimeMounts = Object.freeze([
    Object.freeze({ source: executablePath, destination: BUN_DESTINATION }),
    ...(loaderPath === null
      ? []
      : [Object.freeze({ source: loaderPath, destination: ELF_INTERPRETER })]),
    ...libraries.map(({ name, path }) =>
      Object.freeze({ source: path, destination: `${LIBRARY_DESTINATION}/${name}` }),
    ),
  ])
  const support = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest('JIG-Installed-Bun-Support/1', identity as unknown as JsonValue),
    platform,
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
    launcherPath,
    launcherDigest,
    evaluatorSupportPath,
    evaluatorSupportDigest,
    preparationWorkerPath,
    preparationWorkerDigest,
    sandboxPreparationWorkerPath: PREPARATION_WORKER_DESTINATION,
    httpWorkerPath,
    sandboxHttpWorkerPath: HTTP_WORKER_DESTINATION,
    httpWorkerDigest,
    markdownRuntimePath,
    markdownRuntimeDigest,
    sandboxMarkdownRuntimePath: MARKDOWN_RUNTIME_DESTINATION,
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
  )
    throw new TypeError('installed Bun support was not produced by the fixed host factory')
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
    current.launcherPath !== support.launcherPath ||
    current.evaluatorSupportPath !== support.evaluatorSupportPath ||
    current.preparationWorkerPath !== support.preparationWorkerPath ||
    current.httpWorkerPath !== support.httpWorkerPath ||
    current.markdownRuntimePath !== support.markdownRuntimePath
  )
    throw new Error('installed Bun support changed after selection')
}

function installedPlatform(): PrivateInstalledBunPlatform {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64-glibc'
  if (process.platform === 'darwin' && process.arch === 'x64' && osRelease() === '23.4.0')
    return 'darwin-x64-23.4.0-23E224'
  throw new Error('the installed Bun host is unavailable on this platform')
}

async function resolveInstalledBun(
  releaseRoot: string,
  platform: PrivateInstalledBunPlatform,
): Promise<string> {
  const packagePath = platform === 'linux-x64-glibc' ? LINUX_BUN_PACKAGE : MACOS_BUN_PACKAGE
  const candidates = [
    join(releaseRoot, 'node_modules', packagePath),
    join(releaseRoot, '..', '..', packagePath),
  ]
  for (const candidate of candidates) {
    try {
      return await exactRegularFile(candidate, true, 'installed Bun executable')
    } catch {
      // npm may install the exact platform dependency nested or hoisted.
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
  )
    throw new Error(`${label} is unavailable`)
  if (executable) await access(resolved, constants.X_OK)
  return resolved
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const resolved = await realpath(path)
  const information = await lstat(resolved)
  if (!information.isDirectory() || information.isSymbolicLink())
    throw new Error(`${label} is unavailable`)
  return resolved
}
