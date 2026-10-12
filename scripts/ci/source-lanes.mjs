import { spawn } from 'node:child_process'
import { closeSync, lstatSync, openSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FUNCTIONS = ['source_portable_lane', 'source_other_lane']
const TARGETS = ['source-portable', 'source-protocol', 'source-applications', 'source-python']
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

function groupExists(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

// These are the two trusted functions exported by test-release.sh, not a command API.
export async function runSourceLanes({
  directory,
  env = process.env,
  platform = process.platform,
  signals = process,
}) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.JIG_CI_SOURCE_PARALLEL !== '1')
    throw new Error('Parallel source lanes require the explicit Linux CI opt-in')
  const targets = (env.source_targets ?? '').split(',')
  if (
    new Set(targets).size !== targets.length ||
    targets.some((target) => !TARGETS.includes(target)) ||
    !targets.includes('source-portable') ||
    !targets.some((target) => target !== 'source-portable')
  )
    throw new Error('Parallel source lanes require two nonempty selected lanes')
  for (const name of FUNCTIONS) {
    const exported = env[`BASH_FUNC_${name}%%`] ?? env[`BASH_FUNC_${name}()`] ?? env[name]
    if (typeof exported !== 'string' || !exported.startsWith('() {'))
      throw new Error('Parallel source lane functions are missing')
  }
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink() ||
    readdirSync(directory).length
  )
    throw new Error('Parallel source lane destination must be a fresh owned directory')

  const lanes = []
  let cancellation = 0
  let unsettled = false
  async function stop(lane) {
    if (!lane.pid) return
    if (lane.stopping) return lane.stopping
    lane.stopping = (async () => {
      const signal = (value) => {
        try {
          process.kill(-lane.pid, value)
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      signal('SIGTERM')
      const graceful = Date.now() + 500
      while (groupExists(lane.pid) && Date.now() < graceful) await pause(20)
      if (groupExists(lane.pid)) signal('SIGKILL')
      const deadline = Date.now() + 5000
      while (groupExists(lane.pid) && Date.now() < deadline) await pause(20)
      if (groupExists(lane.pid)) throw new Error('Source lane descendants did not settle')
    })().catch(() => {
      unsettled = true
    })
    return lane.stopping
  }
  const cancel = (number) => {
    cancellation ||= number
    for (const lane of lanes) void stop(lane)
  }
  const handlers = {
    SIGINT: () => cancel(130),
    SIGTERM: () => cancel(143),
    SIGHUP: () => cancel(129),
  }
  for (const [name, handler] of Object.entries(handlers)) signals.on(name, handler)
  let launchFailure = false
  try {
    for (const name of FUNCTIONS) {
      const fd = openSync(join(directory, `${name}.txt`), 'wx', 0o600)
      let child
      try {
        child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', `set -eu; ${name}`], {
          env: { ...env, BASH_ENV: '', ENV: '' },
          detached: true,
          stdio: ['ignore', fd, fd],
        })
      } finally {
        closeSync(fd)
      }
      const lane = { pid: child.pid, name }
      lanes.push(lane)
      lane.done = new Promise((done) => {
        child.once('error', () => done({ code: 1, spawnFailure: true }))
        child.once('exit', (code, signal) => done({ code: code ?? 1, signal }))
      })
        .then(async (result) => {
          if (lane.pid && groupExists(lane.pid)) {
            // A successful shell must not leave an orphan alive behind closed stdio.
            if (!cancellation) result.orphan = true
            await stop(lane)
          }
          return result
        })
        .catch(async () => {
          launchFailure = true
          for (const current of lanes) void stop(current)
          await stop(lane)
          return { code: 1 }
        })
    }
  } catch {
    launchFailure = true
    for (const lane of lanes) void stop(lane)
  }
  try {
    const results = await Promise.all(lanes.map((lane) => lane.done))
    await Promise.all(lanes.map((lane) => lane.stopping))
    if (unsettled)
      throw new Error('Source lane settlement is unconfirmed; retain the temporary workspace')
    for (const lane of lanes)
      if (lane.pid && groupExists(lane.pid))
        throw new Error('Source lane settlement is unconfirmed; retain the temporary workspace')
    // Only this marker permits the owning shell to remove its temporary workspace.
    writeFileSync(join(directory, 'lanes-settled'), 'Source lane process groups settled.\n', {
      flag: 'wx',
      mode: 0o600,
    })
    return {
      exitCode:
        cancellation ||
        (launchFailure ? 1 : results.find((result) => result.code !== 0)?.code) ||
        (results.some((result) => result.orphan) ? 1 : 0),
    }
  } finally {
    for (const [name, handler] of Object.entries(handlers)) signals.removeListener(name, handler)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--directory')
      throw new Error('Expected --directory for the two fixed source lanes')
    process.exitCode = (await runSourceLanes({ directory: resolve(process.argv[3]) })).exitCode
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
