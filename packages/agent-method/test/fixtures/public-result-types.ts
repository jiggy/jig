import { type AgentResult, checkAgentResult } from '@jigging/agent-method'
import type { JsonValue, RunHandler } from '@jigging/flow'

const result: AgentResult = checkAgentResult({ outcome: 'done', output: { text: 'answer' } })
const direct: JsonValue = result
const nested: JsonValue = { agent: result }
const handler: RunHandler = async () => ({ outcome: 'done', output: result })

void [direct, nested, handler]

// @ts-expect-error Functions are not JSON values.
const functionOutput: JsonValue = () => 'answer'
// @ts-expect-error Undefined is not a JSON value.
const undefinedOutput: JsonValue = undefined
// @ts-expect-error Error objects are not JSON values.
const errorOutput: JsonValue = new Error('unhandled')
void [functionOutput, undefinedOutput, errorOutput]
