import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import {
  childFixture,
  contactFixture,
  documentFixture,
  factoryFixture,
  hostFixture,
  kitchenFixture,
  patchFixture,
  patchText,
  supportFixture,
} from './browser-fixtures.mjs'
import { startBrowserFixture } from './browser-server.mjs'

let browser
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.JIG_BROWSER_EXECUTABLE
      ? { executablePath: process.env.JIG_BROWSER_EXECUTABLE }
      : {}),
  })
})
after(async () => {
  await browser?.close()
})

async function withPage(fixture, options, run) {
  const host = await startBrowserFixture(fixture)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    ...options,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(host.url)
    await page.getByRole('button', { name: 'Close inspection', exact: true }).waitFor()
    await page.getByText('Connected', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).hash, '', 'capability is removed after startup')
    await run(page, host)
    assert.deepEqual(errors, [], 'the mounted application has no uncaught browser errors')
    assert(
      host.requests
        .filter((request) => request.path.startsWith('/api/'))
        .every((request) => request.authorized),
    )
  } catch (error) {
    error.message += `\nMounted page: ${(await page.locator('body').innerText()).slice(0, 5000)}`
    throw error
  } finally {
    await context.close()
    await host.close()
  }
}

async function noPageOverflow(page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'page-level horizontal overflow',
  )
}

async function readableTextContrast(page) {
  const result = await page.evaluate(() => {
    const rgb = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number)
      if (!parts || parts.length < 3) throw new Error(`Unsupported computed color: ${value}`)
      return [parts[0], parts[1], parts[2], parts[3] ?? 1]
    }
    const over = (foreground, background) => [
      ...foreground
        .slice(0, 3)
        .map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3])),
      1,
    ]
    const background = (node) => {
      const color = rgb(getComputedStyle(node).backgroundColor)
      return color[3] === 1
        ? color
        : over(color, node.parentElement ? background(node.parentElement) : [255, 255, 255, 1])
    }
    const luminance = (color) => {
      const linear = color.slice(0, 3).map((channel) => {
        const fraction = channel / 255
        return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const failures = []
    let samples = 0
    let materialSamples = 0
    let literalSamples = 0
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode
      const node = text.parentElement
      if (
        !node ||
        !text.textContent.trim() ||
        node.closest(
          'script,style,svg,.visually-hidden,.screen-reader-status,[disabled],[aria-hidden=true]',
        )
      )
        continue
      const style = getComputedStyle(node)
      const range = document.createRange()
      range.selectNodeContents(text)
      const bounds = range.getBoundingClientRect()
      if (
        !bounds.width ||
        !bounds.height ||
        style.visibility !== 'visible' ||
        Number(style.opacity) === 0
      )
        continue
      samples++
      if (node.closest('.application-page')) materialSamples++
      if (node.closest('bdi.literal')) literalSamples++
      const backdrop = background(node)
      const foreground = over(rgb(style.color), backdrop)
      const first = luminance(foreground),
        second = luminance(backdrop)
      const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      const fontSize = Number.parseFloat(style.fontSize)
      const minimum =
        fontSize >= 24 || (fontSize >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700)
          ? 3
          : 4.5
      if (ratio + 0.01 < minimum)
        failures.push({
          text: text.textContent.trim().slice(0, 80),
          ratio: Number(ratio.toFixed(2)),
          minimum,
          color: style.color,
        })
    }
    return { failures, samples, materialSamples, literalSamples }
  })
  assert(
    result.samples > 0 && result.materialSamples > 0 && result.literalSamples > 0,
    'contrast samples include visible supplied application text and literal owners',
  )
  assert.deepEqual(
    result.failures,
    [],
    'visible text meets its size-appropriate contrast threshold',
  )
}

async function completePatch(page, selector = '.captured-media') {
  const region = page
    .locator(selector)
    .filter({ hasText: /review\.patch/ })
    .first()
  await region.scrollIntoViewIfNeeded()
  const code = region.locator('pre').filter({ hasText: 'const count = 2' }).first()
  await code.waitFor()
  assert.equal(
    await code.textContent(),
    patchText,
    'complete captured patch bytes are readable inline',
  )
}

