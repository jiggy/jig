// Separate process: observing private allocations and injecting fs failures must
// not affect unrelated capture tests or native-support loading.
import { spyOn } from 'bun:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { privateOpenFileRoot, privateReadRegularFile, sha256 } from '../src/internal/file-input.js'
import { privateCaptureSavedResult } from '../src/internal/saved-result.js'

const work = process.argv[2]!
const actualRead = fs.readSync
const actualStat = fs.fstatSync
const actualClose = fs.closeSync
const artifactText = 'PRIVATE_ACCEPTED_OR_REJECTED_ARTIFACT_BYTES'
function fixture(name: string) {
  const directory = join(work, name)
  fs.mkdirSync(join(directory, 'files'), { recursive: true })
  fs.writeFileSync(join(directory, 'files', 'patch'), artifactText)
  const reportText =
    JSON.stringify({
      status: 'succeeded',
      outcome: 'done',
      output: { summary: 'PRIVATE_RECORDED_REPORT_BYTES' },
      delivery: {
        status: 'written',
        files: [
          { path: 'patch', bytes: artifactText.length, digest: sha256(Buffer.from(artifactText)) },
        ],
      },
    }) + '\n'
  fs.writeFileSync(join(directory, 'result.json'), reportText)
  return { directory, reportText }
}
function zeroed(buffers: Iterable<Buffer>) {
  for (const buffer of buffers)
    assert.equal(
      buffer.every((byte) => byte === 0),
      true,
    )
}

for (const target of ['report', 'artifact'] as const) {
  for (const fault of ['read', 'post-stat', 'changed', 'close', 'success'] as const) {
    const { directory, reportText } = fixture(`${target}-${fault}`)
    const path = join(directory, target === 'report' ? 'result.json' : 'files/patch')
    const inode = fs.statSync(path, { bigint: true }).ino
    const expected = target === 'report' ? reportText : artifactText
    const allocations = new Set<Buffer>()
    const allAllocations = new Set<Buffer>()
    const injected = new Error(`injected ${target} ${fault}`)
    let observed = false,
      faultInjected = false
    const read = spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      const count = (actualRead as any)(...args)
      allAllocations.add(args[1])
      if (actualStat(args[0], { bigint: true }).ino === inode) {
        allocations.add(args[1])
        if (!observed && count > 0) {
          observed = true
          if (fault === 'read') {
            faultInjected = true
            throw injected
          }
          if (fault === 'changed') {
            faultInjected = true
            fs.writeFileSync(path, 'changed to a different size after read')
          }
        }
      }
      return count
    }) as any)
    const stat = spyOn(fs, 'fstatSync').mockImplementation(((...args: any[]) => {
      const value = (actualStat as any)(...args)
      if (fault === 'post-stat' && observed && !faultInjected && value.ino === inode) {
        faultInjected = true
        throw injected
      }
      return value
    }) as any)
    const close = spyOn(fs, 'closeSync').mockImplementation((fd) => {
      const targetFile = actualStat(fd, { bigint: true }).ino === inode
      actualClose(fd)
      if (fault === 'close' && targetFile) {
        faultInjected = true
        throw injected
      }
    })
    let capture: ReturnType<typeof privateCaptureSavedResult> | undefined
    try {
      if (target === 'report' && fault !== 'success')
        assert.throws(() => privateCaptureSavedResult(directory), /valid result.json/)
      else {
        capture = privateCaptureSavedResult(directory)
        assert.equal(capture.complete, fault === 'success')
        if (fault === 'success') {
          assert.equal(allocations.size, 1)
          assert.equal([...allocations][0]!.subarray(0, expected.length).toString(), expected)
          assert.equal(capture.preview('patch')?.text, artifactText)
        } else {
          assert.equal(capture.record.status, 'succeeded')
          assert.equal(capture.preview('patch'), undefined)
        }
      }
      assert.equal(observed, true)
      assert.equal(allocations.size, 1)
      if (fault !== 'success') {
        assert.equal(faultInjected, true)
        // Observe the helper's full allocation before any caller closes a packet.
        zeroed(allocations)
      }
      capture?.close()
      zeroed(allAllocations)
    } finally {
      capture?.close()
      read.mockRestore()
      stat.mockRestore()
      close.mockRestore()
    }
  }
}

// A throwing close cannot replace the original file-read failure.
{
  const { directory } = fixture('primary-file-error')
  const root = privateOpenFileRoot(directory)
  const originalFailure = new Error('primary read failure')
  const allocations = new Set<Buffer>()
  const read = spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
    ;(actualRead as any)(...args)
    allocations.add(args[1])
    throw originalFailure
  }) as any)
  const close = spyOn(fs, 'closeSync').mockImplementation((fd) => {
    actualClose(fd)
    throw new Error('secondary file-close failure')
  })
  try {
    assert.throws(
      () => privateReadRegularFile(root, 'result.json', 4096),
      (error) => error === originalFailure,
    )
    assert.equal(allocations.size, 1)
    zeroed(allocations)
  } finally {
    read.mockRestore()
    close.mockRestore()
    actualClose(root)
  }
}

for (const failedClose of ['files', 'root', 'both', 'interrupted', 'abort-on-close'] as const) {
  const { directory } = fixture(`directory-close-${failedClose}`)
  const rootInode = fs.statSync(directory, { bigint: true }).ino
  const filesInode = fs.statSync(join(directory, 'files'), { bigint: true }).ino
  const allocations = new Set<Buffer>()
  const closedDirectories: string[] = []
  const controller = new AbortController()
  const interruption = new Error('original external interruption')
  const read = spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
    const count = (actualRead as any)(...args)
    allocations.add(args[1])
    if (failedClose === 'interrupted' && count > 0 && args[1].includes(artifactText))
      controller.abort(interruption)
    return count
  }) as any)
  const close = spyOn(fs, 'closeSync').mockImplementation((fd) => {
    const value = actualStat(fd, { bigint: true })
    const kind = value.isDirectory()
      ? value.ino === rootInode
        ? 'root'
        : value.ino === filesInode
          ? 'files'
          : undefined
      : undefined
    actualClose(fd)
    if (kind !== undefined) {
      closedDirectories.push(kind)
      assert.throws(() => actualStat(fd), { code: 'EBADF' })
      if (failedClose === 'abort-on-close') controller.abort(interruption)
      if (kind === failedClose || failedClose === 'both' || failedClose === 'interrupted')
        throw new Error(`injected ${kind} final-close failure`)
    }
  })
  try {
    assert.throws(
      () => privateCaptureSavedResult(directory, controller.signal),
      failedClose === 'interrupted' || failedClose === 'abort-on-close'
        ? (error) => error === interruption
        : /valid result.json/,
    )
    assert.deepEqual(closedDirectories, ['files', 'root'])
    assert.equal(allocations.size, 2)
    zeroed(allocations)
  } finally {
    read.mockRestore()
    close.mockRestore()
  }
}

console.log('saved capture buffer ownership and collective cleanup passed')
