import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBoundAttachments, openBoundAttachments } from '../src/internal/bound-attachments.js'
import {
  createPrivateProjectLocalLock,
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
} from '../src/internal/project-local-lock.js'
import {
  PRIVATE_EMPTY_FILE_IDENTITY,
  PrivateRootRunFiles,
  requirePrivateRootFileMapping,
} from '../src/internal/root-run-files.js'
import { defineBinding, defineJig } from '../src/project/author.js'
import { captureFlowSource } from '../src/project/flow-source.js'
import { linkPackageProject } from '../src/project/package-project.js'
import {
  buildPrivateActivationRequests,
  restorePrivateActivationRequest,
} from '../src/project/package-resolution.js'
import { retainFlowSourcePackages } from '../src/project/retained-flow.js'
import { openPrivateProjectRoot } from '../src/project/root.js'

async function fixture(work: (root: string, store: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-bound-attachments-'))
  const store = join(root, 'store')
  try {
    await mkdir(store, { mode: 0o700 })
    await mkdir(join(root, 'tools'))
    await writeFile(join(root, 'tools/data.bin'), new Uint8Array([0, 255, 128, 10]))
    await writeFile(join(root, 'tools/empty'), '')
    await work(root, store)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('Binding attachment authoring stays inert, bounded and project-relative', () => {
  expect(
    defineBinding({ package: 'flows/a', attachments: { tool: './tools' } }).attachments,
  ).toEqual({ tool: 'tools' })
  expect(defineBinding({ package: 'flows/a', attachments: {} }).attachments).toBeUndefined()
  expect(() => defineBinding({ package: 'flows/a', attachments: null } as never)).toThrow()
  for (const path of ['/usr/bin', '../outside', '.jig', 'x/.JIG/y', '', 'a/../b'])
    expect(() => defineBinding({ package: 'flows/a', attachments: { tool: path } })).toThrow()
  expect(() =>
    defineBinding({ package: 'flows/a', attachments: { 'bad/name': 'tools' } }),
  ).toThrow()
  expect(() =>
    defineBinding({
      package: 'flows/a',
      attachments: Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`a${n}`, 'tools'])),
    }),
  ).toThrow()
})

test('review captures binary resources; edited and removed originals do not change admitted bytes', async () =>
  fixture(async (directory, store) => {
    const root = await openPrivateProjectRoot(directory)
    try {
      const original = await captureBoundAttachments(root, { tool: 'tools' }, store)
      await writeFile(join(directory, 'tools/data.bin'), 'changed')
      const next = await captureBoundAttachments(root, { tool: 'tools' }, store)
      expect(original.tool!.digest).not.toBe(next.tool!.digest)
      await rm(join(directory, 'tools'), { recursive: true })
      for (let attempt = 0; attempt < 2; attempt++) {
        const opened = await openBoundAttachments(store, original)
        try {
          const files = opened.attachments[0]!.files
          expect([...readFileSync(`/proc/self/fd/${files[0]!.fd}`)]).toEqual([0, 255, 128, 10])
          expect(files[1]!.bytes).toBe(0)
          await expect(writeFile(`/proc/self/fd/${files[0]!.fd}`, 'overwrite')).rejects.toThrow()
        } finally {
          opened.close()
        }
      }
      const corrupt = structuredClone(original)
      ;(corrupt.tool!.files[0] as { digest: string }).digest = `sha256:${'0'.repeat(64)}`
      await expect(openBoundAttachments(store, corrupt)).rejects.toMatchObject({
        code: 'RUN_BOUND_ATTACHMENTS_UNAVAILABLE',
      })
      const wrongTree = structuredClone(original)
      ;(wrongTree.tool as { digest: string }).digest = `sha256:${'0'.repeat(64)}`
      await expect(openBoundAttachments(store, wrongTree)).rejects.toThrow()
    } finally {
      await root.dispose()
    }
  }))

test('review refuses source links, protected trees and aggregate excess before granting access', async () =>
  fixture(async (directory, store) => {
    const root = await openPrivateProjectRoot(directory)
    try {
      await symlink('tools', join(directory, 'alias'))
      await expect(captureBoundAttachments(root, { tool: 'alias' }, store)).rejects.toThrow()
      await symlink('/proc', join(directory, 'tools/link'))
      await expect(captureBoundAttachments(root, { tool: 'tools' }, store)).rejects.toThrow()
      await rm(join(directory, 'tools/link'))
      await link(join(directory, 'tools/data.bin'), join(directory, 'tools/hard'))
      await expect(captureBoundAttachments(root, { tool: 'tools' }, store)).rejects.toThrow()
      await rm(join(directory, 'tools/hard'))
      await writeFile(join(directory, 'tools/large'), Buffer.alloc(5 * 1024 * 1024))
      await expect(
        captureBoundAttachments(root, { first: 'tools', second: 'tools' }, store),
      ).rejects.toThrow('remaining')
    } finally {
      await root.dispose()
    }
  }))

