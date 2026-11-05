import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import {
  qualifyCodexFirstTurn,
  qualifyCodexInstalledConversation,
} from '../fixtures/codex-responses-qualification.js'
import { startExampleSmokeApi } from '../fixtures/example-smoke-api.js'

const codexPath = process.env.JIG_EXAMPLE_CODEX_PATH
const certFile = process.env.JIG_EXAMPLE_API_CERT
const keyFile = process.env.JIG_EXAMPLE_API_KEY
if (process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1' || !codexPath || !certFile || !keyFile)
  throw Error(
    'Native Codex rehearsal requires its qualified Linux host, genuine client and trusted TLS peer',
  )
const selected = { codexPath, certFile, keyFile } as {
  codexPath: string
  certFile: string
  keyFile: string
}
const model = 'jig-native-rehearsal'
const token = 'synthetic-rehearsal-credential'

describe.serial('genuine Codex release sequence without provider credentials', () => {
  test('initial response, installed follow-up, immediate interruption and settlement', async () => {
    const first = await startExampleSmokeApi({
      ...selected,
      model,
      token,
      expectedRequests: 1,
      reply: () => 'READY',
    })
    try {
      await qualifyCodexFirstTurn({
        codexPath: selected.codexPath,
        apiKey: token,
        model,
        baseURL: first.baseURL,
      })
      first.assertConsumed()
    } finally {
      await first.close()
    }
    const conversation = await startExampleSmokeApi({
      ...selected,
      model,
      token,
      expectedRequests: 2,
      minimumRequests: 1,
      allowInterruptedResponse: true,
      reply: () => 'Hello.',
    })
    try {
      await qualifyCodexInstalledConversation({
        codexPath: selected.codexPath,
        apiKey: token,
        model,
        baseURL: conversation.baseURL,
      })
      conversation.assertConsumed()
    } finally {
      await conversation.close()
    }
  }, 540_000)

  test('genuine native process loss fails visibly and settles owned work', async () => {
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    const expected = digest(await readFile(selected.codexPath))
    let killed = 0
    const peer = await startExampleSmokeApi({
      ...selected,
      model,
      token,
      expectedRequests: 1,
      allowInterruptedResponse: true,
      reply: async () => {
        const matching: number[] = []
        for (const entry of await readdir('/proc')) {
          if (!/^[1-9][0-9]*$/.test(entry)) continue
          const base = `/proc/${entry}`
          try {
            if (!(await readFile(`${base}/cmdline`, 'utf8')).split('\0').includes('app-server'))
              continue
            if (digest(await readFile(`${base}/exe`)) === expected) matching.push(Number(entry))
          } catch (error) {
            if (
              !['ENOENT', 'EACCES', 'EPERM', 'ESRCH'].includes(
                (error as NodeJS.ErrnoException).code ?? '',
              )
            )
              throw error
          }
        }
        expect(matching).toHaveLength(1)
        process.kill(matching[0]!, 'SIGKILL')
        killed++
        return 'READY'
      },
    })
    try {
      await qualifyCodexFirstTurn({
        codexPath: selected.codexPath,
        apiKey: token,
        model,
        baseURL: peer.baseURL,
        expectedFailure: true,
      })
      expect(killed).toBe(1)
    } finally {
      await peer.close()
    }
  }, 240_000)

  for (const transportFailure of ['http429', 'malformed', 'disconnect'] as const) {
    test(`${transportFailure} fails visibly and leaves no owned native work`, async () => {
      const peer = await startExampleSmokeApi({
        ...selected,
        model,
        token,
        expectedRequests: 32,
        minimumRequests: 1,
        transportFailure,
        reply: () => 'unreachable',
      })
      try {
        await qualifyCodexFirstTurn({
          codexPath: selected.codexPath,
          apiKey: token,
          model,
          baseURL: peer.baseURL,
          expectedFailure: true,
        })
        peer.assertConsumed()
      } finally {
        await peer.close()
      }
    }, 240_000)
  }
})
