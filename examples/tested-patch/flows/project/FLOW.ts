import { handle } from '@jigging/flow'
import { repairBatch } from './batch.ts'
import { repairFiles } from './files.ts'

await handle((run) =>
  run.input !== null && typeof run.input === 'object' && Object.hasOwn(run.input, 'jobs')
    ? repairBatch(run)
    : repairFiles(run),
)
