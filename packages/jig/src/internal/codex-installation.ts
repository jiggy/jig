import { constants } from 'node:fs'
import { access, lstat, open } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { PrivateAcpSetupError } from './acp-setup-diagnostics.js'

type OutsideProject = (path: string) => Promise<string | undefined>
const MAX_METADATA_BYTES = 64 * 1024
const MAX_PACKAGE_ANCESTORS = 32

/** Select native bytes from the current npm layout; neither launcher nor manager runs. */
export async function resolvePrivateCodexInstallation(
  selected: string,
  voltaHome: string | undefined,
  outsideProject: OutsideProject,
): Promise<string> {
  try {
    let launcher = selected
    let recordedVersion: string | undefined
    if (basename(selected) === 'volta-shim') {
      if (basename(dirname(selected)) !== 'bin') throw new Error('unsupported dispatcher layout')
      const home = voltaHome ?? dirname(dirname(selected))
      if (!isAbsolute(home) || home.includes('\0')) throw new Error('invalid Volta home')
      const record = await metadata(join(home, 'tools/user/bins/codex.json'), outsideProject)
      if (record.name !== 'codex' || record.package !== '@openai/codex' || record.manager !== 'Npm')
        throw new Error('unsupported dispatcher selection')
      recordedVersion = version(record.version)
      launcher = await requiredPath(
        join(home, 'tools/image/packages/@openai/codex/bin/codex'),
        outsideProject,
      )
    }
    if (basename(launcher) !== 'codex.js' || basename(dirname(launcher)) !== 'bin')
      throw new Error('unsupported npm launcher layout')
    // Even an explicit wrapper override must not infer dependencies through project source.
    if ((await requiredPath(launcher, outsideProject)) !== launcher)
      throw new Error('launcher selection changed')
    const information = await lstat(launcher)
    if (!information.isFile() || (information.mode & 0o111) === 0)
      throw new Error('invalid Codex npm launcher')
    await access(launcher, constants.X_OK)
    const root = dirname(dirname(launcher))
    const manifest = await metadata(join(root, 'package.json'), outsideProject)
    const selectedVersion = version(manifest.version)
    if (
      manifest.name !== '@openai/codex' ||
      object(manifest.bin).codex !== 'bin/codex.js' ||
      (recordedVersion !== undefined && recordedVersion !== selectedVersion)
    )
      throw new Error('unsupported Codex installation')
    const platform = `${process.platform}-${process.arch}`
    const triple =
      process.platform === 'darwin'
        ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
        : 'x86_64-unknown-linux-musl'
    if (
      !(process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)) &&
      !(process.platform === 'linux' && process.arch === 'x64')
    )
      throw new Error('unsupported Codex platform')
    const dependency = `@openai/codex-${platform}`
    const nativeVersion = `${selectedVersion}-${platform}`
    if (object(manifest.optionalDependencies)[dependency] !== `npm:@openai/codex@${nativeVersion}`)
      throw new Error('unsupported Codex native dependency')

    // Match Node's package lookup, nearest first, without importing its resolver or package code.
    // Only the selected launcher's declared platform dependency is eligible.
    let directory = dirname(launcher)
    for (let depth = 0; depth < MAX_PACKAGE_ANCESTORS; depth++) {
      if (basename(directory) !== 'node_modules') {
        const nativeRoot = join(directory, 'node_modules', dependency)
        let present = false
        try {
          await requiredPath(nativeRoot, outsideProject)
          present = true
        } catch (error) {
          if (!absent(error)) throw error
        }
        if (present) {
          const nativeManifest = await metadata(join(nativeRoot, 'package.json'), outsideProject)
          if (
            nativeManifest.name !== '@openai/codex' ||
            nativeManifest.version !== nativeVersion ||
            !exactArray(nativeManifest.os, process.platform) ||
            !exactArray(nativeManifest.cpu, process.arch)
          )
            throw new Error('mismatched Codex native dependency')
          return await requiredPath(join(nativeRoot, 'vendor', triple, 'bin/codex'), outsideProject)
        }
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    throw new Error('Codex native dependency is unavailable')
  } catch {
    // Installation metadata is private data, never public diagnostic content.
    throw new PrivateAcpSetupError('wrapper')
  }
}

async function requiredPath(path: string, outsideProject: OutsideProject): Promise<string> {
  const selected = await outsideProject(path)
  if (selected === undefined) throw new Error('Codex installation enters the project')
  return selected
}

async function metadata(
  path: string,
  outsideProject: OutsideProject,
): Promise<Record<string, unknown>> {
  const selected = await requiredPath(path, outsideProject)
  const file = await open(
    selected,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_METADATA_BYTES)
      throw new Error('invalid Codex installation metadata')
    const bytes = Buffer.alloc(before.size + 1)
    let used = 0
    while (used < bytes.length) {
      const result = await file.read(bytes, used, bytes.length - used, used)
      if (result.bytesRead === 0) break
      used += result.bytesRead
    }
    const after = await file.stat()
    if (
      used !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('Codex installation metadata changed')
    return object(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used))),
    )
  } finally {
    await file.close()
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid Codex installation record')
  return value as Record<string, unknown>
}

function version(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value)
  )
    throw new Error('invalid Codex installation version')
  return value
}

function exactArray(value: unknown, selected: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === selected
}

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}
