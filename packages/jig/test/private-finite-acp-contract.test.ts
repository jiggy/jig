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
  const mirror = new URL('../../agent-acp/contracts/finite-acp/', import.meta.url)
  for (const name of ['contract.json', 'requests.json', 'responses.json'])
    expect(await readFile(new URL(name, mirror))).toEqual(await readFile(new URL(name, root)))
  const input = contract.schemas.get('/input')!
  const result = contract.schemas.get('/result')!
  const reference = '013579ab-cdef-4567-89ab-0123456789ab'
  input.validate(null)
  for (const session of [{ retain: true }, { restore: reference }]) input.validate({ session })
  for (const value of [
    {},
    { session: {} },
    { session: { retain: false } },
    { session: { retain: true, restore: reference } },
  ])
    expect(() => input.validate(value)).toThrow()
  for (const session of [{ status: 'retained', reference }, { status: 'unavailable' }])
    result.validate({
      outcome: 'done',
      output: { exitCode: 0, signal: null, cleanup: 'complete', stopReason: 'exited', session },
    })
  contract.channelContracts.get('responses.json')!.itemSchema.validate({
    kind: 'ready',
    protocolVersion: 1,
    cwd: '/work',
    configuration: [],
    maxTurns: 1,
    restoreSessionId: 'owned-session',
  })
  expect(contract.invocation?.channels).toEqual({
    requests: { direction: 'receive', required: true, contract: './requests.json' },
    responses: { direction: 'send', required: true, contract: './responses.json' },
  })
})
