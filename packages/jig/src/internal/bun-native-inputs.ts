import {
  requirePrivateBunPatches,
  requirePrivateBunResolutionManifest,
} from './bun-native-lock-policy.js'

/** The worker stages exactly these native inputs before installation; all other source stays inert. */
export async function privateBunNativeInputs(input: {
  readonly paths: readonly string[]
  readonly members?: readonly string[]
  readonly read: (path: string) => Uint8Array | Promise<Uint8Array>
}): Promise<{
  readonly paths: ReadonlySet<string>
  readonly patches: Readonly<Record<string, string>>
}> {
  const manifests = [
    'package.json',
    ...(input.members?.map((path) => `${path}/package.json`) ?? []),
  ]
  const paths = new Set(manifests)
  if (input.paths.includes('bun.lock')) paths.add('bun.lock')
  let patches: Readonly<Record<string, string>> = {}
  for (const path of manifests) {
    const bytes = await input.read(path)
    if (bytes.byteLength > 1024 * 1024) throw new TypeError('oversized native manifest')
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    requirePrivateBunResolutionManifest(
      manifest,
      input.members === undefined ? undefined : path === 'package.json' ? 'root' : 'member',
    )
    if (path === 'package.json') patches = requirePrivateBunPatches(manifest.patchedDependencies)
  }
  for (const path of Object.values(patches)) {
    if ((await input.read(path)).byteLength > 1024 * 1024)
      throw new TypeError('oversized captured patch')
    paths.add(path)
  }
  return Object.freeze({ paths, patches })
}
