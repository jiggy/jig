import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  captureStoredPackage,
  PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS,
  privatePackageArtifactArchiveBytes,
  type PackageArtifactRef,
  publishCapturedPackage,
} from '../src/internal/package-artifact-store.js'
import { capturePackageDirectory, type CapturedPackage } from '../src/package/capture.js'

const metadata = '---\nname: retained\ndescription: Retained fixture.\n---\n'

describe('private Package/1 artifact store', () => {
  test('publishes canonical bytes and reacquires them after source disposal', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, {
        'FLOW.md': metadata,
        'flow.ts': "export default 'old';\n",
        'lib/value.bin': Uint8Array.of(0, 1, 255),
      })
      const captured = await capturePackageDirectory(source)
      const reference = await publishCapturedPackage(store, captured)
      const blob = artifactPath(store, reference)

      expect(reference).toEqual({ kind: 'flow-package/1', digest: captured.digest })
      expect(
        `sha256:${createHash('sha256')
          .update(await readFile(blob))
          .digest('hex')}`,
      ).toBe(captured.digest)

      await captured.dispose()
      await rm(source, { recursive: true, force: true })
      const reopened = await captureStoredPackage(store, reference)
      try {
        expect(new TextDecoder().decode(await reopened.read('flow.ts'))).toBe(
          "export default 'old';\n",
        )
        expect(await reopened.read('lib/value.bin')).toEqual(Uint8Array.of(0, 1, 255))
      } finally {
        await reopened.dispose()
      }
    })
  })

  test('concurrent identical publications converge without staging residue', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata, payload: 'same' })
      const captured = await capturePackageDirectory(source)
      try {
        const references = await Promise.all(
          Array.from({ length: 12 }, () => publishCapturedPackage(store, captured)),
        )
        expect(new Set(references.map((reference) => reference.digest))).toEqual(
          new Set([captured.digest]),
        )
        const entries = await readdir(dirname(artifactPath(store, references[0]!)))
        expect(entries).toEqual([artifactPath(store, references[0]!).split('/').at(-1)!])
      } finally {
        await captured.dispose()
      }
    })
  }, 15_000)

  test('does not trust a forged digest claimed by a capture', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata })
      const captured = await capturePackageDirectory(source)
      const forged = {
        ...captured,
        digest: `sha256:${'0'.repeat(64)}`,
      } satisfies CapturedPackage
      try {
        await expect(publishCapturedPackage(store, forged)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_SOURCE_MISMATCH',
        })
      } finally {
        await captured.dispose()
      }
    })
  })

  test('bounds each staged archive before reading package content', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata })
      const captured = await capturePackageDirectory(source)
      const overhead = privatePackageArtifactArchiveBytes([{ path: 'FLOW.md', size: 0 }])
      expect(
        privatePackageArtifactArchiveBytes([
          {
            path: 'FLOW.md',
            size: PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes - overhead,
          },
        ]),
      ).toBe(PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes)
      const oversized = {
        ...captured,
        files: Object.freeze([
          {
            path: 'FLOW.md',
            size: PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes - overhead + 1,
          },
        ]),
      } satisfies CapturedPackage
      try {
        await expect(publishCapturedPackage(store, oversized)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_LIMIT',
        })
        expect(await readdir(store)).toEqual([])
      } finally {
        await captured.dispose()
      }
    })
  })

  test('hard-caps retained bytes and repeated new publications without blocking exact reuse', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata, payload: 'retained' })
      const retained = await capturePackageDirectory(source)
      const reference = await publishCapturedPackage(store, retained)
      const quotaDirectory = join(store, 'quota-fixture')
      const quotaFile = join(quotaDirectory, 'declined.stage')
      await mkdir(quotaDirectory, { mode: 0o700 })
      await writeFile(quotaFile, '', { mode: 0o600 })
      await truncate(quotaFile, PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.storeBytes)

      expect(await publishCapturedPackage(store, retained)).toEqual(reference)

      await writeTree(source, { payload: 'new candidate' })
      const declined = await capturePackageDirectory(source)
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await expect(publishCapturedPackage(store, declined)).rejects.toMatchObject({
            code: 'PACKAGE_ARTIFACT_STORE_LIMIT',
          })
        }
        expect((await lstat(quotaFile)).size).toBe(PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.storeBytes)
      } finally {
        await declined.dispose()
        await retained.dispose()
      }
    })
  })

  test('rejects a short captured stream without publishing a final object', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata })
      const captured = await capturePackageDirectory(source)
      const short = {
        ...captured,
        files: Object.freeze([{ path: 'FLOW.md', size: Buffer.byteLength(metadata) + 1 }]),
      } satisfies CapturedPackage
      try {
        await expect(publishCapturedPackage(store, short)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_SOURCE_INVALID',
        })
        const hexadecimal = captured.digest.slice('sha256:'.length)
        const shard = join(store, 'packages', 'v1', 'sha256', hexadecimal.slice(0, 2))
        expect(await readdir(shard)).toEqual([])
      } finally {
        await captured.dispose()
      }
    })
  })

  test('rejects corruption and never repairs an existing object', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata, payload: 'original' })
      const captured = await capturePackageDirectory(source)
      try {
        const reference = await publishCapturedPackage(store, captured)
        const blob = artifactPath(store, reference)
        await chmod(blob, 0o600)
        await appendFile(blob, 'corruption')
        await chmod(blob, 0o400)

        await expect(captureStoredPackage(store, reference)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_CORRUPT',
        })
        await expect(publishCapturedPackage(store, captured)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_CORRUPT',
        })
        expect((await readFile(blob)).subarray(-10).toString()).toBe('corruption')
      } finally {
        await captured.dispose()
      }
    })
  })

  test('keeps an acquired capture immutable after later store corruption', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata, payload: 'original' })
      const sourceCapture = await capturePackageDirectory(source)
      try {
        const reference = await publishCapturedPackage(store, sourceCapture)
        const acquired = await captureStoredPackage(store, reference)
        try {
          const blob = artifactPath(store, reference)
          await chmod(blob, 0o600)
          const handle = await open(blob, 'r+')
          try {
            const information = await handle.stat()
            await handle.write(Buffer.from('MUTATION'), 0, 8, information.size - 8)
            await handle.sync()
          } finally {
            await handle.close()
          }
          await chmod(blob, 0o400)

          expect(new TextDecoder().decode(await acquired.read('payload'))).toBe('original')
          await expect(captureStoredPackage(store, reference)).rejects.toMatchObject({
            code: 'PACKAGE_ARTIFACT_CORRUPT',
          })
        } finally {
          await acquired.dispose()
        }
      } finally {
        await sourceCapture.dispose()
      }
    })
  })

  test('rejects noncanonical and confused references before path derivation', async () => {
    await withStoreAndSource(async (store) => {
      const uppercase = {
        kind: 'flow-package/1',
        digest: `sha256:${'A'.repeat(64)}`,
      } as unknown as PackageArtifactRef
      const candidateShaped = {
        kind: 'flow-package/1',
        digest: `sha256:${'a'.repeat(64)}`,
        captureDigest: `sha256:${'b'.repeat(64)}`,
      } as unknown as PackageArtifactRef

      await expect(captureStoredPackage(store, uppercase)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_DIGEST',
      })
      await expect(captureStoredPackage(store, candidateShaped)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_REF',
      })

      let getterInvoked = false
      const accessor = Object.defineProperty({ kind: 'flow-package/1' }, 'digest', {
        get() {
          getterInvoked = true
          return `sha256:${'a'.repeat(64)}`
        },
        enumerable: true,
      }) as unknown as PackageArtifactRef
      await expect(captureStoredPackage(store, accessor)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_REF',
      })
      expect(getterInvoked).toBeFalse()

      for (const reference of [
        Object.assign(Object.create({}), {
          kind: 'flow-package/1',
          digest: `sha256:${'a'.repeat(64)}`,
        }),
        Object.assign(
          {
            kind: 'flow-package/1',
            digest: `sha256:${'a'.repeat(64)}`,
          },
          { [Symbol('hidden')]: true },
        ),
        Object.defineProperty({ kind: 'flow-package/1' }, 'digest', {
          value: `sha256:${'a'.repeat(64)}`,
          enumerable: false,
        }),
      ]) {
        await expect(
          captureStoredPackage(store, reference as PackageArtifactRef),
        ).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_REF',
        })
      }
    })
  })

  test('rejects a special-file substitution at a retained digest', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata })
      const captured = await capturePackageDirectory(source)
      try {
        const reference = await publishCapturedPackage(store, captured)
        const blob = artifactPath(store, reference)
        await unlink(blob)
        await symlink('/dev/null', blob)
        await expect(captureStoredPackage(store, reference)).rejects.toMatchObject({
          code: 'PACKAGE_ARTIFACT_CORRUPT',
        })
      } finally {
        await captured.dispose()
      }
    })
  })

  test('ignores an inert staging residue when acquiring a published object', async () => {
    await withStoreAndSource(async (store, source) => {
      await writeTree(source, { 'FLOW.md': metadata })
      const captured = await capturePackageDirectory(source)
      try {
        const reference = await publishCapturedPackage(store, captured)
        await writeFile(join(dirname(artifactPath(store, reference)), '.stage-crashed'), 'partial')
        const reopened = await captureStoredPackage(store, reference)
        await reopened.dispose()
      } finally {
        await captured.dispose()
      }
    })
  })

  test('acquires an independently constructed canonical archive', async () => {
    await withStoreAndSource(async (store) => {
      const path = Buffer.from('FLOW.md', 'utf8')
      const content = Buffer.from(metadata, 'utf8')
      const archive = Buffer.concat([
        Buffer.from('FLOW-Package/1\0', 'ascii'),
        unsignedBigEndian(1n, 8),
        Buffer.from([0x01]),
        unsignedBigEndian(BigInt(path.byteLength), 4),
        path,
        unsignedBigEndian(BigInt(content.byteLength), 8),
        content,
      ])
      const reference = referenceForArchive(archive)
      const blob = artifactPath(store, reference)
      await mkdir(dirname(blob), { recursive: true, mode: 0o700 })
      await writeFile(blob, archive, { mode: 0o400 })

      const acquired = await captureStoredPackage(store, reference)
      try {
        expect(new TextDecoder().decode(await acquired.read('FLOW.md'))).toBe(metadata)
      } finally {
        await acquired.dispose()
      }
    })
  })

  test('rejects an oversized retained archive before snapshotting it', async () => {
    await withStoreAndSource(async (store) => {
      const reference = {
        kind: 'flow-package/1',
        digest: `sha256:${'0'.repeat(64)}`,
      } as PackageArtifactRef
      const blob = artifactPath(store, reference)
      await mkdir(dirname(blob), { recursive: true, mode: 0o700 })
      await writeFile(blob, '', { mode: 0o600 })
      await truncate(blob, PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes + 1)
      await chmod(blob, 0o400)
      await expect(captureStoredPackage(store, reference)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_LIMIT',
      })
    })
  })

  test('rejects a malformed archive even when its filename matches its bytes', async () => {
    await withStoreAndSource(async (store) => {
      const archive = Buffer.concat([
        Buffer.from('FLOW-Package/1\0', 'ascii'),
        unsignedBigEndian(1n, 8),
        Buffer.from([0x02]),
      ])
      const reference = referenceForArchive(archive)
      const blob = artifactPath(store, reference)
      await mkdir(dirname(blob), { recursive: true, mode: 0o700 })
      await writeFile(blob, archive, { mode: 0o400 })
      await expect(captureStoredPackage(store, reference)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_CORRUPT',
      })
    })
  })
})

function artifactPath(store: string, reference: PackageArtifactRef): string {
  const hexadecimal = reference.digest.slice('sha256:'.length)
  return join(
    store,
    'packages',
    'v1',
    'sha256',
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.pkg`,
  )
}

function referenceForArchive(archive: Uint8Array): PackageArtifactRef {
  return {
    kind: 'flow-package/1',
    digest: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
  } as PackageArtifactRef
}

function unsignedBigEndian(value: bigint, bytes: number): Buffer {
  const result = Buffer.alloc(bytes)
  let remaining = value
  for (let index = bytes - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

async function withStoreAndSource(
  run: (store: string, source: string) => Promise<void>,
): Promise<void> {
  const store = await mkdtemp(join(tmpdir(), 'jig-artifact-store-'))
  const source = await mkdtemp(join(tmpdir(), 'jig-artifact-source-'))
  try {
    await run(store, source)
  } finally {
    await rm(store, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
}

async function writeTree(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
