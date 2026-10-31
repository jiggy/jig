import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import manifest from '../package.json' with { type: 'json' }
import { privateJigDevelopmentCheckout } from './development-checkout.js'

export const privateJigVersion = manifest.version
const release = dirname(dirname(fileURLToPath(import.meta.url)))

export function privateJigExecutableLocation(): string {
  const location = JSON.stringify(join(release, 'bin/jig'))
  return location.length <= 200 ? location : '(path omitted; run command -v jig)'
}

/** Versions are validated before entering either human text or shell commands. */
export function privateExactJigVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(value) &&
    !/[\r\n]/.test(value)
  )
}

export async function privateJigVersionRecovery(required: string): Promise<string> {
  if (await privateJigDevelopmentCheckout(release)) {
    return 'Update this Jig checkout to the required revision. From the repository root, run just jig::build, then retry review.'
  }
  return 'Install the required Jig version with bun install --global @jigging/jig@' +
    required + ' or npm install --global @jigging/jig@' + required + '. Then retry review.'
}
