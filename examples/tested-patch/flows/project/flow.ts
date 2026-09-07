import { handle } from '@jigging/flow'
import { repairFiles } from './files.ts'
import { repairBatch } from './batch.ts'

await handle((run) =>
  run.input !== null && typeof run.input === 'object' && Object.hasOwn(run.input, 'jobs')
    ? repairBatch(run)
    : repairFiles(run),
)
