import { describe, test } from 'bun:test'
import {
  qualifyCodexFirstTurn,
  qualifyCodexInstalledConversation,
} from '../fixtures/codex-responses-qualification.js'

const options = {
  codexPath: process.env.JIG_CODEX_PROOF_PATH,
  // The trusted qualification runner selects exactly one credential and
  // endpoint. The native client cannot choose or switch provider accounts.
  apiKey: process.env.JIG_NATIVE_API_KEY ?? process.env.OPENROUTER_API_KEY,
  model: process.env.JIG_CODEX_RESPONSES_MODEL,
  baseURL: process.env.JIG_NATIVE_API_BASE_URL ?? 'https://openrouter.ai/api/v1',
}
if (
  !(
    process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  ) ||
  !options.codexPath ||
  !options.apiKey ||
  !options.model
)
  throw Error('Selected native Codex API proof requires its host, executable, model, and API key')
const selected = options as { codexPath: string; apiKey: string; model: string; baseURL: string }
describe.serial('private contained Agent Run lifecycle', () => {
  test(
    'executes the ordinary ACP Agent with native Codex through ACP with a Responses-compatible endpoint',
    () => qualifyCodexFirstTurn(selected),
    180_000,
  )
  test(
    'interrupts an immediate follow-up through the frozen installed candidate with a Responses-compatible endpoint',
    () => qualifyCodexInstalledConversation(selected),
    360_000,
  )
})