test('linked review, lock, request and projection pin the same read-only selection with no override or child inheritance', async () =>
  fixture(async (directory, store) => {
    const path = join(directory, 'flows/read')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'FLOW.ts'), 'export {}')
    await writeFile(
      join(path, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        attachments: { tool: 'read' },
      }),
    )
    await mkdir(join(directory, 'flows/parent'))
    await writeFile(join(directory, 'flows/parent/FLOW.ts'), 'export {}')
    const root = await openPrivateProjectRoot(directory)
    const source = await captureFlowSource(
      directory,
      defineJig({ flows: ['flows/read', 'flows/parent'] }).flows,
    )
    try {
      const flows = await retainFlowSourcePackages(store, source)
      const capturedAttachments = await captureBoundAttachments(root, { tool: 'tools' }, store)
      const binding = {
        sourcePath: 'bindings/reader.ts',
        definition: defineBinding({ package: 'flows/read', attachments: { tool: 'tools' } }),
        capturedAttachments,
      }
      const linked = linkPackageProject({ flows, bindings: [binding] })
      const lock = createPrivateProjectLocalLock(linked)
      expect(
        decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock)).bindings.reader!
          .attachments,
      ).toEqual(capturedAttachments)
      const request = buildPrivateActivationRequests(linked).find(
        (item) => item.target.kind === 'binding',
      )!
      expect(restorePrivateActivationRequest(JSON.parse(JSON.stringify(request)))).toEqual(request)
      expect(() =>
        requirePrivateRootFileMapping(request, PRIVATE_EMPTY_FILE_IDENTITY),
      ).not.toThrow()
      expect(() =>
        requirePrivateRootFileMapping(request, {
          attachments: [{ name: 'tool', files: [] }],
          output: null,
        }),
      ).toThrow()
      const direct = buildPrivateActivationRequests(linked).find(
        (item) => item.target.kind === 'flow' && item.packagePath === 'flows/read',
      )!
      expect(direct.boundAttachments).toBeUndefined()
      expect(() => requirePrivateRootFileMapping(direct, PRIVATE_EMPTY_FILE_IDENTITY)).toThrow()
      const files = new PrivateRootRunFiles([], null)
      const opened = await openBoundAttachments(store, capturedAttachments)
      try {
        expect(() => files.projection('one', request, PRIVATE_EMPTY_FILE_IDENTITY)).toThrow(
          'projection',
        )
        const projection = files.projection(
          'one',
          request,
          PRIVATE_EMPTY_FILE_IDENTITY,
          opened.attachments,
        )
        expect(projection.attachments).toEqual({
          tool: { path: '/jig-input/tool', access: 'read' },
        })
        expect(projection.plan.capturedInputs).toHaveLength(2)
      } finally {
        opened.close()
        await files.close()
      }
      expect(() =>
        linkPackageProject({ flows, bindings: [{ ...binding, capturedAttachments: {} }] }),
      ).toThrow('retained file capture')
      expect(() =>
        linkPackageProject({
          flows,
          bindings: [
            {
              ...binding,
              definition: defineBinding({
                package: 'flows/parent',
                attachments: { tool: 'tools' },
              }),
            },
          ],
        }),
      ).toThrow('declared read-only')
      const combined = {
        ...request,
        attachments: { ...request.attachments, input: 'read' as const },
      }
      expect(() =>
        requirePrivateRootFileMapping(combined, {
          attachments: [
            {
              name: 'input',
              files: [
                { path: 'large', bytes: 8 * 1024 * 1024, digest: `sha256:${'0'.repeat(64)}` },
              ],
            },
          ],
          output: null,
        }),
      ).toThrow()
      expect(() =>
        linkPackageProject({
          flows,
          bindings: [
            binding,
            {
              sourcePath: 'bindings/parent.ts',
              definition: { package: 'flows/parent', slots: { child: 'binding:reader' } },
            },
          ],
        }),
      ).toThrow('root-only')
      const modified = structuredClone(request)
      ;(modified.boundAttachments!.tool as { source: string }).source = 'different'
      expect(() => restorePrivateActivationRequest(modified)).toThrow('digest')
    } finally {
      await source.dispose()
      await root.dispose()
    }
  }))
