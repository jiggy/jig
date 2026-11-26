import { readFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostScope } from './host-scope.mjs'

export const MAC_PYTHON_MAJOR = 15
export const MAC_PYTHON_SHARD = 0
export const MAC_PYTHON_PROFILE = `macos-${MAC_PYTHON_MAJOR}/python-3.14`

export const pythonInstalledProfiles = Object.freeze(
  JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url))).targets.find(
    ({ id }) => id === 'python-installed',
  ).profiles,
)

export function pythonInstalledJob(profile) {
  const [os, python] = profile.split('/python-')
  return `Python ${python} on ${os}`
}

export async function ciPythonProfiles({ env = process.env, ...context } = {}) {
  const native =
    env.GITHUB_EVENT_NAME === 'pull_request' &&
    (await hostScope({ ...context, env, scope: 'macos' })).required
  return pythonInstalledProfiles.filter((profile) => !native || profile !== MAC_PYTHON_PROFILE)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 || !process.env.GITHUB_OUTPUT)
      throw new Error('Set GITHUB_OUTPUT to receive the installed Python matrix')
    const include = (await ciPythonProfiles()).map((profile) => {
      const [os, python] = profile.split('/python-')
      return { os, python }
    })
    await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\n`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
