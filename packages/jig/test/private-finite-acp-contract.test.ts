import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parseInvocationContract } from '../src/invocation-contract.js'
import {
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
  FINITE_ACP_CONTRACT_DIGEST,
} from '../src/internal/private-finite-acp-contract.js'

test('finite ACP grants pin the complete public invocation and channel closure', async () => {
  const root = new URL('../../../docs/jig/spec/contracts/finite-acp/', import.meta.url)
  const closure = new Map(
    await Promise.all(
      ['requests.json', 'responses.json'].map(
        async (name) => [name, await readFile(new URL(name, root))] as const,
      ),
    ),
  )
  const contract = parseInvocationContract(
    await readFile(new URL('contract.json', root)),
    'contract.json',
    closure,
  )
  expect(contract.descriptor.id).toBe(FINITE_ACP_CONTRACT_ID)
  expect(contract.descriptor.version).toBe(FINITE_ACP_CONTRACT_VERSION)
  expect(contract.digest).toBe(FINITE_ACP_CONTRACT_DIGEST)
  expect(contract.invocation?.channels).toEqual({
    requests: { direction: 'receive', required: true, contract: './requests.json' },
    responses: { direction: 'send', required: true, contract: './responses.json' },
  })
})
