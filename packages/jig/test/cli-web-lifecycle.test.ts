import { afterEach, expect, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, privateCliCommandLifetimeMs } from '../src/cli.js'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { PrivateWebDisplay } from '../src/cli-web.js'
import type { PrivateWebAssets } from '../src/cli-web-assets.js'
import { PrivateWebInput } from '../src/cli-web-input.js'

const assets: PrivateWebAssets = {
  '/': { body: '<!doctype html><title>Test inspector</title>', contentType: 'text/html' },
  '/assets/app.js': { body: '/* inert test shell */', contentType: 'text/javascript' },
  '/assets/app.css': { body: 'body{}', contentType: 'text/css' },
}
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test('saved browser capture omits its directory and previews retained content', async () => {
  const packetPath = '/private/operator/selected-packet'
  let launch: string | undefined
  const progress = new PrivateCliProgress(
    true,
    async (text) => {
      launch ??= /http:\/\/127\.0\.0\.1:\d+\/#cap=[A-Za-z0-9_-]{43}/.exec(text)?.[0]
    },
    undefined,
    false,
    () => 80,
    (text) => text,
    { webAssets: assets },
  )
  let text = '+ captured evidence\n'
  const input = new Input()
  input.isTTY = false
  const task = progress.inspectSavedResult(
    {
      directory: packetPath,
      record: { status: 'succeeded', outcome: 'literal', output: null },
      files: [
        { path: 'review.patch', bytes: 20, digest: `sha256:${'a'.repeat(64)}`, available: true },
      ],
      complete: true,
      reportPreview: () => ({ text: '{}', bytes: 2, clipped: false }),
      preview: () => ({ text, bytes: 20, clipped: false }),
      close() {},
    },
    false,
    input as any,
    'web',
  )
  let url: URL | undefined
  try {
    url = new URL(await until(() => launch))
    const headers = { Authorization: `Bearer ${url.hash.slice(5)}` }
    const snapshot = (await (await fetch(url.origin + '/api/snapshot', { headers })).json()) as any
    expect(snapshot.workspace.target).toBe('Saved result packet')
    expect(JSON.stringify(snapshot)).not.toContain(packetPath)
    text = 'changed destination bytes'
    const file = snapshot.artifacts.files[0]
    const preview = (await (
      await fetch(url.origin + '/api/artifacts/' + file.id + '/preview', { headers })
    ).json()) as any
    expect(preview.text).toBe('+ captured evidence\n')
    expect(preview.artifactId).toBe(file.id)
    expect(preview.provenance).toBe('recorded-capture')
  } finally {
    if (url)
      await fetch(url.origin + '/api/close', {
        method: 'POST',
        headers: { Authorization: `Bearer ${url.hash.slice(5)}`, Origin: url.origin },
      })
    await task
    await progress.closeWorkspace()
    progress.close()
    await progress.flush()
  }
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'jig-web-lifecycle-'))
  directories.push(path)
  return path
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 3000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error('Lifecycle fixture timed out')
    await tick()
  }
}
class Input extends EventEmitter {
  isTTY = true
  isRaw = false
  readableFlowing: boolean | null = null
  rawChanges: boolean[] = []
  paused = true
  throwRaw = false
  isPaused() {
    return this.paused
  }
  setRawMode(value: boolean) {
    this.rawChanges.push(value)
    this.isRaw = value
    if (this.throwRaw && value) throw new Error('setup unavailable')
    return this
  }
  resume() {
    this.paused = false
    this.readableFlowing = true
    return this
  }
  pause() {
    this.paused = true
    this.readableFlowing = false
    return this
  }
}

test('web lifetime depends on terminal stderr; machine selection wins', () => {
  const args = ['run', 'flow:flows/work', '--display', 'web']
  expect(privateCliCommandLifetimeMs(args, false, true)).toBeNull()
  expect(privateCliCommandLifetimeMs(args, true, false)).toBe(330000)
  for (const mode of [['--json'], ['--receive', 'progress']])
    expect(privateCliCommandLifetimeMs([...args, ...mode], false, true)).toBe(330000)
})

