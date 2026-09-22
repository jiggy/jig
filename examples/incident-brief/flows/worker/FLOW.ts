import { handle } from '@jigging/flow'
import { work } from './work.ts'
await handle((run) => work(run))
