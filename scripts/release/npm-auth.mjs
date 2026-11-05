// Package-specific npm trusted-publisher exchange. Never persist returned tokens.
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLISHED_PACKAGES } from './catalog.mjs'

async function boundedJson(response) {
  const reader = response.body?.getReader()
  if (!reader) throw Error('Authentication response has no body')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 32_768) throw Error('Authentication response exceeds its bound')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
  }
}

// Explicit endpoints allow real local HTTP protocol tests. The CLI supplies fixed npm endpoints.
export async function checkNpmIdentity({ requestUrl, requestToken, registry, names }) {
  const signal = AbortSignal.timeout(30_000)
  const url = new URL(requestUrl)
  url.searchParams.set('audience', `npm:${new URL(registry).hostname}`)
  const identity = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' },
    signal,
    redirect: 'error',
  })
  if (!identity.ok) throw Error(`GitHub OIDC request failed (HTTP ${identity.status})`)
  const value = await boundedJson(identity)
  if (typeof value.value !== 'string' || !value.value)
    throw Error('GitHub OIDC response is missing its token')
  const results = []
  for (const name of names) {
    // npm-package-arg uses an unescaped scope marker and an escaped slash.
    const escaped = name.replaceAll('/', '%2f')
    const response = await fetch(
      new URL(`/-/npm/v1/oidc/token/exchange/package/${escaped}`, registry),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${value.value}` },
        signal,
        redirect: 'error',
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      results.push({ name, accepted: false, status: response.status })
      continue
    }
    const exchange = await boundedJson(response)
    results.push({
      name,
      accepted: typeof exchange.token === 'string' && exchange.token.length > 0,
      status: response.status,
    })
  }
  return results
}

async function main() {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  )
    throw Error(
      'Run npm authentication diagnostics from npm-publish.yml on main with id-token permission',
    )
  const results = await checkNpmIdentity({
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    registry: 'https://registry.npmjs.org',
    names: PUBLISHED_PACKAGES.map(({ name }) => name),
  })
  const summary =
    '## npm authentication preflight\n\n' +
    results
      .map(
        ({ name, accepted, status }) =>
          `- ${name}: ${accepted ? 'accepted' : 'refused'} (HTTP ${status})`,
      )
      .join('\n') +
    '\n\nThis checks package-specific identity exchange. It publishes no version and establishes neither provenance nor release readiness.\n'
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  if (results.some(({ accepted }) => !accepted))
    throw Error(
      'npm refused at least one package identity. Check its trusted publisher repository, workflow and environment.',
    )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    // Never print response bodies, fetch causes or credential-bearing request URLs.
    console.error(
      error instanceof Error &&
        /^(Run npm|GitHub OIDC|Authentication response|npm refused)/.test(error.message)
        ? error.message
        : 'npm authentication preflight failed without publishing',
    )
    process.exitCode = 1
  }
}
