import { constants } from 'node:fs'
import { access, lstat, readlink, realpath } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

type NativeClient = 'codex' | 'claude' | 'pi'

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
  const project = resolve(projectDirectory)
  try {
    if (selected !== undefined) {
      if (!isAbsolute(selected) || selected.includes('\0')) throw new Error('invalid override')
      return await executable(selected)
    }

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
    for (const directory of (searchPath ?? '').split(delimiter)) {
      if (!isAbsolute(directory) || directory.includes('\0')) continue
      const candidate = `${directory}${sep}${client}`
      if (forbidden(candidate)) continue
      try {
        const path = await outsideProject(candidate, forbidden)
        if (path === undefined) continue
        if ((await executable(path)) !== path) throw new Error('executable selection changed')
        return path
      } catch (error) {
        if (!absent(error) && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error
      }
    }
  } catch {
    throw new PrivateNativeAgentExecutableUnavailableError(client)
  }
  throw new PrivateNativeAgentExecutableUnavailableError(client)
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

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}
