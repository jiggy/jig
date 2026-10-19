const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquireOrReexecutePrivateRootlessLinux,
  reexecutePrivateRootlessLinuxCommand,
} from '../../src/internal/linux-rootless-delegation.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'

interface AcknowledgedWitness {
  readonly delegatedCgroup: string
  readonly coordinatorPid: number
  readonly forkPid: number
}
function acknowledgedCommand(readyPath: string): [string, ...string[]] {
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const childScript = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "import { writeFile } from 'node:fs/promises';",
    'const result = await acquireOrReexecutePrivateRootlessLinux();',
    "if (result.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
    "const fork = Bun.spawn(['/bin/sleep', '30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });",
    `await writeFile(${JSON.stringify(readyPath)}, JSON.stringify({`,
    '  delegatedCgroup: result.observation.delegatedCgroup, coordinatorPid: process.pid, forkPid: fork.pid,',
    '}), { mode: 0o600 });',
    'await new Promise((resolve) => setTimeout(resolve, 30_000));',
  ].join('\n')
  return [
    process.execPath,
    '--no-env-file',
    '--no-install',
    '--config=/dev/null',
    '-e',
    childScript,
  ]
}
function spawnAcknowledgedWrapper(
  manager: string,
  unit: string,
  readyPath: string,
  lifetimeMs: number,
): ReturnType<typeof Bun.spawn> {
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const wrapperScript = [
    `import { reexecutePrivateRootlessLinuxCommand } from ${JSON.stringify(moduleUrl)};`,
    `await reexecutePrivateRootlessLinuxCommand(${JSON.stringify(manager)}, ${JSON.stringify(unit)},`,
    `  [${acknowledgedCommand(readyPath)
      .map((value) => JSON.stringify(value))
      .join(', ')}],`,
    `  '/', process.env, 2_000, ${lifetimeMs});`,
  ].join('\n')
  return Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', wrapperScript],
    { cwd: '/', env: process.env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
  )
}
function expectProcessPresent(processId: number): void {
  expect(() => process.kill(processId, 0)).not.toThrow()
}
function forceKill(processId: number | undefined): void {
  if (processId === undefined) return
  try {
    process.kill(processId, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
async function forceCollect(control: string, scope: string): Promise<void> {
  const lifetime = `${scope.slice(0, -'.scope'.length)}-lifetime`
  for (const arguments_ of [
    ['--user', 'kill', '--kill-whom=all', '--signal=KILL', scope],
    ['--user', 'stop', scope],
    ['--user', 'stop', `${lifetime}.timer`],
    ['--user', 'stop', `${lifetime}.service`],
  ] as const) {
    const child = Bun.spawn([control, ...arguments_], {
      cwd: '/',
      env: process.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await child.exited
  }
}
async function fixedManager(): Promise<string> {
  for (const candidate of ['/usr/bin/systemd-run', '/bin/systemd-run'] as const) {
    try {
      const resolved = await realpath(candidate)
      if ((await stat(resolved)).isFile()) return resolved
    } catch {
      // The product uses the same closed candidate list.
    }
  }
  throw new Error('fixed systemd-run candidate is unavailable')
}
async function fixedControl(): Promise<string> {
  for (const candidate of ['/usr/bin/systemctl', '/bin/systemctl'] as const) {
    try {
      const resolved = await realpath(candidate)
      if ((await stat(resolved)).isFile()) return resolved
    } catch {
      // The product uses the same closed candidate list.
    }
  }
  throw new Error('fixed systemctl candidate is unavailable')
}
async function managerProperties(
  control: string,
  unit: string,
): Promise<{
  readonly loadState: string
  readonly activeState: string
  readonly controlGroup: string
}> {
  const child = Bun.spawn(
    [control, '--user', 'show', '--property=LoadState,ActiveState,ControlGroup', unit],
    { cwd: '/', env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
  )
  const stdout = await new Response(child.stdout).text()
  await child.exited
  const values = new Map(
    stdout
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=')
        return separator < 1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
  return {
    loadState: values.get('LoadState') ?? '',
    activeState: values.get('ActiveState') ?? '',
    controlGroup: values.get('ControlGroup') ?? '',
  }
}
async function waitForControlGroup(
  control: string,
  unit: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const observation = await managerProperties(control, unit)
    if (observation.controlGroup !== '') return `/sys/fs/cgroup${observation.controlGroup}`
    if (Date.now() >= deadline) throw new Error(`transient scope did not appear: ${unit}`)
    await pause(20)
  }
}
async function expectManagerUnitsAbsent(
  control: string,
  scope: string,
  timeoutMs = 2_000,
): Promise<void> {
  const lifetime = `${scope.slice(0, -'.scope'.length)}-lifetime`
  const units = [scope, `${lifetime}.timer`, `${lifetime}.service`]
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const states = await Promise.all(
      units.map(async (unit) => (await managerProperties(control, unit)).loadState),
    )
    if (states.every((state) => state === 'not-found')) return
    if (Date.now() >= deadline)
      throw new Error(`transient manager units remained: ${units.join(', ')}`)
    await pause(20)
  }
}
async function waitForJsonFile(path: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return JSON.parse(await Bun.file(path).text())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error
    }
    if (Date.now() >= deadline) throw new Error(`lifetime witness was not written: ${path}`)
    await pause(20)
  }
}
async function expectProcessAbsent(processId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(processId, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    if (Date.now() >= deadline)
      throw new Error(`forked process remained after scope loss: ${processId}`)
    await pause(20)
  }
}
async function expectAbsent(path: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (Date.now() >= deadline)
      throw new Error(`transient scope remained after collection: ${path}`)
    await pause(20)
  }
}
function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function managerUnitNames(control: string): Promise<readonly string[]> {
  const child = Bun.spawn(
    [control, '--user', 'list-units', '--all', '--no-legend', '--plain', 'jig-*'],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stderr).toBe(0)
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0]!)
    .filter((name) => name !== '')
    .sort()
}

