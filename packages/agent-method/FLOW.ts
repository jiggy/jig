import { runAgentFlow } from './dist/flow.js'

await runAgentFlow(new URL('./', import.meta.url))
