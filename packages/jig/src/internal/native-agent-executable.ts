import { constants } from 'node:fs'
import { access, lstat, open, readlink, realpath } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PrivateAcpSetupError } from './acp-setup-diagnostics.js'
import { resolvePrivateCodexInstallation } from './codex-installation.js'

type NativeClient = 'codex' | 'claude' | 'pi' | 'bwrap'

export class PrivateNativeAgentExecutableUnavailableError extends Error {
  constructor(readonly client: NativeClient) {
    super(`the native ${client} executable is unavailable`)
  }
}

/** Discovery uses operator input only; launch still requires reviewed ACP identity. */
export async function resolvePrivateNativeAgentExecutable(
  client: NativeClient,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string = process.cwd(),
): Promise<string> {
  // Copy selections before any filesystem await, including for private direct callers.
  const selected = environment[`${client.toUpperCase()}_PATH`]
  const searchPath = environment.PATH
  const voltaHome = environment.VOLTA_HOME
  const project = resolve(projectDirectory)
  try {
    if (selected !== undefined) {
      if (!isAbsolute(selected) || selected.includes('\0')) throw new Error('invalid override')
      return await selectExecutable(client, await executable(selected), voltaHome, project)
    }

    const outside = await privateNativeAgentSupportResolver(project)
    for (const directory of (searchPath ?? '').split(delimiter)) {
      if (!isAbsolute(directory) || directory.includes('\0')) continue
      const candidate = `${directory}${sep}${client}`
      try {
        const path = await outside(candidate)
        if (path === undefined) continue
        if ((await executable(path)) !== path) throw new Error('executable selection changed')
        return await selectExecutable(client, path, voltaHome, project, outside)
      } catch (error) {
        if (!absent(error) && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error
      }
    }
  } catch (error) {
    if (error instanceof PrivateAcpSetupError) throw error
    throw new PrivateNativeAgentExecutableUnavailableError(client)
  }
  throw new PrivateNativeAgentExecutableUnavailableError(client)
}

/** Apply the same project exclusion to implicit installation dependencies. */
export async function privateNativeAgentSupportResolver(
  projectDirectory: string,
): Promise<(path: string) => Promise<string | undefined>> {
  const project = resolve(projectDirectory)
  const projectRoot = await realpath(project)
  const excluded = [project, projectRoot]
  for (const root of [project, projectRoot]) {
    for (let directory = dirname(root); ; directory = dirname(directory)) {
      const dependencies = join(directory, 'node_modules')
      excluded.push(dependencies)
      try {
        excluded.push(await realpath(dependencies))
      } catch (error) {
        if (!absent(error)) throw error
      }
      if (dirname(directory) === directory) break
    }
  }
  const forbidden = (path: string) => excluded.some((root) => inside(root, path))
  return async (path) => {
    if (!isAbsolute(path) || path.includes('\0') || forbidden(path)) return undefined
    return await outsideProject(path, forbidden)
  }
}

async function outsideProject(
  candidate: string,
  forbidden: (path: string) => boolean,
): Promise<string | undefined> {
  // Check each link hop, including links which enter the project then leave it.
  let pending = candidate.split(sep).filter(Boolean)
  let path: string = sep
  let links = 0
  while (pending.length > 0) {
    const component = pending.shift()
    if (component === undefined) break
    path = resolve(path, component)
    if (forbidden(path)) return undefined
    if ((await lstat(path)).isSymbolicLink()) {
      if (++links > 40) throw new Error('too many executable symlinks')
      const link = await readlink(path)
      const target = isAbsolute(link) ? link : `${dirname(path)}${sep}${link}`
      if (forbidden(target)) return undefined
      pending = [...target.split(sep).filter(Boolean), ...pending]
      path = sep
    }
  }
  return path
}

async function executable(candidate: string): Promise<string> {
  const path = await realpath(candidate)
  const information = await lstat(path)
  if (!information.isFile() || (information.mode & 0o111) === 0) {
    throw Object.assign(new Error('not an executable file'), { code: 'EACCES' })
  }
  await access(path, constants.X_OK)
  return path
}

async function selectExecutable(
  client: NativeClient,
  selected: string,
  voltaHome: string | undefined,
  project: string,
  outside?: (path: string) => Promise<string | undefined>,
): Promise<string> {
  const dispatcher = basename(selected) === 'volta-shim'
  if (dispatcher && client !== 'codex') throw new PrivateAcpSetupError('wrapper')
  if (
    client === 'codex' &&
    (dispatcher || (basename(selected) === 'codex.js' && (await script(selected))))
  ) {
    try {
      const native = await resolvePrivateCodexInstallation(
        selected,
        voltaHome,
        outside ?? (await privateNativeAgentSupportResolver(project)),
      )
      if ((await executable(native)) !== native) throw new Error('executable selection changed')
      return native
    } catch {
      throw new PrivateAcpSetupError('wrapper')
    }
  }
  return selected
}

async function script(path: string): Promise<boolean> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    if (!(await file.stat()).isFile()) throw new Error('invalid executable selection')
    const magic = Buffer.alloc(2)
    await file.read(magic, 0, magic.length, 0)
    return magic.toString() === '#!'
  } finally {
    await file.close()
  }
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}
