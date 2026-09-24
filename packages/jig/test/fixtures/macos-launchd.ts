import { expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
const xml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const launchctl = (...args: string[]) =>
  spawnSync('/bin/launchctl', args, { env: environment, encoding: 'utf8', timeout: 5000 })

export async function runMacosFixture(fixture: string, args: string[], expected: object) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-process-test-')))
  const domain = `user/${process.getuid?.()}`
  const label = `org.jig.process-test.${directory.split('-').at(-1)}`
  const target = `${domain}/${label}`
  const output = join(directory, 'out')
  const errorOutput = join(directory, 'err')
  const plist = join(directory, 'job.plist')
  const outside = spawn('/bin/sleep', ['15'], { env: environment, stdio: 'ignore' })
  const outsideExited = new Promise<void>((resolve) => outside.once('exit', () => resolve()))
  let settled = false
  let registered = false
  try {
    await writeFile(
      plist,
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${[process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', fixture, ...args, directory].map((value) => `<string>${xml(value)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>EnvironmentVariables</key><dict><key>JIG_MACOS_TEST_CANARY</key><string>owned-synthetic-canary</string></dict>
<key>LimitLoadToSessionType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(output)}</string>
<key>StandardErrorPath</key><string>${xml(errorOutput)}</string>
</dict></plist>`,
      { mode: 0o600 },
    )
    const start = launchctl('bootstrap', domain, plist)
    expect(start.status).toBe(0)
    registered = true
    const end = performance.now() + 12_000
    let text = ''
    while (performance.now() < end) {
      text = await readFile(output, 'utf8').catch(() => '')
      if (text.includes('"empty":true')) break
      await Bun.sleep(50)
    }
    settled = text.includes('"empty":true')
    const errors = await readFile(errorOutput, 'utf8').catch(() => '')
    expect({ text, errors }).toEqual({
      text: `${JSON.stringify(expected)}\n`,
      errors: '',
    })
    expect(outside.exitCode).toBeNull()
    expect(outside.signalCode).toBeNull()
  } finally {
    outside.kill('SIGKILL')
    await outsideExited
    if (registered) expect(launchctl('bootout', target).status).toBe(0)
    expect(launchctl('print', target).status).toBe(113)
    if (settled || !registered) await rm(directory, { recursive: true, force: true })
    else console.error(`Unconfirmed native test evidence retained at ${directory}`)
  }
}