async function openTab(page, name) {
  await page.getByRole('tab', { name: new RegExp(`^${name}(?:\\s|$)`) }).click()
}

test('Execution and delivered files reveal and dismiss details only on request', async () => {
  await withPage(hostFixture(), {}, async (page, host) => {
    await openTab(page, 'Execution')
    assert.equal(await page.locator('.call-detail').count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Execution', exact: true }).count(), 1)
    const call = page.locator('[data-call="group"]')
    await call.click()
    await page.locator('.call-detail').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.call-detail').count(), 0)
    assert(await call.evaluate((node) => node === document.activeElement))
    await call.click()
    const callSearch = page.getByRole('textbox', { name: 'Find observed calls', exact: true })
    await callSearch.fill('Copy')
    assert.equal(await call.count(), 0)
    await page.locator('.call-detail').waitFor()
    await page.getByRole('tab', { name: /^Execution(?:\s|$)/ }).focus()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.call-detail').count(), 0)
    assert(await callSearch.evaluate((node) => node === document.activeElement))
    await callSearch.fill('')
    await openTab(page, 'Delivered files')
    assert.equal(await page.locator('.detail').count(), 0)
    await page.getByRole('button', { name: /review\.patch/ }).click()
    await page.locator('.detail').waitFor()
    await completePatch(page, '.file-preview')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.detail').count(), 0)
    assert(host.requests.some((request) => request.path.endsWith('/preview') && request.authorized))
    await openTab(page, 'Activity')
    await page
      .getByText('The caption proposal has been checked. Source photographs remain unchanged.', {
        exact: true,
      })
      .waitFor()
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
    const diagnostic = page.locator('.diagnostic')
    if (await diagnostic.count()) await diagnostic.locator('summary').click()
    await page
      .locator('.diagnostic .report')
      .filter({ hasText: 'Synthetic diagnostic for evidence inspection. No work was restarted.' })
      .waitFor()
  })
})

test('child material stays complete and filtering preserves visible detail ownership and focus', async () => {
  await withPage(childFixture(), {}, async (page) => {
    await openTab(page, 'Specialist material')
    await page.getByText('VISIBLE FOURTH FIELD', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Alpha', exact: true }).click()
    await page.getByText('Details belong to Alpha.', { exact: true }).waitFor()
    const search = page.getByRole('textbox', { name: /Search Candidates/ })
    if (!(await search.isVisible()))
      await page
        .getByText(/Filter and sort|Search and sort|Filter or sort/, { exact: false })
        .click()
    await search.fill('Beta')
    assert(await search.evaluate((node) => node === document.activeElement))
    await page.getByText('Details belong to Alpha.', { exact: true }).waitFor()
    await search.fill('')
    assert(await search.isVisible(), 'clearing a small collection search keeps its tools open')
    assert(await search.evaluate((node) => node === document.activeElement))
    await search.fill('Beta')
    await page.getByText('Details belong to Alpha.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    assert(
      await page
        .getByRole('button', { name: 'Alpha', exact: true })
        .evaluate((node) => node === document.activeElement),
    )
  })
})

for (const [name, make, expected] of [
  ['Contact import', contactFixture, 'Ada Lovelace'],
  ['Support', supportFixture, 'END OF CUSTOMER REQUEST'],
  ['Saturday kitchen', kitchenFixture, 'Saturday timetable'],
  ['Patch review', patchFixture, '+const count = 2'],
  ['Software factory', factoryFixture, '+const count = 2'],
]) {
  test(`ordinary ${name} projection composes readable application material`, async () => {
    for (const width of [1440, 390])
      for (const theme of ['Light', 'Dark', 'Monochrome']) {
        const fixture = make()
        await withPage(fixture, { viewport: { width, height: 1000 } }, async (page) => {
          await page.getByRole('button', { name: `${theme} appearance`, exact: true }).click()
          if (['Patch review', 'Software factory'].includes(name)) await completePatch(page)
          else
            await page
              .getByText(expected, { exact: name !== 'Support' })
              .first()
              .waitFor()
          if (name === 'Saturday kitchen') {
            const csv = page.locator('.captured-media').filter({ hasText: /roster\.csv/ })
            await csv.scrollIntoViewIfNeeded()
            await csv.locator('table').waitFor()
            assert.equal(await csv.locator('tbody tr').count(), 8)
            assert.equal(
              await csv.locator('pre').textContent(),
              fixture.captures['roster.csv'].text,
            )
          }
          if (await page.locator('.application-scope').count())
            assert.equal(
              await page
                .locator('.application-scope')
                .innerText()
                .then((value) => /\b[a-f0-9]{64}\b/.test(value)),
              false,
            )
          assert.equal(await page.locator('.detail').count(), 0)
          await noPageOverflow(page)
          await readableTextContrast(page)
        })
      }
  })
}

test('incomplete snapshots fence evidence while retained material and omission disclosures stay usable', async () => {
  const fixture = hostFixture()
  const original = structuredClone(fixture.snapshot)
  await withPage(fixture, {}, async (page, host) => {
    await openTab(page, 'Delivered files')
    await page.getByRole('button', { name: /review\.patch/ }).click()
    await page.getByRole('button', { name: 'Download captured file', exact: true }).waitFor()
    host.update({
      kind: 'incomplete',
      revision: 2,
      lastCompleteRevision: 1,
      mode: original.mode,
      rootSourceId: original.rootSourceId,
      reason: 'The latest projection is incomplete.',
      workspace: original.workspace,
      context: '',
      omissions: original.omissions,
      attention: [],
      diagnostics: original.journal.filter((item) => item.kind === 'diagnostic'),
    })
    await page.getByText('Incomplete observation', { exact: true }).waitFor()
    await page
      .getByText('File references are disabled while observation is stale.', { exact: true })
      .waitFor()
    const download = page.getByRole('button', { name: 'Download captured file', exact: true })
    assert(!(await download.count()) || !(await download.isEnabled()))
    assert.equal(host.requests.filter((request) => request.path.endsWith('/download')).length, 0)
    const complete = {
      ...original,
      revision: 3,
      omissions: { calls: 2, journal: { flow: 1, host: 0, diagnostic: 0 } },
    }
    host.update(complete)
    await page.getByText('Connected', { exact: true }).waitFor()
    await openTab(page, 'Execution')
    await page
      .getByText('2 call observations omitted; tree is incomplete.', { exact: true })
      .waitFor()
    const tab = page.getByRole('tab', { name: /^Execution(?:\s|$)/ })
    await tab.focus()
    await page.keyboard.press('ArrowDown')
    const activity = page.getByRole('tab', { name: /^Activity(?:\s|$)/ })
    assert(await activity.evaluate((node) => node === document.activeElement))
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor()
    await page.getByText(/History is incomplete\. Omitted: 1 Flow reports/).waitFor()
  })
})

for (const width of [320, 390, 800]) {
  for (const publisher of ['root', 'child']) {
    test(`${publisher} material returns focus to its selected record at ${width}px`, async () => {
      const fixture = childFixture()
      if (publisher === 'root') {
        const material = fixture.snapshot.views.find((item) => item.id === 'child-review')
        material.sourceId = 'root'
        material.sourceLabel = 'Application'
      }
      await withPage(fixture, { viewport: { width, height: 900 } }, async (page) => {
        await openTab(page, 'Specialist material')
        const alpha = page.getByRole('button', { name: 'Alpha', exact: true })
        await alpha.click()
        await page.keyboard.press('Escape')
        assert(await alpha.isVisible())
        assert(await alpha.evaluate((node) => node === document.activeElement))
        await alpha.click()
        const back = page.getByRole('button', { name: /Back to records/ })
        assert(await back.isVisible())
        await back.click()
        assert(await alpha.evaluate((node) => node === document.activeElement))
      })
    })
  }
  test(`host detail navigation remains focused and usable at ${width}px`, async () => {
    await withPage(
      hostFixture(),
      { viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: true },
      async (page) => {
        await openTab(page, 'Execution')
        await page.locator('[data-call="group"]').click()
        const back = page.getByRole('button', { name: /Back to calls/ })
        assert(await back.isVisible())
        assert(await back.evaluate((node) => node === document.activeElement))
        await back.click()
        assert.equal(await page.locator('.call-detail').count(), 0)
        await noPageOverflow(page)
        if (width < 700)
          assert.equal(
            await page.getByRole('tablist').getAttribute('aria-orientation'),
            'horizontal',
          )
        for (const theme of ['Light', 'Dark', 'Monochrome']) {
          const button = page.getByRole('button', { name: `${theme} appearance`, exact: true })
          assert(await button.isVisible())
          await button.click()
          assert.equal(await button.getAttribute('aria-pressed'), 'true')
          if (width < 700) {
            const selected = page.getByRole('tab', { selected: true })
            const bounds = await selected.boundingBox()
            assert(
              bounds.x >= 0 && bounds.x + bounds.width <= width,
              'selected tab stays in the viewport after an appearance change',
            )
            const heading = page.getByRole('heading', { name: 'Execution', exact: true })
            assert(
              await heading.evaluate(
                (node) =>
                  node.getBoundingClientRect().height <=
                  Number.parseFloat(getComputedStyle(node).lineHeight) + 2,
              ),
              'a short Execution heading remains on one line',
            )
          }
        }
        const close = page.getByRole('button', { name: 'Close inspection', exact: true })
        const box = await close.boundingBox()
        assert(
          box.width >= 44 && box.height >= 44,
          'coarse pointer Close target remains at least 44px',
        )
      },
    )
  })
}

test('dismissed filtered details retain their owner and a focused visible recovery control', async () => {
  await withPage(childFixture(), {}, async (page) => {
    await openTab(page, 'Specialist material')
    const alpha = page.getByRole('button', { name: 'Alpha', exact: true })
    await alpha.click()
    const search = page.getByRole('textbox', { name: /Search Candidates/ })
    if (!(await search.isVisible()))
      await page.getByText(/Filter and sort|Search and sort|Filter or sort/).click()
    await search.fill('Beta')
    await page.getByRole('button', { name: 'Expand evidence', exact: true }).focus()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.detail').count(), 0)
    const clear = page.getByRole('button', { name: 'Clear filters', exact: true })
    assert(await clear.isVisible())
    assert(await clear.evaluate((node) => node === document.activeElement))
    await page
      .getByText('Alpha is outside the current filters. Its selection is preserved.', {
        exact: true,
      })
      .waitFor()
    await clear.click()
    assert(await alpha.isVisible())
    assert(await alpha.evaluate((node) => node === document.activeElement))
  })
})

test('captured downloads preserve complete bytes and closing fences the live browser', async () => {
  await withPage(documentFixture(), {}, async (page, host) => {
    const cover = page.locator('.document-cover img')
    await cover.waitFor()
    await cover.evaluate((image) => image.decode())
    const coverBounds = await cover.boundingBox()
    assert(
      Math.abs(coverBounds.width / coverBounds.height - 0.5) < 0.01,
      'portrait cover preserves its complete proportions',
    )
    await completePatch(page)
    const unauthorized = await fetch(`${host.origin}/api/snapshot`)
    assert.equal(unauthorized.status, 401)
    // Every UI request remains authenticated; the deliberate negative request is separate.
    host.requests.pop()
    await openTab(page, 'Delivered files')
    await page.getByRole('button', { name: /review\.patch/ }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download/ }).click()
    const download = await downloading
    const chunks = []
    for await (const chunk of await download.createReadStream()) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString(), patchText)
    assert(
      host.requests.some(
        (request) => request.path.endsWith('/download') && request.generation === 'output-1',
      ),
    )
    await page.getByRole('button', { name: 'Close inspection', exact: true }).click()
    await page.getByRole('heading', { name: /Inspection (closed|ended)/ }).waitFor()
  })
})
