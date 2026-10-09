import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { privateBuildWebAssets } from '../scripts/build-web-cli.js'
import { privateWebAssets } from '../src/cli-web-assets.js'

test('browser build emits only fixed self-contained assets and erases server type imports', async () => {
  const assets = await privateBuildWebAssets()
  expect(Object.keys(assets)).toEqual(['/', '/assets/app.js', '/assets/app.css'])
  expect(Object.isFrozen(assets)).toBeTrue()
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
  const authored = await readFile(new URL('../src/web/app.ts', import.meta.url), 'utf8')
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
  expect(Object.keys(manifest.exports)).toEqual(['.'])
  expect(manifest.files.some((path: string) => path.includes('web/'))).toBeFalse()
  expect(privateWebAssets).toEqual({})
})
