import { expect, test } from 'bun:test'
import { closeSync, fstatSync } from 'node:fs'
import { mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  capturePrivateOutput,
  PrivateOutputProfileError,
  readPrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import {
  closePrivateExecutionDirectory,
  closePrivateExecutionOutput,
  isPrivateOutputRetirementUnconfirmed,
  privateSnapshotExecutionOutput,
  resolvePrivateExecutionOutput,
} from '../../src/internal/execution-output.js'
import { privateOpenFileRoot } from '../../src/internal/file-input.js'

// Writer-free owned directories establish descriptor/snapshot behavior, not
// native fencing, collector handoff or storage cleanup.
test('directory source close joins the original handle and closes its real descriptor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-output-loan-'))
  const directory = await open(root)
  const fd = directory.fd
  try {
    const output = { kind: 'linux-directory' as const, directory }
    expect(await resolvePrivateExecutionOutput(output)).toBe(directory)
    const first = closePrivateExecutionOutput(output)
    expect(closePrivateExecutionOutput({ ...output })).toBe(first)
    await first
    await closePrivateExecutionOutput(output)
    expect(() => fstatSync(fd)).toThrow()
  } finally {
    await directory.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('authentic snapshot survives source removal and retires through its original handle', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-output-snapshot-')))
  const source = join(root, 'source')
  await mkdir(source)
  await mkdir(join(source, 'empty'))
  await writeFile(join(source, 'result'), Buffer.from([0, 255, 128]))
  const fd = privateOpenFileRoot(source)
  try {
    const capture = capturePrivateOutput(fd)
    const output = privateSnapshotExecutionOutput(Promise.resolve(capture))
    try {
      await rm(source, { recursive: true })
      expect(await resolvePrivateExecutionOutput(output)).toBe(capture)
      expect(capture.directories).toEqual(['empty'])
      expect(readPrivateCapturedOutput(capture).map(({ contents }) => [...contents])).toEqual([
        [0, 255, 128],
      ])
      await Promise.all([
        closePrivateExecutionOutput(output),
        closePrivateExecutionOutput({ ...output }),
      ])
      expect(() => readPrivateCapturedOutput(capture)).toThrow('not active')
      await closePrivateExecutionOutput(output)
    } finally {
      capture.close()
    }
  } finally {
    closeSync(fd)
    await rm(root, { recursive: true, force: true })
  }
})

test('actual profile refusal remains collection failure, not snapshot retirement failure', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-output-profile-')))
  await mkdir(join(root, '.jig'))
  const fd = privateOpenFileRoot(root)
  try {
    const output = privateSnapshotExecutionOutput(
      Promise.resolve().then(() => capturePrivateOutput(fd)),
    )
    await expect(resolvePrivateExecutionOutput(output)).rejects.toBeInstanceOf(
      PrivateOutputProfileError,
    )
    await closePrivateExecutionOutput(output)
    await closePrivateExecutionOutput({ ...output })
    expect(fstatSync(fd).isDirectory()).toBe(true)
  } finally {
    closeSync(fd)
    await rm(root, { recursive: true, force: true })
  }
})

test('actual descriptor retirement failure stays sticky through nested cleanup aggregates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-output-retirement-failure-'))
  const directory = await open(root)
  try {
    // Lose the actual descriptor without replacing the FileHandle or its closer.
    closeSync(directory.fd)
    const first = closePrivateExecutionDirectory(directory)
    const outcome = await first.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(isPrivateOutputRetirementUnconfirmed(outcome)).toBeTrue()
    expect(closePrivateExecutionDirectory(directory)).toBe(first)
    const nested = new AggregateError([
      new Error('capture refused'),
      new AggregateError([outcome, new Error('snapshot retirement refused')]),
    ])
    expect(isPrivateOutputRetirementUnconfirmed(nested)).toBeTrue()
    expect(
      isPrivateOutputRetirementUnconfirmed(new AggregateError([new Error('capture refused')])),
    ).toBeFalse()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
