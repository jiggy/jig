// Explicit review command. Functional acceptance does not invoke screenshot capture.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import {
  childFixture,
  compositionFixture,
  contactFixture,
  documentFixture,
  factoryFixture,
  hostFixture,
  kitchenFixture,
  patchFixture,
  supportFixture,
} from './browser-fixtures.mjs'
import { startBrowserFixture } from './browser-server.mjs'

const [pr, destination, assetCheckout] = process.argv.slice(2)
if (!/^https:\/\/github\.com\/jiggy\/jig\/pull\/[1-9][0-9]*$/.test(pr ?? '') || !destination)
  throw new Error(
    'After pushing the implementation PR, run: node test/browser-capture.mjs PR_URL OUTPUT_DIRECTORY',
  )

const sourceDirectory = assetCheckout ? resolve(assetCheckout) : process.cwd()
const assets = assetCheckout
  ? (
      await import(
        pathToFileURL(resolve(sourceDirectory, 'packages/display-web/dist/assets.js')).href
      )
    ).webAssets
  : undefined
const fixtureRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sourceRevision = execFileSync('git', ['-C', sourceDirectory, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const sourceTree = execFileSync('git', ['-C', sourceDirectory, 'rev-parse', 'HEAD^{tree}'], {
  encoding: 'utf8',
}).trim()
const output = resolve(destination)
await mkdir(output, { recursive: true })
const entries = []
let completed = false
const writeManifest = () =>
  writeFile(
    resolve(output, 'manifest.json'),
    `${JSON.stringify({ pr, sourceRevision, sourceTree, fixtureRevision, completed, entries, evidence: 'Production browser assets with authenticated inert observations and ordinary example projectors. No native execution or approved-design similarity is asserted.' }, null, 2)}\n`,
  )
await writeManifest()
const browser = await chromium.launch({
  headless: true,
  ...(process.env.JIG_BROWSER_EXECUTABLE
    ? { executablePath: process.env.JIG_BROWSER_EXECUTABLE }
    : {}),
})
try {
  for (const [name, make, tab, focus] of [
    ['map', compositionFixture, 'Application map'],
    ['map-attention', compositionFixture, 'Application map', 'attention'],
    ['execution', hostFixture, 'Execution'],
    ['files', hostFixture, 'Delivered files'],
    ['activity', hostFixture, 'Activity'],
    ['diagnostics', hostFixture, 'Diagnostics'],
    ['contacts', contactFixture],
    ['support', supportFixture],
    ['kitchen', kitchenFixture],
    ['patch', patchFixture],
    ['factory', factoryFixture],
    ['child', childFixture, 'Specialist material'],
    ['document', documentFixture],
  ])
    for (const [viewportName, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['narrow', { width: 390, height: 900 }],
    ]) {
      const host = await startBrowserFixture(make(), assets)
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      try {
        await page.goto(host.url)
        await page.getByText('Connected', { exact: true }).waitFor()
        if (tab === 'Diagnostics')
          await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
        else if (tab) {
          const chooser = page.getByRole('combobox', { name: 'Choose view', exact: true })
          if (await chooser.isVisible()) {
            const option = chooser.getByRole('option', { name: new RegExp(`^${tab}(?:\\s|$)`) })
            await chooser.selectOption(await option.getAttribute('value'))
          } else await page.getByRole('tab', { name: new RegExp(`^${tab}(?:\\s|$)`) }).click()
        }
        if (focus) await page.locator(`[data-request-focus="${focus}"]`).click()
        for (const theme of ['Light', 'Dark', 'Monochrome']) {
          const appearance = page.getByRole('button', { name: `${theme} appearance`, exact: true })
          await appearance.click()
          await page.evaluate(() => document.fonts.ready)
          // Only visible material belongs to this viewport. Below-fold previews remain lazy.
          const visiblePreviewsLoaded = () =>
            [...document.querySelectorAll('.media-placeholder')].every((node) => {
              const bounds = node.getBoundingClientRect()
              return (
                bounds.width === 0 ||
                bounds.height === 0 ||
                bounds.bottom < 0 ||
                bounds.top > window.innerHeight ||
                !node.textContent.includes('not loaded')
              )
            })
          await page.waitForFunction(visiblePreviewsLoaded)
          await page.waitForFunction(() => [...document.images].every((image) => image.complete))
          const unresolved = await page.locator('.media-placeholder').evaluateAll((nodes) =>
            nodes
              .filter((node) => {
                const bounds = node.getBoundingClientRect()
                return (
                  bounds.width > 0 &&
                  bounds.height > 0 &&
                  bounds.bottom >= 0 &&
                  bounds.top <= window.innerHeight
                )
              })
              .map((node) => node.textContent),
          )
          unresolved.push(
            ...(await page.locator('img').evaluateAll((images) =>
              images
                .filter((image) => {
                  const bounds = image.getBoundingClientRect()
                  return (
                    bounds.width > 0 &&
                    bounds.height > 0 &&
                    bounds.bottom >= 0 &&
                    bounds.top <= window.innerHeight &&
                    (!image.complete || image.naturalWidth === 0)
                  )
                })
                .map((image) => `Image not loaded: ${image.alt || 'untitled image'}`),
            )),
          )
          if (unresolved.length)
            throw new Error(`Visible captured material is unavailable: ${unresolved.join('; ')}`)
          const file = `${name}-${viewportName}-${theme.toLowerCase()}.png`
          await page.screenshot({
            path: resolve(output, file),
            fullPage: true,
            animations: 'disabled',
          })
          entries.push({
            material: name,
            viewport,
            theme: theme.toLowerCase(),
            file,
          })
          await writeManifest()
        }
      } finally {
        await context.close()
        await host.close()
      }
    }
  completed = true
} finally {
  await browser.close()
  await writeManifest()
}
console.log(`Captured ${entries.length} browser states in ${output}`)
