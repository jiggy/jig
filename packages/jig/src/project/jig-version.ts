import { invalid } from '../diagnostics.js'
import {
  privateExactJigVersion,
  privateJigExecutableLocation,
  privateJigVersion,
  privateJigVersionRecovery,
} from '../installation-version.js'
import { statPrivateChild } from '../internal/descriptor-files.js'
import { decodeJson1, type JsonObject } from '../json.js'
import { captureDeclarationSource } from './declaration-source.js'
import { openPrivateProjectRoot, type PrivateProjectRoot } from './root.js'

const path = 'package.json'
const pointer = '/peerDependencies/@jigging~1jig'

/** Inert, descriptor-confined metadata. No installation or authored evaluation. */
export async function captureProjectJigRequirement(root: PrivateProjectRoot) {
  try {
    await statPrivateChild(root.handle, path)
  } catch (error) {
    if (!missing(error)) throw error
    return {
      verify: async () => {
        try {
          await statPrivateChild(root.handle, path)
        } catch (error) {
          if (missing(error)) return
          throw error
        }
        invalid('PROJECT_SOURCE_CHANGED', 'Project compatibility metadata appeared during capture.', path)
      },
    }
  }
  const source = await captureDeclarationSource(root, { kind: 'members', paths: [path] }, 'json')
  const bytes = await source.read(source.members[0]!, 1_048_576)
  let manifest: JsonObject
  try {
    const value = decodeJson1(bytes)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    manifest = value as JsonObject
  } catch {
    invalid(
      'PROJECT_JIG_REQUIREMENT_INVALID',
      'Use a valid JSON object in package.json. No project code was evaluated.',
      path,
    )
  }
  const peers = manifest.peerDependencies
  if (peers !== undefined) {
    if (peers === null || typeof peers !== 'object' || Array.isArray(peers)) invalidRequirement()
    const required = (peers as JsonObject)['@jigging/jig']
    if (required !== undefined) {
      if (!privateExactJigVersion(required)) invalidRequirement()
      if (required !== privateJigVersion) {
        invalid(
          'PROJECT_JIG_VERSION_MISMATCH',
          'This project requires Jig ' + required + '. The running executable is Jig ' +
            privateJigVersion + '.\nExecutable: ' + privateJigExecutableLocation() +
            '\nNo project code was evaluated.\n\n' + await privateJigVersionRecovery(required),
          path,
          pointer,
        )
      }
    }
  }
  await source.verify()
  return { verify: source.verify }
}

/** Early CLI refusal; authoritative project capture repeats this same check. */
export async function checkProjectJigRequirement(directory: string): Promise<void> {
  let root: PrivateProjectRoot
  try {
    root = await openPrivateProjectRoot(directory)
  } catch {
    // Ordinary acquisition owns missing-directory and unsafe-root diagnostics.
    return
  }
  try {
    await captureProjectJigRequirement(root)
  } finally {
    await root.dispose()
  }
}

function missing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

function invalidRequirement(): never {
  invalid(
    'PROJECT_JIG_REQUIREMENT_INVALID',
    'Set peerDependencies["@jigging/jig"] to one exact tested Jig version in package.json. No project code was evaluated.',
    path,
    pointer,
  )
}
