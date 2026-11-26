import { execFile as execFileCallback } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import {
  isOfflineToolStorePath,
  OFFLINE_TOOL_LIMITS,
  type OfflineTool,
} from '../project/offline-tool.js'
import type { PrivateExecutionIntent } from './execution-intent.js'
import { privateDomainDigest } from './identity.js'
import { resolvePrivateLinuxHostPath } from './linux-host-paths.js'

const execFile = promisify(execFileCallback)
const NAR_HASH = /^sha256:[0-9abcdfghijklmnpqrsvwxyz]{52}(?![\s\S])/

export interface PrivateOfflineToolRuntime {
  readonly digest: string
  readonly projections: PrivateExecutionIntent['projections']
}

/** Read the system-managed local store. This never realizes or installs a path. */
export async function inspectPrivateOfflineToolRuntime(
  tool: Pick<OfflineTool, 'executable' | 'runtimeRoots'>,
  signal?: AbortSignal,
): Promise<PrivateOfflineToolRuntime> {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid?.() === 0)
    throw new Error('offline tool requires an unprivileged x86_64 Linux host')
  const store = await lstat('/nix/store')
  if (
    !store.isDirectory() ||
    store.uid !== 0 ||
    ((store.mode & 0o022) !== 0 && !(store.mode & 0o1000))
  )
    throw new Error('offline tool requires a system-managed Nix store')
  const candidates = [
    '/usr/bin/nix-store',
    '/nix/var/nix/profiles/default/bin/nix-store',
    '/run/current-system/sw/bin/nix-store',
  ]
  // The multi-call Nix executable selects nix-store semantics by argv[0].
  let query = ''
  const resolved = await resolvePrivateLinuxHostPath(candidates, async (path) => {
    const executable = await realpath(path)
    query = path
    return executable
  })
  if (!isOfflineToolStorePath(resolved.split('/').slice(0, 4).join('/')))
    throw new Error('offline tool requires the system Nix executable')
  const queryFile = await lstat(resolved)
  if (!queryFile.isFile() || queryFile.uid !== 0 || (queryFile.mode & 0o022) !== 0)
    throw new Error('offline tool requires the system Nix executable')
  const readStore = async (args: readonly string[]) => {
    const { stdout } = await execFile(query, [...args], {
      cwd: '/',
      env: {
        LC_ALL: 'C',
        NIX_REMOTE: 'daemon',
        NIX_USER_CONF_FILES: '/dev/null',
        ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
      },
      maxBuffer: 128 * 1024,
      timeout: 15_000,
      ...(signal === undefined ? {} : { signal }),
    })
    return stdout.trim().split('\n')
  }
  const paths = (await readStore(['--query', '--requisites', ...tool.runtimeRoots])).sort()
  if (
    paths.length > OFFLINE_TOOL_LIMITS.closure ||
    !paths.every(isOfflineToolStorePath) ||
    new Set(paths).size !== paths.length ||
    !tool.runtimeRoots.every((root) => paths.includes(root))
  )
    throw new Error('offline tool store closure exceeds its finite profile')
  const executable = await realpath(tool.executable)
  const file = await lstat(executable)
  if (
    !paths.some((path) => executable.startsWith(`${path}/`)) ||
    !file.isFile() ||
    file.uid !== 0 ||
    (file.mode & 0o6022) !== 0 ||
    (file.mode & 0o111) === 0
  )
    throw new Error('offline tool executable is outside its verified installation')
  const hashes = await readStore(['--query', '--hash', ...paths])
  if (hashes.length !== paths.length || hashes.some((hash) => !NAR_HASH.test(hash)))
    throw new Error('offline tool requires exact Nix archive hashes')
  const projections = await Promise.all(
    paths.map(async (path) => {
      const information = await lstat(path)
      if (
        information.uid !== 0 ||
        (information.mode & 0o6022) !== 0 ||
        (!information.isDirectory() && !information.isFile())
      )
        throw new Error('offline tool store path is outside its immutable profile')
      return Object.freeze({
        source: path,
        destination: path,
        kind: information.isDirectory() ? ('tree' as const) : ('file' as const),
      })
    }),
  )
  await readStore(['--verify-path', ...paths])
  return Object.freeze({
    digest: privateDomainDigest('JIG-Offline-Tool-Installation/1', {
      files: paths.map((path, index) => ({ path, hash: hashes[index]! })),
    }),
    projections: Object.freeze(projections),
  })
}
