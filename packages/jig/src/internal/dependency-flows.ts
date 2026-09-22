import { posix } from 'node:path'
import { invalid } from '../diagnostics.js'
import {
  type CapturedPackage,
  captureOpenedPackageDirectory,
  createCapturedPackage,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { inspectCapturedPackage } from '../package/inspect.js'
import type { CapturedFlowMember, CapturedFlowSource } from '../project/flow-source.js'
import { npmPackageName } from '../project/package-selector.js'
import type { PrivateProjectRoot } from '../project/root.js'
import { normalizePrivateBunExecutionLayout } from './bun-execution-layout.js'
import type { PrivatePreparedBunPackage } from './bun-native-preparation.js'
import { capturePrivateBunWorkspace, type PrivateBunWorkspace } from './bun-workspace-capture.js'

/** Declared package adoption through the existing script-disabled Bun preparation. */
export async function captureDependencyFlows(input: {
  root: PrivateProjectRoot
  selectors: readonly string[]
  signal: AbortSignal
  prepare(
    source: CapturedPackage,
    workspace?: PrivateBunWorkspace,
  ): Promise<PrivatePreparedBunPackage>
  retain(
    selector: string,
    source: CapturedPackage,
    execution: PrivatePreparedBunPackage,
  ): Promise<void>
}): Promise<CapturedFlowSource> {
  const metadata = await captureOpenedPackageDirectory(
    'project dependency metadata',
    input.root.handle,
    {
      includes: (path) => ['package.json', 'bun.lock', '.npmrc'].includes(path),
      maximumFiles: 3,
      maximumBytes: 3 * 1024 * 1024,
    },
  )
  let workspace: PrivateBunWorkspace | undefined
  let prepared: PrivatePreparedBunPackage | undefined
  const members: CapturedFlowMember[] = []
  try {
    const manifest = await readManifest(metadata, 'package.json')
    const declarations = manifest.dependencies
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations))
      invalid(
        'PROJECT_DEPENDENCY_MISSING',
        'npm Flow targets require project package.json dependencies',
        'package.json',
      )
    for (const selector of input.selectors) {
      const name = npmPackageName(selector)
      if (
        !Object.hasOwn(declarations, name) ||
        typeof (declarations as Record<string, unknown>)[name] !== 'string'
      )
        invalid(
          'PROJECT_DEPENDENCY_MISSING',
          'selected Flow is not a declared project dependency',
          selector,
        )
    }
    workspace = await capturePrivateBunWorkspace({
      projectRoot: input.root,
      packagePath: '',
      captured: metadata,
      signal: input.signal,
    })
    prepared = await input.prepare(workspace?.captured ?? metadata, workspace)
    for (const selector of input.selectors) {
      input.signal.throwIfAborted()
      const name = npmPackageName(selector)
      const packageRoot = resolvePackageRoot(prepared, workspace?.target ?? '', name)
      const captured = await subtree(prepared.captured, packageRoot)
      try {
        const installed = await readManifest(captured, 'package.json')
        if (installed.name !== name)
          invalid(
            'PROJECT_DEPENDENCY_IDENTITY',
            'resolved package name does not match the selected dependency',
            selector,
          )
        const inspected = await inspectCapturedPackage(captured)
        if (inspected.entrypoint?.suffix !== 'md')
          await input.retain(selector, captured, {
            captured: prepared.captured,
            layout: normalizePrivateBunExecutionLayout({
              ...prepared.layout,
              flowRoot: packageRoot,
            }),
          })
        members.push(
          Object.freeze({
            provenance: Object.freeze({ membership: 'exact' as const, projectPath: selector }),
            captured,
            inspected,
          }),
        )
      } catch (error) {
        await captured.dispose()
        throw error
      }
    }
    await input.root.verify()
    const retained = prepared
    prepared = undefined
    return Object.freeze({
      observations: Object.freeze([
        { kind: 'members' as const, members: Object.freeze([...input.selectors]) },
      ]),
      members: Object.freeze(members),
      async dispose() {
        try {
          await Promise.all(members.map((member) => member.captured.dispose()))
        } finally {
          await retained.captured.dispose()
        }
      },
    })
  } catch (error) {
    await Promise.all(members.map((member) => member.captured.dispose()))
    throw error
  } finally {
    try {
      await prepared?.captured.dispose()
    } finally {
      try {
        await workspace?.captured.dispose()
      } finally {
        await metadata.dispose()
      }
    }
  }
}

/** Match installer-owned aliases, never live filesystem links or JS exports. */
export function resolvePackageRoot(
  prepared: PrivatePreparedBunPackage,
  from: string,
  name: string,
): string {
  const paths = new Set(prepared.captured.files.map((file) => file.path))
  const aliases = new Map(prepared.layout.aliases.map((alias) => [alias.path, alias.target]))
  for (let directory = from; ; directory = posix.dirname(directory)) {
    const request = posix.join(directory, 'node_modules', name)
    const target = aliases.get(request) ?? request
    if (paths.has(`${target}/package.json`)) return target
    if (directory === '' || directory === '.') break
  }
  invalid(
    'PROJECT_DEPENDENCY_MISSING',
    'Bun did not install the selected declared Flow dependency',
    `npm:${name}`,
  )
}

async function readManifest(
  captured: CapturedPackage,
  path: string,
): Promise<Record<string, unknown>> {
  if (!captured.files.some((file) => file.path === path))
    invalid(
      'PROJECT_DEPENDENCY_MISSING',
      'selected dependency requires a package.json',
      'package.json',
    )
  try {
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(await captured.read(path, 1024 * 1024)),
    )
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError()
    return value
  } catch {
    invalid(
      'PROJECT_DEPENDENCY_MANIFEST',
      'dependency package.json must be a bounded UTF-8 JSON object',
      'package.json',
    )
  }
}

async function subtree(source: CapturedPackage, root: string): Promise<CapturedPackage> {
  const prefix = `${root}/`
  const files = source.files
    .filter(
      (file) =>
        file.path.startsWith(prefix) &&
        !file.path.slice(prefix.length).split('/').includes('node_modules'),
    )
    .map((file) => Object.freeze({ path: file.path.slice(prefix.length), size: file.size }))
  const backing = {
    async *stream(path: string, maximum?: number) {
      let remaining = maximum ?? Number.MAX_SAFE_INTEGER
      for await (const chunk of source.stream(prefix + path)) {
        if (remaining === 0) break
        const part = chunk.subarray(0, remaining)
        yield part
        remaining -= part.byteLength
      }
    },
    async dispose() {},
  }
  return createCapturedPackage(
    'declared Flow dependency',
    files,
    await packageDigest(files, (file) => backing.stream(file.path)),
    backing,
  )
}
