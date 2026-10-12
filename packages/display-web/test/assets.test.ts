import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WebAssets } from '@jigging/display-model'

async function buildAssetsInFreshProcess(): Promise<{ assets: WebAssets; frozen: boolean }> {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--eval',
      `import { buildWebAssets } from './scripts/build-assets.ts';
const assets = await buildWebAssets();
process.stdout.write(JSON.stringify({ assets, frozen: Object.isFrozen(assets) }));`,
    ],
    {
      cwd: resolve(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const readers = [child.stdout.getReader(), child.stderr.getReader()]
  let timedOut = false
  const timeout = setTimeout(() => {
    if (child.exitCode === null) {
      timedOut = true
      child.kill('SIGKILL')
    }
  }, 5000)
  const bounded = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    while (true) {
      const item = await reader.read()
      if (item.done) return text + decoder.decode()
      bytes += item.value.byteLength
      if (bytes > 1024 * 1024) {
        child.kill('SIGKILL')
        throw new Error('Browser build diagnostic output exceeded 1 MiB')
      }
      text += decoder.decode(item.value, { stream: true })
    }
  }
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      bounded(readers[0]!),
      bounded(readers[1]!),
    ])
    expect(timedOut, 'Browser asset build exceeded the existing five-second test bound').toBeFalse()
    expect(status, stderr).toBe(0)
    return JSON.parse(stdout) as { assets: WebAssets; frozen: boolean }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill('SIGKILL')
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
    for (const reader of readers) reader.releaseLock()
    await child.exited
  }
}

test('browser build emits only fixed self-contained assets and erases server type imports', async () => {
  const { assets, frozen } = await buildAssetsInFreshProcess()
  expect(Object.keys(assets)).toEqual(['/', '/assets/app.js', '/assets/app.css'])
  expect(frozen).toBeTrue()
  expect(assets['/']?.contentType).toBe('text/html; charset=utf-8')
  expect(assets['/assets/app.js']?.contentType).toBe('text/javascript; charset=utf-8')
  const html = assets['/']!.body
  expect(html).toContain('<script type="module" src="/assets/app.js"></script>')
  expect(html).toContain('href="/assets/app.css"')
  expect(html).not.toMatch(/<style|\son[a-z]+=|<script(?![^>]*\bsrc=)[^>]*>/i)
  const browser = assets['/assets/app.js']!.body
  expect(browser).not.toMatch(
    /node:|@opentui\/|sourceMappingURL|\bfrom\s*["']|\bimport\s*["']|\beval\(/,
  )
  expect(browser).toContain('/api/snapshot')
  expect(browser).toContain('/api/events')
  // Preact contains a generic raw-HTML branch; the host never supplies that prop.
  const authored = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8')
  expect(authored).not.toMatch(/innerHTML|dangerouslySetInnerHTML/)
  expect(browser).not.toContain('localStorage')
  expect(browser).not.toContain('sessionStorage')
  expect(browser).not.toContain('EventSource')
  expect(browser).not.toMatch(/WebSocket|prepareInjection/)
  expect(browser).not.toContain('https://')
  expect(assets['/assets/app.css']!.body).not.toMatch(/@import|url\(/)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.devDependencies.preact).toBe('11.0.1')
  expect(manifest.dependencies.preact).toBeUndefined()
  expect(Object.keys(manifest.exports)).toEqual(['.', './assets'])
  expect(manifest.files.some((path: string) => path.includes('web/'))).toBeFalse()
})