test('web controls restore input and distinguish live cancellation from settled exit', async () => {
  for (const settled of [false, true]) {
    const input = new Input()
    let closed = 0,
      cancelled = 0
    const owner = new PrivateWebInput(
      input as any,
      () => closed++,
      () => cancelled++,
    )
    if (settled) owner.markSettled()
    expect(owner.start()).toBe(true)
    input.emit('data', Buffer.from('x'.repeat(5000) + '\u0003'))
    expect(cancelled).toBe(settled ? 0 : 1)
    expect(closed).toBe(1)
    expect(input.rawChanges).toEqual([true, false])
    expect(input.paused).toBe(true)
    expect(input.listenerCount('data')).toBe(0)
    owner.leave()
    expect(closed).toBe(1)
  }
  const piped = new Input()
  piped.isTTY = false
  expect(
    new PrivateWebInput(
      piped as any,
      () => {},
      () => {},
    ).start(),
  ).toBe(false)
  expect(piped.rawChanges).toEqual([])
  const throwing = new Input()
  throwing.throwRaw = true
  expect(
    new PrivateWebInput(
      throwing as any,
      () => {},
      () => {},
    ).start(),
  ).toBe(false)
  expect(throwing.rawChanges).toEqual([true, false])
  expect(throwing.paused).toBe(true)
  const flowing = new Input()
  flowing.isRaw = true
  flowing.resume()
  const owner = new PrivateWebInput(
    flowing as any,
    () => {},
    () => {},
  )
  owner.start()
  flowing.emit('data', Buffer.from('\u001b['))
  flowing.emit('data', Buffer.from('A'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(owner.active).toBe(true)
  flowing.emit('data', Buffer.from('q'))
  expect(flowing.isRaw).toBe(true)
  expect(flowing.paused).toBe(false)
})

test('initial refusal and machine modes advertise no browser or input ownership', async () => {
  const root = await directory()
  await writeFile(join(root, 'bad.json'), '{invalid')
  for (const scenario of [['--input', '@bad.json'], ['--json'], ['--receive', 'events']]) {
    const input = new Input()
    let advertised = false,
      started = false
    const code = await main(['run', 'flow:flows/work', '--display', 'web', ...scenario], {
      currentDirectory: root,
      terminalError: true,
      terminalOutput: false,
      interactive: true,
      dashboardInputStream: input as any,
      webAssets: assets,
      host: {
        async acquire() {
          started = true
          throw new Error('Initial prerequisite refused')
        },
      },
      writeStderr: async (text) => {
        advertised ||= text.includes('#cap=')
      },
      writeError: () => {},
      writeOutput: () => {},
      writeRecord: async () => {},
    })
    expect(code).not.toBe(0)
    expect(advertised).toBe(false)
    expect(input.rawChanges).toEqual([])
    expect(started).toBe(!scenario.includes('@bad.json'))
  }
})

test('short host-only Run retires files before indefinite inspection and exact JSON output', async () => {
  const root = await directory()
  await writeFile(join(root, 'initial.json'), '{}')
  const timeline: string[] = []
  let launch: string | undefined,
    stdout = '',
    done = false
  const input = new Input()
  input.isTTY = false
  const task = main(
    ['run', 'flow:flows/work', '--display', 'web', '--updates', 'off', '--input', '@initial.json'],
    {
      currentDirectory: root,
      terminalError: true,
      terminalOutput: false,
      interactive: false,
      dashboardInputStream: input as any,
      webAssets: assets,
      expectedAdmissionDigest: `sha256:${'b'.repeat(64)}`,
      host: {
        delivery: {
          async retire() {
            timeline.push('retired')
          },
        } as any,
        async acquire(_path, options) {
          expect(launch).toBeUndefined()
          expect(options?.channelOutput?.updates).toBeUndefined()
          return {
            rootAdministration: {
              async startRun() {
                timeline.push('dispatch')
                options?.channelOutput?.dispatched?.()
                return { runId: 'sha256:' + 'a'.repeat(64) }
              },
              async runStatus() {
                return {
                  state: 'terminal',
                  runId: 'sha256:' + 'a'.repeat(64),
                  terminal: {
                    status: 'succeeded',
                    outcome: 'literal-domain-value',
                    output: { message: 'Recorded output' },
                    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
                  },
                }
              },
            },
            async close() {
              timeline.push('project-closed')
            },
          } as any
        },
      },
      writeStderr: async (text) => {
        launch ??= /http:\/\/127\.0\.0\.1:\d+\/#cap=[A-Za-z0-9_-]{43}/.exec(text)?.[0]
      },
      writeError: () => {},
      writeOutput: () => {},
      writeRecord: async (text) => {
        stdout += text
        timeline.push('stdout')
      },
    },
  ).then((code) => {
    done = true
    return code
  })
  let url: URL | undefined
  try {
    url = new URL(await until(() => launch))
    const headers = { Authorization: `Bearer ${url.hash.slice(5)}` }
    await until(() => (timeline.includes('retired') ? true : undefined))
    let snapshot: any
    for (let i = 0; i < 20; i++) {
      snapshot = await (await fetch(url.origin + '/api/snapshot', { headers })).json()
      if (snapshot.workspace.phase === 'settled') break
      await tick()
    }
    expect(snapshot.workspace.phase).toBe('settled')
    expect(snapshot.workspace.facts.execution.value).toBe('succeeded')
    expect(snapshot.workspace.facts.application.value).toBe('"literal-domain-value"')
    expect(JSON.stringify(snapshot).includes('#cap=')).toBe(false)
    expect(JSON.stringify(snapshot).includes(root)).toBe(false)
    expect(JSON.stringify(snapshot).includes('initial.json')).toBe(false)
    expect(snapshot.views).toEqual([])
    expect(snapshot.artifacts.files).toEqual([])
    expect(timeline.indexOf('project-closed')).toBeLessThan(timeline.indexOf('retired'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(done).toBe(false)
    expect(stdout).toBe('')
    const closed = await fetch(url.origin + '/api/close', {
      method: 'POST',
      headers: { ...headers, Origin: url.origin },
    })
    expect(closed.status).toBe(200)
    expect(await task).toBe(0)
    expect(JSON.parse(stdout).status).toBe('succeeded')
    expect(input.rawChanges).toEqual([])
    expect(timeline.indexOf('retired')).toBeLessThan(timeline.indexOf('stdout'))
  } finally {
    if (url && !done)
      await fetch(url.origin + '/api/close', {
        method: 'POST',
        headers: { Authorization: `Bearer ${url.hash.slice(5)}`, Origin: url.origin },
      }).catch(() => undefined)
    await task
  }
})

test('live close preserves work; retirement and presentation failures preserve known terminal output', async () => {
  for (const fault of ['none', 'retirement', 'presentation', 'project', 'project-presentation']) {
    const retirementFails = fault === 'retirement'
    const originalClose = PrivateWebDisplay.prototype.close
    const mockedClose =
      fault.includes('presentation')
        ? spyOn(PrivateWebDisplay.prototype, 'close').mockImplementation(async function (
            this: PrivateWebDisplay,
          ) {
            await originalClose.call(this)
            throw new Error('private display close cause')
          })
        : undefined
    const root = await directory()
    let launch: string | undefined,
      stdout = '',
      closedProject = false,
      retires = 0
    let finish!: () => void
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })
    const task = main(['run', 'flow:flows/work', '--display', 'web', '--updates', 'off'], {
      currentDirectory: root,
      terminalError: true,
      terminalOutput: false,
      interactive: false,
      dashboardInputStream: { isTTY: false } as any,
      webAssets: assets,
      host: {
        delivery: {
          async retire() {
            retires++
            if (retirementFails) throw new Error('private retirement cause')
          },
        } as any,
        async acquire(_path, options) {
          return {
            rootAdministration: {
              async startRun() {
                options?.channelOutput?.dispatched?.()
                return { runId: 'sha256:' + 'a'.repeat(64) }
              },
              async runStatus() {
                await work
                return {
                  state: 'terminal',
                  runId: 'sha256:' + 'a'.repeat(64),
                  terminal: {
                    status: 'succeeded',
                    outcome: 'domain-blocked',
                    output: { reason: 'literal' },
                    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
                  },
                }
              },
            },
            async close() {
              closedProject = true
              if (fault.startsWith('project')) throw new Error('private session close cause')
            },
          } as any
        },
      },
      writeStderr: async (text) => {
        launch ??= /http:\/\/127\.0\.0\.1:\d+\/#cap=[A-Za-z0-9_-]{43}/.exec(text)?.[0]
      },
      writeError: () => {},
      writeOutput: () => {},
      writeRecord: async (text) => {
        stdout += text
      },
    })
    let url: URL | undefined
    try {
      url = new URL(await until(() => launch))
      expect(closedProject).toBe(false)
      if (fault === 'none') {
        const response = await fetch(url.origin + '/api/close', {
          method: 'POST',
          headers: { Authorization: `Bearer ${url.hash.slice(5)}`, Origin: url.origin },
        })
        expect(response.status).toBe(200)
        await response.text()
        expect(closedProject).toBe(false)
        expect(stdout).toBe('')
      }
      finish()
      if (fault === 'presentation') {
        const headers = { Authorization: `Bearer ${url.hash.slice(5)}` }
        for (let i = 0; i < 20; i++) {
          const snapshot = (await (
            await fetch(url.origin + '/api/snapshot', { headers })
          ).json()) as any
          if (snapshot.workspace.phase === 'settled') break
          await tick()
        }
        await fetch(url.origin + '/api/close', {
          method: 'POST',
          headers: { ...headers, Origin: url.origin },
        })
      }
      expect(await task).toBe(fault === 'none' ? 0 : 2)
      const record = JSON.parse(stdout)
      expect(record.status).toBe('succeeded')
      expect(record.outcome).toBe('domain-blocked')
      expect(record.command).toBeUndefined()
      expect(record.cleanup?.code).toBe(
        retirementFails
          ? 'INSPECTION_CLOSE_FAILED'
          : fault.startsWith('project')
            ? 'PROJECT_CLOSE_FAILED'
            : fault === 'presentation'
              ? 'COMMAND_FINALIZATION_FAILED'
              : undefined,
      )
      expect(closedProject).toBe(true)
      expect(retires).toBe(1)
      expect(stdout).not.toContain('private retirement cause')
      expect(stdout).not.toContain('private display close cause')
    } finally {
      finish()
      if (url)
        await fetch(url.origin + '/api/close', {
          method: 'POST',
          headers: { Authorization: `Bearer ${url.hash.slice(5)}`, Origin: url.origin },
        }).catch(() => undefined)
      await task
      mockedClose?.mockRestore()
    }
  }
})
