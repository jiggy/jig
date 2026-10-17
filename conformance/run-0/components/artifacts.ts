import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handle, OperationError } from '../../../packages/flow-sdk/src/index'

await handle(async (run) => {
  const input = run.input as { role: string; revision?: number }
  if (input.role === 'produce') {
    await writeFile(
      join(run.attachments.files!.path, 'candidate.txt'),
      `revision=${input.revision}\n`,
    )
    return { outcome: 'done', output: { revision: input.revision! } }
  }
  if (input.role === 'evaluate') {
    const text = await readFile(join(run.attachments.candidate!.path, 'candidate.txt'), 'utf8')
    return { outcome: 'done', output: { matches: text === `revision=${input.revision}\n` } }
  }
  const request = {
    operationId: 'p1',
    slot: 'producer',
    input: { role: 'produce', revision: 1 },
    attachments: { files: { create: true } },
  } as const
  const p1 = await run.call(request)
  const s1 = p1.artifacts!.files!
  const p2 = await run.call({
    ...request,
    operationId: 'p2',
    input: { role: 'produce', revision: 2 },
  })
  const s2 = p2.artifacts!.files!
  const readers = await Promise.all(
    [1, 2].map((i) =>
      run.call({
        operationId: `e${i}`,
        slot: 'evaluator',
        input: { role: 'evaluate', revision: i },
        attachments: { candidate: { read: i === 1 ? s1 : s2 } },
      }),
    ),
  )
  const sibling = await run.call({
    operationId: 'sibling',
    slot: 'evaluator',
    input: { role: 'evaluate', revision: 1 },
    attachments: { candidate: { read: s1 } },
  })
  const duplicate = await run.call(request)
  let conflicts = 0
  try {
    await run.call({ ...request, input: { role: 'produce', revision: 9 } })
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'OPERATION_CONFLICT') throw error
    conflicts++
  }
  try {
    await run.call({
      operationId: 'e1',
      slot: 'evaluator',
      input: { role: 'evaluate', revision: 1 },
      attachments: { candidate: { read: s2 } },
    })
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'OPERATION_CONFLICT') throw error
    conflicts++
  }
  try {
    await run.call({
      operationId: 'unknown-port',
      slot: 'evaluator',
      input: null,
      attachments: { unknown: { read: s1 } },
    })
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'INVALID_INPUT') throw error
    conflicts++
  }
  // Delegate the initially granted immutable source without using its path.
  const initial = await run.call({
    operationId: 'initial',
    slot: 'evaluator',
    input: { role: 'evaluate', revision: 0 },
    attachments: { candidate: { read: run.attachments.source!.artifact! } },
  })
  await run.release({ operationId: 'release:1', artifact: s1 })
  const replay = await run.call({
    operationId: 'e1',
    slot: 'evaluator',
    input: { role: 'evaluate', revision: 1 },
    attachments: { candidate: { read: s1 } },
  })
  if (!(replay.output as { matches: boolean }).matches)
    throw new Error('released exact replay changed')
  let released = false
  try {
    await run.call({
      operationId: 'released',
      slot: 'evaluator',
      input: null,
      attachments: { candidate: { read: s1 } },
    })
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'PERMISSION_DENIED') throw error
    released = true
  }
  return {
    outcome: 'done',
    output: {
      matches: [...readers, sibling, initial].every(
        (result) => (result.output as { matches: boolean }).matches,
      ),
      duplicate: duplicate.artifacts!.files === s1,
      distinct: s1.reference !== s2.reference,
      conflicts,
      released,
    },
    artifactResults: { final: s2 },
  }
})
