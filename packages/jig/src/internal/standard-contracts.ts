import { USER_UPDATES_CONTRACT } from '@jigging/user-updates'
import publicUpdates from '../../../../docs/jig/spec/contracts/acp-public-updates.json' with {
  type: 'json',
}
import { parseChannelContract } from '../channel-contract.js'
import { canonicalJson, type JsonValue } from '../json.js'
import { markdownAgentContract } from './markdown-agent-contract.js'
import { FINITE_ACP_CONTRACT_DIGEST } from './private-finite-acp-contract.js'
import { HTTP_REQUEST_CONTRACT_DIGEST } from './private-http-request.js'
import { PROJECT_COMMAND_CONTRACT_DIGEST } from './private-project-command.js'
import { RUN_CHECKPOINT_CONTRACT_DIGEST } from './private-run-checkpoint.js'

/** Installed agreements only: names never select implementations or grant authority. */
export const JIG_STANDARD_CONTRACTS = Object.freeze(
  [
    {
      name: 'agent-run',
      kind: 'invocation',
      file: 'contract.json',
      digest: markdownAgentContract().digest,
      description: 'Ask an operator-selected AI assistant for a bounded response.',
    },
    {
      name: 'project-command',
      kind: 'invocation',
      file: 'contract.json',
      digest: PROJECT_COMMAND_CONTRACT_DIGEST,
      description: 'Run a reviewed project command and collect its evidence.',
    },
    {
      name: 'http-request',
      kind: 'invocation',
      file: 'contract.json',
      digest: HTTP_REQUEST_CONTRACT_DIGEST,
      description: 'Make a request through an operator-reviewed HTTP grant.',
    },
    {
      name: 'run-checkpoint',
      kind: 'invocation',
      file: 'contract.json',
      digest: RUN_CHECKPOINT_CONTRACT_DIGEST,
      description: 'Save settled results while other work continues.',
    },
    {
      name: 'finite-acp',
      kind: 'invocation',
      file: 'contract.json',
      digest: FINITE_ACP_CONTRACT_DIGEST,
      description: 'Use one bounded, operator-selected ACP conversation.',
    },
    {
      name: 'acp-public-updates',
      kind: 'channel',
      file: 'acp-public-updates.json',
      digest: parseChannelContract(canonicalJson(publicUpdates as JsonValue)).digest,
      description: 'Observe the public updates supplied by an AI client.',
    },
    {
      name: 'user-updates',
      kind: 'channel',
      file: 'user-updates.json',
      digest: USER_UPDATES_CONTRACT.digest,
      description: 'Report complete messages and current activity while a Flow works.',
    },
  ].map((entry) => Object.freeze(entry)),
)

export function standardContract(selector: string) {
  return JIG_STANDARD_CONTRACTS.find((entry) => `jig:${entry.name}` === selector)
}
