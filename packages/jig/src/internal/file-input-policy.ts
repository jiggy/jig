import { createHash } from 'node:crypto'

/** Closed invocation-file policy shared by the supported native hosts. */
export const PRIVATE_FILE_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  files: 64,
  entries: 256,
  pathBytes: 512,
  depth: 16,
  captureMs: 10_000,
  deliveryMs: 20_000,
})
export const PRIVATE_CAPTURE_LIMITS = Object.freeze({
  input: PRIVATE_FILE_LIMITS.bytes,
  output: 16 * 1024 * 1024,
})
export type PrivateCapturePurpose = keyof typeof PRIVATE_CAPTURE_LIMITS
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const protectedParts = new Set(['.jig'])
// biome-ignore lint/suspicious/noControlCharactersInRegex: The file boundary must reject control characters.
const FILE_CONTROLS = /[\x00-\x1f\x7f]/

/** Only these locally authored messages may cross the CLI diagnostic boundary. */
export class PrivateFileInputError extends Error {
  constructor(
    readonly reason:
      | 'filesystem'
      | 'native'
      | 'mount'
      | 'symlink'
      | 'missing'
      | 'access'
      | 'cross-mount'
      | 'kernel'
      | 'path'
      | 'protected'
      | 'linked'
      | 'input-link'
      | 'regular'
      | 'changed'
      | 'input-changed'
      | 'bytes'
      | 'files'
      | 'entries'
      | 'deadline',
    readonly limit?: number,
  ) {
    super(
      {
        filesystem:
          process.platform === 'darwin'
            ? 'use a local APFS or HFS+ filesystem'
            : 'use a local ext4, XFS, Btrfs, or tmpfs filesystem',
        native:
          process.platform === 'darwin'
            ? 'Jig could not load its native Mac file controls; check the supported-host requirements'
            : 'Jig could not load its Linux file controls; check the supported glibc loader and libc installation',
        mount:
          'the selected attachment mount could not be identified; select an available local directory',
        symlink:
          'the selected attachment contains a symbolic link; select a directory and files without links',
        missing:
          'the selected attachment directory or file does not exist; check --attach and --select',
        access:
          'the selected attachment cannot be read by the current operator; check its file and directory permissions',
        'cross-mount':
          'the selected attachment crosses a mount boundary; select each mounted directory separately',
        kernel:
          'the kernel does not provide the required file controls; check the supported-host requirements',
        path: 'select a relative path without traversal or links, within 16 components and 512 UTF-8 bytes',
        protected: 'Jig state and host control files cannot be selected as input',
        linked: 'select only singly linked regular files',
        'input-link': 'the selected --input file cannot be a symbolic link',
        regular: 'select a regular input file, not a directory or special file',
        changed: 'selected input changed during capture; capture a stable source tree',
        'input-changed':
          'the selected --input file changed during capture; retry with a stable file',
        bytes: `selected file exceeds the remaining ${limit ?? 0}-byte input budget; select less data`,
        files: 'input exceeds 64 files; narrow the selection with --select',
        entries: 'input exceeds 256 tree entries; narrow the selection with --select',
        deadline: 'input capture exceeded its 10-second budget; select a smaller local tree',
      }[reason],
    )
  }
}

export function privateFilePath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > PRIVATE_FILE_LIMITS.pathBytes ||
    Buffer.from(value).toString('utf8') !== value ||
    value.includes('\\') ||
    FILE_CONTROLS.test(value) ||
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          protectedParts.has(process.platform === 'darwin' ? part.toLowerCase() : part),
      ) ||
    value.split('/').length > PRIVATE_FILE_LIMITS.depth
  )
    throw new PrivateFileInputError('path')
  return value
}
export function privateAttachmentName(value: string): string {
  if (typeof value !== 'string' || value.length > 64 || !NAME.test(value))
    throw new TypeError('invalid attachment name')
  return value
}

export function privateRequireUnprotected(path: string): void {
  if (
    path
      .split('/')
      .some((part) =>
        protectedParts.has(process.platform === 'darwin' ? part.toLowerCase() : part),
      ) ||
    ['/proc', '/sys', '/dev', '/run'].some((root) => path === root || path.startsWith(`${root}/`))
  ) {
    throw new PrivateFileInputError('protected')
  }
}

export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