test('continues in the already delegated process without reexecution', async () => {
  const processId = process.pid
  const result = await acquireOrReexecutePrivateRootlessLinux()

  expect(result.kind).toBe('private-rootless-linux-ready/1')
  expect(process.pid).toBe(processId)
})
test('authenticated startup refusal transfers diagnostics without acknowledging acquisition', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-refusal-handoff-')))
  const witness = join(root, 'observed.json')
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const script = [
    `import {acquireOrReexecutePrivateRootlessLinux, privateRootlessLinuxDiagnosticOwnedByParent} from ${JSON.stringify(moduleUrl)};`,
    "import {writeFile} from 'node:fs/promises';",
    'try {',
    '  await acquireOrReexecutePrivateRootlessLinux();',
    '} catch (error) {',
    `  await writeFile(${JSON.stringify(witness)}, JSON.stringify({`,
    '    code: error.code, parentOwned: privateRootlessLinuxDiagnosticOwnedByParent(error),',
    '  }), {mode: 0o600});',
    '  process.exitCode = 2;',
    '}',
  ].join('\n')
  try {
    const failure = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
      '/',
      { ...process.env, JIG_BWRAP_PATH: join(root, 'missing-bubblewrap') },
      2_000,
      5_000,
    ).then(
      () => undefined,
      (error) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect(JSON.parse(await Bun.file(witness).text())).toEqual({
      code: 'SANDBOX_UNAVAILABLE',
      parentOwned: true,
    })
    await expectManagerUnitsAbsent(control, unit)
  } finally {
    await forceCollect(control, unit)
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
test('collects a stopped refused startup peer without waiting for its socket', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-held-startup-')))
  const witness = join(root, 'observed.json')
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const peer = [
    "import {connect} from 'node:net';",
    "import {writeFileSync} from 'node:fs';",
    "const socket = connect('\\0' + process.env.JIG_PRIVATE_ROOTLESS_READY_SOCKET);",
    "socket.once('connect', () => socket.write(process.env.JIG_PRIVATE_ROOTLESS_READY_TOKEN + ':unavailable\\n'));",
    "let input = '';",
    "socket.on('data', (chunk) => {",
    '  input += chunk;',
    "  if (input === 'unavailable\\n') {",
    `    writeFileSync(${JSON.stringify(witness)}, JSON.stringify({pid:process.pid}), {mode:0o600});`,
    "    process.kill(process.pid, 'SIGSTOP');",
    '  }',
    '});',
    "socket.on('error', () => {});",
  ].join('\n')
  const wrapper = [
    `import {reexecutePrivateRootlessLinuxCommand} from ${JSON.stringify(moduleUrl)};`,
    'try {',
    `  await reexecutePrivateRootlessLinuxCommand(${JSON.stringify(manager)}, ${JSON.stringify(unit)},`,
    `    ${JSON.stringify([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', peer])},`,
    "    '/', process.env, 2_000, 30_000);",
    '  process.exitCode = 1;',
    '} catch {',
    "  console.log('startup refused');",
    '}',
  ].join('\n')
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', wrapper],
    { cwd: '/', env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )
  const settled = settleTestCommand(child, {
    evidence: join(root, 'command'),
    timeoutMs: 10_000,
  }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  let passed = false
  try {
    const observation = (await waitForJsonFile(witness, 2_000)) as { pid: number }
    expect(Object.keys(observation)).toEqual(['pid'])
    expect(Number.isSafeInteger(observation.pid) && observation.pid > 0).toBeTrue()
    expect(await readFile(`/proc/${observation.pid}/status`, 'utf8')).toMatch(/^State:\s+T\b/m)
    const outcome = await settled
    if ('error' in outcome) throw outcome.error
    const result = outcome.value
    expect(result.code, result.stderr).toBe(0)
    expect(child.signalCode).toBeNull()
    expect(result.stdout).toBe('startup refused\n')
    await expectProcessAbsent(observation.pid, 2_000)
    await expectManagerUnitsAbsent(control, unit)
    passed = true
  } finally {
    try {
      await forceCollect(control, unit)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await settled
      if (passed) await rm(root, { recursive: true, force: true })
    }
  }
}, 30_000)
test('installed acquisition refusal has one diagnostic owner and no retained scope', async () => {
  const control = await fixedControl()
  const before = await managerUnitNames(control)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-startup-refusal-')))
  let passed = false
  try {
    const selectedPath = join(root, 'PRIVATE_MISSING_BUBBLEWRAP')
    const child = Bun.spawn(
      [fileURLToPath(new URL('../bin/jig', suiteTestUrl)), 'review', '--yes'],
      {
        cwd: root,
        env: { ...process.env, JIG_BWRAP_PATH: selectedPath },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'command'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(2)
    expect(child.signalCode).toBeNull()
    expect(result.stdout).toBe('')
    expect(result.stderr.match(/Diagnostic code: SANDBOX_UNAVAILABLE/g)).toHaveLength(1)
    expect(result.stderr).toContain('JIG_BWRAP_PATH')
    expect(result.stderr).not.toContain(selectedPath)
    await expect(stat(join(root, '.jig'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await managerUnitNames(control)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
  }
}, 30_000)
test('prepares and collects one real transient delegated user scope', async () => {
  const manager = await fixedManager()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const resultPath = `/tmp/jig-rootless-result-${randomBytes(12).toString('hex')}.json`
  const script = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "import { writeFile } from 'node:fs/promises';",
    'const result = await acquireOrReexecutePrivateRootlessLinux();',
    "const cgroup = await Bun.file('/proc/self/cgroup').text();",
    `await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ result, cgroup }), { mode: 0o600 });`,
  ].join('\n')
  try {
    const execution = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
      '/',
      process.env,
    )
    expect(execution).toMatchObject({ exitCode: 0, signal: null })
    const output = JSON.parse(await Bun.file(resultPath).text()) as {
      readonly result: {
        readonly kind: string
        readonly observation: { readonly delegatedCgroup: string; readonly currentCgroup: string }
      }
      readonly cgroup: string
    }
    expect(output.result.kind).toBe('private-rootless-linux-ready/1')
    expect(output.result.observation.delegatedCgroup.endsWith(`/${unit}`)).toBe(true)
    expect(output.result.observation.currentCgroup).toBe(
      `${output.result.observation.delegatedCgroup}/jig`,
    )
    expect(output.cgroup).toBe(
      `0::${output.result.observation.currentCgroup.slice('/sys/fs/cgroup'.length)}\n`,
    )
    await expectAbsent(output.result.observation.delegatedCgroup)
  } finally {
    await rm(resultPath, { force: true })
  }
})
test('forwards an outer interruption to the authenticated inner command', async () => {
  const manager = await fixedManager()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const resultPath = `/tmp/jig-rootless-interrupt-${randomBytes(12).toString('hex')}.json`
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const script = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "import { writeFile } from 'node:fs/promises';",
    'const interrupted = new AbortController();',
    "process.once('SIGTERM', () => interrupted.abort());",
    'await acquireOrReexecutePrivateRootlessLinux();',
    'if (!interrupted.signal.aborted) await new Promise((resolve, reject) => {',
    "  const timer = setTimeout(() => reject(new Error('interrupt was not forwarded')), 10_000);",
    "  interrupted.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });",
    '});',
    `await writeFile(${JSON.stringify(resultPath)}, 'interrupted', { mode: 0o600 });`,
    'process.exitCode = 2;',
  ].join('\n')
  const cancellation = new AbortController()
  const timer = setTimeout(() => cancellation.abort(), 1_000)
  try {
    const execution = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
      '/',
      process.env,
      5_000,
      30_000,
      cancellation.signal,
    )
    expect(execution).toMatchObject({ exitCode: 2, signal: null })
    expect(await Bun.file(resultPath).text()).toBe('interrupted')
  } finally {
    clearTimeout(timer)
    await rm(resultPath, { force: true })
  }
})
test('keeps support identity stable while transient launch authority changes', async () => {
  const manager = await fixedManager()
  const delegationUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const backendUrl = new URL('../src/internal/linux-rootless-backend.ts', suiteTestUrl).href
  const results = [
    `/tmp/jig-rootless-mechanism-${randomBytes(12).toString('hex')}.json`,
    `/tmp/jig-rootless-mechanism-${randomBytes(12).toString('hex')}.json`,
  ] as const
  try {
    for (const resultPath of results) {
      const unit = `jig-${randomBytes(12).toString('hex')}.scope`
      const script = [
        `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(delegationUrl)};`,
        `import { PrivateLinuxCgroupBackend } from ${JSON.stringify(backendUrl)};`,
        "import { realpath, writeFile } from 'node:fs/promises';",
        "import { dirname } from 'node:path';",
        'const acquired = await acquireOrReexecutePrivateRootlessLinux();',
        "if (acquired.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
        "const loader = await realpath('/lib64/ld-linux-x86-64.so.2');",
        'const backend = new PrivateLinuxCgroupBackend({',
        '  bunPath: await realpath(process.execPath), bunHostLibraryPath: dirname(loader),',
        '});',
        'const observation = await backend.observeMechanism();',
        `await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(observation), { mode: 0o600 });`,
      ].join('\n')
      const execution = await reexecutePrivateRootlessLinuxCommand(
        manager,
        unit,
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
        '/',
        process.env,
        2_000,
        10_000,
      )
      expect(execution).toMatchObject({ exitCode: 0, signal: null })
    }

    const first = JSON.parse(await Bun.file(results[0]).text()) as {
      readonly support: Readonly<Record<string, unknown>>
      readonly authority: {
        readonly delegatedCgroup: string
        readonly delegatedCgroupInode: string
      }
    }
    const second = JSON.parse(await Bun.file(results[1]).text()) as typeof first
    expect(first.support).toEqual(second.support)
    expect(first.authority.delegatedCgroup).not.toBe(second.authority.delegatedCgroup)
    expect(first.authority.delegatedCgroupInode).not.toBe(second.authority.delegatedCgroupInode)
  } finally {
    await Promise.all(results.map((path) => rm(path, { force: true })))
  }
})
test('manager lifetime timer collects a no-ack scope after wrapper loss', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const script = [
    `import { reexecutePrivateRootlessLinuxCommand } from ${JSON.stringify(moduleUrl)};`,
    `await reexecutePrivateRootlessLinuxCommand(${JSON.stringify(manager)}, ${JSON.stringify(unit)},`,
    "  ['/bin/sleep', '30'], '/', process.env, 250, 600);",
  ].join('\n')
  const wrapper = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
    { cwd: '/', env: process.env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
  )

  const cgroup = await waitForControlGroup(control, unit, 2_000)
  wrapper.kill(9)
  await wrapper.exited
  await expectManagerUnitsAbsent(control, unit, 3_000)
  await expectAbsent(cgroup)
})
for (const signal of ['SIGKILL', 'SIGTERM'] as const) {
  test(`lifetime channel kills the acknowledged scope and fork after wrapper ${signal}`, async () => {
    const manager = await fixedManager()
    const control = await fixedControl()
    const unit = `jig-${randomBytes(12).toString('hex')}.scope`
    const readyPath = `/tmp/jig-rootless-lifetime-${randomBytes(12).toString('hex')}.json`
    const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 2_000)
    try {
      const ready = (await waitForJsonFile(readyPath, 2_000)) as AcknowledgedWitness
      const lifetime = `${unit.slice(0, -'.scope'.length)}-lifetime`
      expect((await managerProperties(control, `${lifetime}.timer`)).activeState).toBe('active')
      wrapper.kill(signal)
      await wrapper.exited

      await expectAbsent(ready.delegatedCgroup, 1_000)
      await expectProcessAbsent(ready.forkPid, 1_000)
      await expectManagerUnitsAbsent(control, unit, 3_000)
    } finally {
      wrapper.kill(9)
      await forceCollect(control, unit)
      await rm(readyPath, { force: true })
    }
  })
}
test('lifetime timer fences simultaneous wrapper and coordinator loss', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const readyPath = `/tmp/jig-rootless-dual-loss-${randomBytes(12).toString('hex')}.json`
  const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 2_000)
  let ready: AcknowledgedWitness | undefined
  try {
    ready = (await waitForJsonFile(readyPath, 2_000)) as AcknowledgedWitness
    process.kill(ready.coordinatorPid, 'SIGSTOP')
    wrapper.kill(9)
    await wrapper.exited
    process.kill(ready.coordinatorPid, 'SIGKILL')
    await pause(100)

    expectProcessPresent(ready.forkPid)
    await expectManagerUnitsAbsent(control, unit, 3_000)
    await expectAbsent(ready.delegatedCgroup)
    await expectProcessAbsent(ready.forkPid, 2_000)
  } finally {
    wrapper.kill(9)
    forceKill(ready?.coordinatorPid)
    forceKill(ready?.forkPid)
    await forceCollect(control, unit)
    await rm(readyPath, { force: true })
  }
})
test('lifetime timer fences a stopped coordinator after wrapper loss', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const readyPath = `/tmp/jig-rootless-stopped-${randomBytes(12).toString('hex')}.json`
  const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 1_000)
  let ready: AcknowledgedWitness | undefined
  try {
    ready = (await waitForJsonFile(readyPath, 2_000)) as AcknowledgedWitness
    process.kill(ready.coordinatorPid, 'SIGSTOP')
    wrapper.kill(9)
    await wrapper.exited

    await expectManagerUnitsAbsent(control, unit, 3_000)
    await expectAbsent(ready.delegatedCgroup)
    await expectProcessAbsent(ready.coordinatorPid, 2_000)
    await expectProcessAbsent(ready.forkPid, 2_000)
  } finally {
    wrapper.kill(9)
    forceKill(ready?.coordinatorPid)
    forceKill(ready?.forkPid)
    await forceCollect(control, unit)
    await rm(readyPath, { force: true })
  }
})
test('lifetime timer enforces the complete command lifetime', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const unit = `jig-${randomBytes(12).toString('hex')}.scope`
  const readyPath = `/tmp/jig-rootless-hard-lifetime-${randomBytes(12).toString('hex')}.json`
  const command = acknowledgedCommand(readyPath)
  let ready: AcknowledgedWitness | undefined
  try {
    const executionPromise = reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      command,
      '/',
      process.env,
      2_000,
      750,
    )
    ready = (await waitForJsonFile(readyPath, 2_000)) as AcknowledgedWitness
    const execution = await executionPromise

    expect(execution.exitCode !== 0 || execution.signal !== null).toBe(true)
    await expectManagerUnitsAbsent(control, unit, 2_000)
    await expectAbsent(ready.delegatedCgroup)
    await expectProcessAbsent(ready.coordinatorPid, 2_000)
    await expectProcessAbsent(ready.forkPid, 2_000)
  } finally {
    forceKill(ready?.coordinatorPid)
    forceKill(ready?.forkPid)
    await forceCollect(control, unit)
    await rm(readyPath, { force: true })
  }
})
test('collects silent no-ack and immediate child or manager start failures', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  for (const [label, launchManager, command] of [
    ['silent', manager, ['/bin/sleep', '30']],
    ['child', manager, ['/bin/false']],
    ['manager', '/bin/false', ['/bin/true']],
  ] as const) {
    const unit = `jig-${randomBytes(12).toString('hex')}.scope`
    const failure = await reexecutePrivateRootlessLinuxCommand(
      launchManager,
      unit,
      command,
      '/',
      process.env,
      250,
      1_000,
    ).then(
      () => undefined,
      (error) => error,
    )
    expect(failure, label).toBeInstanceOf(Error)
    await expectManagerUnitsAbsent(control, unit)
  }
})
test('repeats transient acquisition without scope, timer, process, or cgroup residue', async () => {
  const manager = await fixedManager()
  const control = await fixedControl()
  const moduleUrl = new URL('../src/internal/linux-rootless-delegation.ts', suiteTestUrl).href
  const script = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    'const result = await acquireOrReexecutePrivateRootlessLinux();',
    "if (result.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
  ].join('\n')

  for (let index = 0; index < 5; index += 1) {
    const unit = `jig-${randomBytes(12).toString('hex')}.scope`
    const result = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', script],
      '/',
      process.env,
      2_000,
      5_000,
    )
    expect(result).toMatchObject({ exitCode: 0, signal: null })
    await expectManagerUnitsAbsent(control, unit)
  }
})

if (process.platform !== 'linux' || process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1')
  throw Error('This suite requires opted-in rootless Linux qualification')
