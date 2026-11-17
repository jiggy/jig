import { describe, test } from 'bun:test'
import {
  qualifyCodexFirstTurn,
  qualifyCodexInstalledConversation,
} from '../fixtures/codex-responses-qualification.js'

const openRouterBaseURL = 'https://openrouter.ai/api/v1'
const openAIBaseURL = 'https://api.openai.com/v1'
const baseURL = process.env.JIG_NATIVE_API_BASE_URL ?? openRouterBaseURL
const options = {
  codexPath: process.env.JIG_CODEX_PROOF_PATH,
  // The trusted qualification runner selects exactly one credential and
  // endpoint. The native client cannot choose or switch provider accounts.
  apiKey:
    process.env.JIG_NATIVE_API_KEY ??
    (baseURL === openRouterBaseURL ? process.env.OPENROUTER_API_KEY : undefined),
  model: process.env.JIG_CODEX_RESPONSES_MODEL,
  baseURL,
}
if (
  !(
    process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  ) ||
  !options.codexPath ||
  !options.apiKey ||
  !options.model ||
  (baseURL !== openRouterBaseURL && baseURL !== openAIBaseURL)
)
  throw Error(
    'Selected native Codex API proof requires its host, executable, model, API key, and supported endpoint',
  )
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
