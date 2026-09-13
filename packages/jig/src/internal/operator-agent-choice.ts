import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

const CLIENTS = new Set(['codex', 'claude', 'pi', 'api'])
type Environment = Readonly<Record<string, string | undefined>>

/** Operator preference only: no credentials, project policy, or approval. */
export async function readPrivateAgentChoice(
  environment: Environment,
  project: string,
): Promise<string | undefined> {
  const location = await choiceLocation(environment, project)
  let directory: Awaited<ReturnType<typeof open>>
  try {
    directory = await openDirectory(location.directory, location.project)
  } catch (error) {
    if (absent(error)) return undefined
    throw error
  }
  try {
    let file: Awaited<ReturnType<typeof open>>
    try {
      file = await open(
        `/proc/self/fd/${directory.fd}/${location.name}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
    } catch (error) {
      if (absent(error)) return undefined
      throw error
    }
    try {
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid!() ||
        (stat.mode & 0o077) !== 0 ||
        stat.nlink !== 1 ||
        stat.size > 32
      )
        throw new Error('unsafe Agent preference')
      const buffer = Buffer.alloc(33)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const client: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString())
      if (typeof client !== 'string' || !CLIENTS.has(client))
        throw new Error('invalid Agent preference')
      return client
    } finally {
      await file.close()
    }
  } finally {
    await directory.close()
  }
}

export async function writePrivateAgentChoice(
  environment: Environment,
  project: string,
  client: string,
): Promise<void> {
  if (!CLIENTS.has(client)) throw new Error('invalid Agent preference')
  const location = await choiceLocation(environment, project)
  for (let ancestor = location.directory; ; ancestor = dirname(ancestor)) {
    try {
      if (inside(location.project, await realpath(ancestor)))
        throw new Error('Agent preference must be outside project')
      break
    } catch (error) {
      if (!absent(error)) throw error
    }
  }
  await mkdir(location.directory, { recursive: true, mode: 0o700 })
  const directory = await openDirectory(location.directory, location.project)
  const temporary = `/proc/self/fd/${directory.fd}/.${randomBytes(16).toString('hex')}`
  try {
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(`${JSON.stringify(client)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, `/proc/self/fd/${directory.fd}/${location.name}`)
    await directory.sync()
  } finally {
    try {
      await unlink(temporary).catch((error) => {
        if (!absent(error)) throw error
      })
    } finally {
      await directory.close()
    }
  }
}

async function choiceLocation(environment: Environment, project: string) {
  const root = environment.XDG_STATE_HOME || join(environment.HOME ?? homedir(), '.local', 'state')
  if (!isAbsolute(root)) throw new Error('Agent preference root must be absolute')
  const canonical = await realpath(project)
  const directory = join(root, 'jig', 'agent-choices')
  if (inside(canonical, directory)) throw new Error('Agent preference must be outside project')
  return {
    directory,
    project: canonical,
    name: `${createHash('sha256').update(canonical).digest('hex')}.json`,
  }
}

async function openDirectory(path: string, project: string) {
  if (inside(project, await realpath(path)))
    throw new Error('Agent preference must be outside project')
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    if (inside(project, await realpath(`/proc/self/fd/${directory.fd}`)))
      throw new Error('Agent preference must be outside project')
    const stat = await directory.stat()
    if (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)
      throw new Error('unsafe Agent preference directory')
    return directory
  } catch (error) {
    await directory.close()
    throw error
  }
}
function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith('../') && !isAbsolute(child))
}
function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
