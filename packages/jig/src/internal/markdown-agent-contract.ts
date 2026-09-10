import descriptor from '../../../../docs/jig/spec/contracts/agent-run/contract.json' with {
  type: 'json',
}
import updates from '../../../../docs/jig/spec/contracts/agent-run/contracts/acp-public-updates.json' with {
  type: 'json',
}
import { parseInvocationContract } from '../invocation-contract.js'
import { canonicalJson, type JsonValue } from '../json.js'

/** Interpreter profile requirement; neither its name nor its descriptor grants authority. */
export const MARKDOWN_AGENT_SLOT = 'markdown-agent'

export function markdownAgentContract() {
  return parseInvocationContract(
    canonicalJson(descriptor as JsonValue),
    'Markdown Agent contract',
    new Map([['contracts/acp-public-updates.json', canonicalJson(updates as JsonValue)]]),
  )
}
