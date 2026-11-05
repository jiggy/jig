import type { FlowCall, JsonValue, RunResult } from '@jigging/flow'
import { checkRoutingResult, routingInput } from '@jigging/semantic-router'

const input = routingInput({ task: 'Finish.', candidates: [{ id: 'finish', description: 'Finish a draft.' }] })
const call: FlowCall = { operationId: 'choose', slot: 'router', input }
const result = checkRoutingResult({ outcome: 'done', output: { candidateId: 'finish', reason: 'Fits.' } }, input.candidates)
const json: JsonValue = input
const runResult: RunResult = result
void [call, json, runResult]
