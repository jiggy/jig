import { expect, test } from 'bun:test'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readPrivateCapturedOutput,
  requirePrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import {
  capturePrivateFlowArtifact,
  commitPrivateFlowArtifact,
  createPrivateChildFlowFileContext,
  createPrivateRootFlowFileContext,
  planPrivateChildFlowFiles,
  privateFlowFileExecutionProjection,
  releasePrivateFlowArtifact,
  resolvePrivateFlowArtifact,
  selectedPrivateFlowArtifacts,
} from '../../src/internal/flow-file-context.js'
import { readPrivateCapturedInput } from '../../src/internal/input-capture.js'
import { PrivateRootRunFiles } from '../../src/internal/root-run-files.js'

test('fresh operation outputs seal distinct immutable trees and explicitly delegate read-only views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-artifact-'))
  const root = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  const stranger = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  const files = new PrivateRootRunFiles([], false)
  const source = await open(directory)
  try {
    const make = async (revision: string) => {
      const producer = createPrivateChildFlowFileContext(
        planPrivateChildFlowFiles({
          caller: root,
          declarations: { files: 'read-write' },
          mapping: { files: { create: true } },
          attachments: { files: { create: true } },
        }),
      )
      expect(privateFlowFileExecutionProjection(producer).plan.output).toBe(true)
      await writeFile(join(directory, 'candidate.txt'), revision)
      const snapshot = await capturePrivateFlowArtifact(root, {
        kind: 'linux-directory',
        directory: source,
      })
      // Only native cleanup's controller continuation calls commit.
      expect(() => resolvePrivateFlowArtifact(root, snapshot.digest)).toThrow('does not hold')
      producer.close()
      return { snapshot, reference: commitPrivateFlowArtifact(root, snapshot) }
    }
    const p1 = await make('revision=1')
    const p2 = await make('revision=2')
    expect(p1.reference).not.toBe(p2.reference)
    expect(readPrivateCapturedOutput(p1.snapshot)[0]!.contents.toString()).toBe('revision=1')
    const evaluate = (reference: string) =>
      createPrivateChildFlowFileContext(
        planPrivateChildFlowFiles({
          caller: root,
          declarations: { candidate: 'read' },
          mapping: { candidate: { supplied: 'read' } },
          attachments: { candidate: { read: reference } },
        }),
      )
    const e1 = evaluate(p1.reference)
    const e2 = evaluate(p2.reference)
    const view1 = privateFlowFileExecutionProjection(e1)
    const view2 = privateFlowFileExecutionProjection(e2)
    expect(view1.plan.output).toBe(false)
    expect(readPrivateCapturedInput(view1.plan.capturedInputs![0]!.input).toString()).toBe(
      'revision=1',
    )
    expect(readPrivateCapturedInput(view2.plan.capturedInputs![0]!.input).toString()).toBe(
      'revision=2',
    )
    expect(() => resolvePrivateFlowArtifact(stranger, p1.reference)).toThrow('does not hold')
    expect(() => selectedPrivateFlowArtifacts(root, ['final'], { unknown: p2.reference })).toThrow(
      'not declared',
    )
    expect(selectedPrivateFlowArtifacts(root, ['final'], {})).toEqual({})
    files.retainArtifacts(root, ['final'], { final: p2.reference })
    expect(files.artifacts.final).toBe(p2.snapshot)
    releasePrivateFlowArtifact(root, p1.reference)
    expect(() => evaluate(p1.reference)).toThrow('does not hold')
    // A release cannot retract already accepted readers.
    expect(readPrivateCapturedInput(view1.plan.capturedInputs![0]!.input).toString()).toBe(
      'revision=1',
    )
    e1.close()
    e2.close()
    root.close()
    expect(() => requirePrivateCapturedOutput(p1.snapshot)).toThrow()
    expect(requirePrivateCapturedOutput(p2.snapshot).bytes).toBe(10)
    await files.close()
    expect(() => requirePrivateCapturedOutput(p2.snapshot)).toThrow()
  } finally {
    root.close()
    stranger.close()
    await files.close()
    await source.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('artifact snapshot count is bounded for the whole root, including ungranted captures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-artifact-bound-'))
  const source = await open(directory)
  const root = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  try {
    for (let index = 0; index < 16; index++)
      await capturePrivateFlowArtifact(root, { kind: 'linux-directory', directory: source })
    await expect(
      capturePrivateFlowArtifact(root, { kind: 'linux-directory', directory: source }),
    ).rejects.toThrow('limit')
  } finally {
    root.close()
    await source.close()
    await rm(directory, { recursive: true, force: true })
  }
})
