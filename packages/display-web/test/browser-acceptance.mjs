import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
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

async function readableTextContrast(page, applicationMaterial = true) {
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
    result.samples > 0 &&
      (!applicationMaterial || result.materialSamples > 0) &&
      result.literalSamples > 0,
    'contrast samples include visible text and literal owners',
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
  const chooser = page.getByRole('combobox', { name: 'Choose view', exact: true })
  if (await chooser.isVisible()) {
    const option = chooser.getByRole('option', { name: new RegExp(`^${name}(?:\\s|$)`) })
    await chooser.selectOption(await option.getAttribute('value'))
    return
  }
  await page.getByRole('tab', { name: new RegExp(`^${name}(?:\\s|$)`) }).click()
}

async function requestStates(page, selector, expected) {
  const entries = await page
    .locator(selector)
    .locator('[data-request-state]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        state: node.getAttribute('data-request-state'),
        text: node.textContent.replace(/\s+/g, ' ').trim(),
      })),
    )
  assert.deepEqual(entries.map((entry) => entry.state).sort(), Object.keys(expected).sort())
  for (const entry of entries) {
    assert.match(entry.text, new RegExp(`\\b${expected[entry.state]}\\b`))
    assert(entry.text.toLowerCase().includes(entry.state.replaceAll('-', ' ')))
  }
}

async function mapGeometry(page) {
  const result = await page.locator('.composition-canvas').evaluate((canvas) => {
    const canvasBounds = canvas.getBoundingClientRect()
    const scale = canvasBounds.width / canvas.offsetWidth
    const round = (value) => Math.round(value * 100) / 100
    const rectangle = (node) => {
      const box = node.getBoundingClientRect()
      return {
        x: round((box.x - canvasBounds.x) / scale),
        y: round((box.y - canvasBounds.y) / scale),
        width: round(box.width / scale),
        height: round(box.height / scale),
      }
    }
    const nodes = [...canvas.querySelectorAll('[data-component]')].map((node) => ({
      id: node.getAttribute('data-component'),
      ...rectangle(node),
      overflowing:
        node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
      states: [...node.querySelectorAll('[data-request-state]')].map(rectangle),
    }))
    const routes = [...canvas.querySelectorAll('.composition-connection')].map((route) => ({
      path: route.querySelector('.composition-route').getAttribute('d'),
      background: rectangle(route.querySelector('.composition-slot-background')),
      labels: [...route.querySelectorAll('text')]
        .filter((node) => node.textContent.trim())
        .map(rectangle),
    }))
    return { width: canvas.offsetWidth, height: canvas.offsetHeight, nodes, routes }
  })
  const contains = (outer, inner, tolerance = 1) =>
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  const canvas = { x: 0, y: 0, width: result.width, height: result.height }
  for (const node of result.nodes) {
    assert(contains(canvas, node), 'every component remains inside the shared canvas')
    assert(!node.overflowing, `${node.id} retains all label and state text within its card`)
    for (const state of node.states)
      assert(contains(node, state), `${node.id} contains its complete request-state summary`)
  }
  for (const [index, node] of result.nodes.entries())
    for (const other of result.nodes.slice(index + 1))
      assert(
        node.x + node.width <= other.x ||
          other.x + other.width <= node.x ||
          node.y + node.height <= other.y ||
          other.y + other.height <= node.y,
        'mounted component cards do not overlap',
      )
  for (const route of result.routes) {
    assert(contains(canvas, route.background), 'slot summaries remain inside the shared canvas')
    for (const label of route.labels)
      assert(
        contains(route.background, label),
        'complete slot names, counts and state labels fit their route region',
      )
  }
  return {
    width: result.width,
    height: result.height,
    nodes: result.nodes.map(({ states, overflowing, ...node }) => node),
    routes: result.routes.map(({ labels, ...route }) => route),
  }
}

test('Run map separates mixed retained states, shared slots and unmatched evidence', async () => {
  await withPage(compositionFixture(), {}, async (page) => {
    await openTab(page, 'Application map')
    await page.getByRole('button', { name: 'All requests 9', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Active 2', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Needs attention 2', exact: true }).waitFor()
    await requestStates(page, '[data-composition-node-states="worker"]', {
      requested: 1,
      active: 1,
      'cancel-requested': 1,
      returned: 2,
      failed: 1,
      uncertain: 1,
    })
    await requestStates(page, '[data-composition-node-states="reviewer"]', { returned: 1 })
    await requestStates(page, '[data-composition-node-states="http"]', { active: 1 })
    await requestStates(page, '[data-composition-edge-states="prepare-route"]', {
      active: 1,
      returned: 2,
      failed: 1,
    })
    await requestStates(page, '[data-composition-edge-states="retry-route"]', {
      requested: 1,
      'cancel-requested': 1,
      uncertain: 1,
    })
    assert.equal(await page.locator('[data-composition-edge="prepare-route"]').textContent(), '4')
    assert.equal(await page.locator('[data-composition-edge="retry-route"]').textContent(), '3')
    assert.equal(
      await page.locator('[data-component="application"] [data-request-state]').count(),
      0,
    )
    assert.equal(
      await page.locator('[data-component="checkpoint"] [data-request-state]').count(),
      0,
    )
    assert.doesNotMatch(
      await page.locator('[data-component="checkpoint"]').textContent(),
      /\b(skipped|succeeded)\b/i,
    )
    await page
      .getByText('4 call observations are omitted. Counts describe retained observations only.', {
        exact: true,
      })
      .waitFor()
    await page
      .getByText('2 retained observations cannot be placed on this map', { exact: true })
      .waitFor()
    await mapGeometry(page)
    await page.locator('[data-component="worker"]').click()
    assert.deepEqual(
      await page
        .locator('[data-composition-call]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-composition-call'))),
      [
        'prepare-one',
        'prepare-two',
        'prepare-three',
        'prepare-four',
        'retry-one',
        'retry-two',
        'retry-three',
      ],
    )
    await page
      .getByRole('combobox', { name: 'Find a component', exact: true })
      .selectOption('reviewer')
    assert.deepEqual(
      await page
        .locator('[data-composition-call]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-composition-call'))),
      ['approve-one'],
    )
  })
})

test('Run map focus preserves geometry and keyboard reachability through observation replacement', async () => {
  const fixture = compositionFixture()
  const mixed = structuredClone(fixture.snapshot)
  fixture.snapshot.calls = []
  fixture.snapshot.views = fixture.snapshot.views.filter((item) => item.sourceId === 'root')
  fixture.snapshot.omissions.calls = 0
  await withPage(fixture, {}, async (page, host) => {
    await openTab(page, 'Application map')
    await page.getByRole('button', { name: 'All requests 0', exact: true }).waitFor()
    const initialGeometry = await mapGeometry(page)
    host.update({ ...mixed, revision: 2 })
    await page.getByRole('button', { name: 'All requests 9', exact: true }).waitFor()
    const geometry = await mapGeometry(page)
    assert.deepEqual(
      geometry,
      initialGeometry,
      'new mixed observations fit the existing Run-map geometry',
    )
    for (const focus of ['active', 'attention', 'all']) {
      const button = page.locator(`[data-request-focus="${focus}"]`)
      await button.click()
      assert.equal(await button.getAttribute('aria-pressed'), 'true')
      assert.deepEqual(
        await mapGeometry(page),
        geometry,
        'focus changes emphasis, not map positions or visible labels',
      )
      assert.equal(await page.locator('[data-component]').count(), 5)
      for (const node of await page.locator('[data-component]').all()) {
        assert(await node.isVisible())
        assert(await node.isEnabled())
      }
    }
    await page.locator('[data-request-focus="active"]').click()
    await page.locator('[data-component="application"]').click()
    const routeStyle = (edge) =>
      page
        .locator(
          `.composition-connection:has([data-composition-edge="${edge}"]) .composition-route`,
        )
        .evaluate((node) => {
          const style = getComputedStyle(node)
          return {
            opacity: Number(style.strokeOpacity),
            width: Number.parseFloat(style.strokeWidth),
          }
        })
    const activeRoute = await routeStyle('prepare-route')
    const returnedRoute = await routeStyle('approve-route')
    assert(
      activeRoute.opacity > returnedRoute.opacity && activeRoute.width > returnedRoute.width,
      'selecting their shared root preserves the distinction between active and returned-only routes',
    )
    assert.deepEqual(await mapGeometry(page), geometry)
    const worker = page.locator('[data-component="worker"]')
    await worker.focus()
    await page.keyboard.press('ArrowRight')
    const reviewer = page.locator('[data-component="reviewer"]')
    assert(await reviewer.evaluate((node) => node === document.activeElement))
    await page.keyboard.press('Enter')
    assert.equal(await reviewer.getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Escape')
    await page.locator('[data-request-focus="attention"]').click()
    const changed = structuredClone(mixed)
    changed.revision = 3
    changed.calls.find((call) => call.id === 'prepare-one').state = 'returned'
    changed.calls.find((call) => call.id === 'fetch-one').state = 'uncertain'
    host.update(changed)
    await page.getByRole('button', { name: 'Active 0', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Needs attention 3', exact: true }).waitFor()
    assert.equal(
      await page.locator('[data-request-focus="attention"]').getAttribute('aria-pressed'),
      'true',
    )
    assert.equal(await reviewer.getAttribute('aria-pressed'), 'true')
    await mapGeometry(page)
    host.update({
      ...changed,
      revision: 4,
      rootSourceId: 'next-run',
      calls: [],
      views: changed.views
        .filter((item) => item.sourceId === 'root')
        .map((item) => ({ ...item, sourceId: 'next-run' })),
      omissions: { ...changed.omissions, calls: 0 },
      artifacts: { ...changed.artifacts, sourceId: 'next-run' },
    })
    await page.getByRole('button', { name: 'All requests 0', exact: true }).waitFor()
    assert.equal(
      await page.locator('[data-request-focus="all"]').getAttribute('aria-pressed'),
      'true',
    )
    assert.equal(await page.locator('[data-component][aria-pressed="true"]').count(), 0)
  })
})

test('an incomplete observation retains the readable map and fences exact request navigation', async () => {
  const fixture = compositionFixture()
  const original = structuredClone(fixture.snapshot)
  await withPage(fixture, {}, async (page, host) => {
    await openTab(page, 'Application map')
    await page.locator('[data-component="worker"]').click()
    const requests = page.locator('[data-composition-call]')
    assert.equal(await requests.count(), 7)
    host.update({
      kind: 'incomplete',
      revision: 2,
      lastCompleteRevision: 1,
      mode: original.mode,
      rootSourceId: original.rootSourceId,
      reason: 'The latest map observation is incomplete.',
      workspace: original.workspace,
      context: '',
      omissions: original.omissions,
      attention: [],
      diagnostics: [],
    })
    await page.getByText('Incomplete observation', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-component]').count(), 5)
    assert.equal(await requests.count(), 7)
    for (const request of await requests.all()) assert(!(await request.isEnabled()))
    await requestStates(page, '[data-composition-node-states="worker"]', {
      requested: 1,
      active: 1,
      'cancel-requested': 1,
      returned: 2,
      failed: 1,
      uncertain: 1,
    })
    host.update({ ...original, revision: 3 })
    await page.getByText('Connected', { exact: true }).waitFor()
    assert.equal(
      await page.locator('[data-component="worker"]').getAttribute('aria-pressed'),
      'true',
    )
    for (const request of await requests.all()) assert(await request.isEnabled())
    assert(
      host.requests.every((request) => request.method === 'GET'),
      'map inspection never submits work',
    )
  })
})

for (const width of [1440, 390]) {
  test(`an exact map request opens its own child material and returns to the same component at ${width}px`, async () => {
    await withPage(compositionFixture(), { viewport: { width, height: 1000 } }, async (page) => {
      await openTab(page, 'Application map')
      await page.locator('[data-request-focus="attention"]').click()
      await page.locator('[data-component="worker"]').click()
      await page.locator('[data-composition-call="prepare-one"]').click()
      const firstView = page.locator('[data-call-view="worker-one-notes"]')
      await firstView.waitFor()
      assert.deepEqual(
        await page
          .locator('[data-call-view]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-call-view'))),
        ['worker-one-notes'],
      )
      await firstView.click()
      await page
        .getByText('These notes belong to the first worker request.', { exact: true })
        .waitFor()
      assert.equal(
        await page
          .getByText('These notes belong to the second worker request.', { exact: true })
          .count(),
        0,
      )
      const back = page.locator('#invocation-return')
      assert(await back.isVisible())
      assert(await back.isEnabled())
      assert(await back.evaluate((node) => node === document.activeElement))
      await back.click()
      await page
        .getByRole('heading', { name: 'Prepare the first candidate', exact: true })
        .waitFor()
      await firstView.waitFor()
      const map = page.locator('.composition-return')
      if (!(await map.isVisible()))
        await page.getByRole('button', { name: '← Back to calls', exact: true }).click()
      await map.click()
      assert.equal(
        await page.locator('[data-component="worker"]').getAttribute('aria-pressed'),
        'true',
      )
      assert.equal(
        await page.locator('[data-request-focus="attention"]').getAttribute('aria-pressed'),
        'true',
      )
      if (width < 1120)
        assert(
          await page
            .locator('.back-to-components')
            .evaluate((node) => node === document.activeElement),
        )
      else
        assert(
          await page
            .locator('[data-component="worker"]')
            .evaluate((node) => node === document.activeElement),
        )
      await page.locator('[data-composition-call="prepare-two"]').click()
      await page.locator('[data-call-view="worker-two-notes"]').waitFor()
      assert.deepEqual(
        await page
          .locator('[data-call-view]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-call-view'))),
        ['worker-two-notes'],
      )
      await noPageOverflow(page)
    })
  })

  test(`Run-map summaries and focus controls remain readable in every appearance at ${width}px`, async () => {
    await withPage(
      compositionFixture(),
      { viewport: { width, height: 1000 }, hasTouch: true },
      async (page) => {
        await openTab(page, 'Application map')
        for (const theme of ['Light', 'Dark', 'Monochrome']) {
          await page.getByRole('button', { name: `${theme} appearance`, exact: true }).click()
          const attention = page.locator('[data-request-focus="attention"]')
          await attention.focus()
          await page.keyboard.press('Enter')
          assert.equal(await attention.getAttribute('aria-pressed'), 'true')
          assert(await attention.evaluate((node) => node === document.activeElement))
          const outline = await attention.evaluate((node) => {
            const style = getComputedStyle(node)
            return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
          })
          assert(
            outline.style !== 'none' && outline.width >= 2,
            'keyboard focus stays visibly outlined',
          )
          for (const control of await page.locator('[data-request-focus]').all()) {
            const box = await control.boundingBox()
            assert(
              box.width >= 44 && box.height >= 44,
              'coarse-pointer request-focus controls remain at least 44px',
            )
          }
          await requestStates(page, '[data-composition-node-states="worker"]', {
            requested: 1,
            active: 1,
            'cancel-requested': 1,
            returned: 2,
            failed: 1,
            uncertain: 1,
          })
          await mapGeometry(page)
          await readableTextContrast(page, false)
          await noPageOverflow(page)
        }
      },
    )
  })
}

test('child-view return is fenced by incomplete observations and by loss of its exact origin', async () => {
  const fixture = compositionFixture()
  const original = structuredClone(fixture.snapshot)
  await withPage(fixture, {}, async (page, host) => {
    await openTab(page, 'Application map')
    await page.locator('[data-component="worker"]').click()
    await page.locator('[data-composition-call="prepare-one"]').click()
    await page.locator('[data-call-view="worker-one-notes"]').click()
    const back = page.locator('#invocation-return')
    await back.waitFor()
    host.update({
      kind: 'incomplete',
      revision: 2,
      lastCompleteRevision: 1,
      mode: original.mode,
      rootSourceId: original.rootSourceId,
      reason: 'The originating invocation cannot be refreshed.',
      workspace: original.workspace,
      context: '',
      omissions: original.omissions,
      attention: [],
      diagnostics: [],
    })
    await page.getByText('Incomplete observation', { exact: true }).waitFor()
    assert(!(await back.isEnabled()))
    await page
      .getByText(
        'Invocation links are unavailable while this observation is stale or incomplete.',
        { exact: true },
      )
      .waitFor()
    await page
      .getByText('These notes belong to the first worker request.', { exact: true })
      .waitFor()
    host.update({ ...original, revision: 3 })
    await page.getByText('Connected', { exact: true }).waitFor()
    assert(await back.isEnabled())
    host.update({
      ...original,
      revision: 4,
      calls: original.calls.filter((call) => call.id !== 'prepare-one'),
    })
    await page
      .getByText('The originating invocation is no longer available in this observation.', {
        exact: true,
      })
      .waitFor()
    assert(!(await back.isEnabled()))
    await page
      .getByText('These notes belong to the first worker request.', { exact: true })
      .waitFor()
    host.update({
      ...original,
      revision: 5,
      rootSourceId: 'another-run',
      calls: [],
      views: original.views.map((item) =>
        item.sourceId === 'root' ? { ...item, sourceId: 'another-run' } : item,
      ),
      artifacts: { ...original.artifacts, sourceId: 'another-run' },
    })
    await back.waitFor({ state: 'detached' })
    assert(
      host.requests.every((request) => request.method === 'GET'),
      'view navigation and reconciliation never submit execution',
    )
  })
})

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

for (const width of [390, 1440]) {
  test(`captured block evidence restores its originating button at ${width}px`, async () => {
    await withPage(patchFixture(), { viewport: { width, height: 900 } }, async (page) => {
      await page.locator('.captured-block .captured-media summary').first().click()
      const source = page.locator('.captured-block button.reference').first()
      await source.click()
      await page.locator('.detail').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.detail').count(), 0)
      assert(await source.isVisible())
      assert(await source.evaluate((node) => node === document.activeElement))
    })
  })
}

test('a removed selected file neither hides the inventory nor selects another file', async () => {
  const fixture = patchFixture()
  await withPage(fixture, { viewport: { width: 390, height: 900 } }, async (page, host) => {
    await openTab(page, 'Delivered files')
    const original = page.locator('.file-record').first()
    const selectedId = await original.getAttribute('data-record')
    await original.click()
    await page.locator('.detail').waitFor()
    const next = structuredClone(fixture.snapshot)
    next.revision += 1
    next.artifacts.files = next.artifacts.files.filter((file) => file.id !== selectedId)
    assert(next.artifacts.files.length > 0, 'a different retained file remains available')
    host.update(next)
    await page.getByText('The previously selected file is no longer in the retained inventory.', {
      exact: true,
    }).waitFor()
    assert.equal(await page.locator('.workspace.host-page.show-detail').count(), 0)
    assert.equal(await page.locator('.detail').count(), 0)
    assert.equal(await page.locator('.file-record[aria-pressed="true"]').count(), 0)
    assert(await page.locator('.workspace.host-page .records').isVisible())
    const picker = page.locator('.mobile-view-picker select')
    assert(await picker.evaluate((node) => node === document.activeElement),
      'focus returns to the mobile view picker instead of the removed file detail')

    await page.locator('.file-record').first().click()
    await page.locator('.detail').waitFor()
    const empty = structuredClone(next)
    empty.revision += 1
    empty.artifacts.files = []
    host.update(empty)
    await page.getByText('The verified inventory is empty.', { exact: true }).waitFor()
    assert.equal(await page.locator('.workspace.host-page.show-detail').count(), 0)
    assert(await page.locator('.workspace.host-page .records').isVisible())
  })
})

test('collection search keeps focus and caret when an update changes the section layout', async () => {
  const fixture = childFixture()
  await withPage(fixture, {}, async (page, host) => {
    await openTab(page, 'Specialist material')
    const search = page.getByRole('textbox', { name: /Search Candidates/ })
    if (!(await search.isVisible()))
      await page.locator('.collection-tools summary').first().click()
    await search.fill('Alpha')
    await search.evaluate((input) => input.setSelectionRange(2, 2))
    assert(await search.evaluate((input) => input === document.activeElement))

    const next = structuredClone(fixture.snapshot)
    next.revision += 1
    const published = next.views.find((item) => item.id === 'child-review')
    assert(published)
    published.value.sections[0].blocks.push({
      kind: 'report',
      format: 'diff',
      text: '+Additional comparison context',
    })
    host.update(next)
    await page.locator('.application-section-comparison .collection-search input').waitFor()
    const replacement = page.getByRole('textbox', { name: /Search Candidates/ })
    assert(await replacement.evaluate((input) => input === document.activeElement),
      'typing should continue in the same collection after the update')
    assert.equal(await replacement.inputValue(), 'Alpha')
    assert.deepEqual(
      await replacement.evaluate((input) => [input.selectionStart, input.selectionEnd]),
      [2, 2],
    )
  })
})

for (const width of [390, 1440]) {
  test(`captured evidence returns to its exact origin after a layout update at ${width}px`, async () => {
    const fixture = hostFixture()
    fixture.snapshot.views[0].value.sections = [{
      title: 'Captured patch',
      blocks: [{
        kind: 'content',
        title: 'Proposed change',
        reference: { kind: 'artifact', attachment: 'deliverables', path: 'review.patch' },
      }],
    }]
    await withPage(fixture, { viewport: { width, height: 900 } }, async (page, host) => {
      await page.locator('.captured-block summary').first().click()
      const reference = page.locator('.captured-block button.reference').first()
      await reference.click()
      const original = await reference.elementHandle()
      await page.locator('.detail').waitFor()
      const next = structuredClone(fixture.snapshot)
      next.revision += 1
      next.views[0].value.sections[0].blocks.push({
        kind: 'report',
        text: 'Additional review context',
      })
      host.update(next)
      await page.locator('.application-section-comparison').waitFor({ state: 'attached' })
      assert.equal(await original.evaluate((node) => node.isConnected), false,
        'the publisher update must replace the original evidence control')
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.detail').count(), 0)
      const restored = page.locator('.captured-block button.reference').first()
      assert(await restored.isVisible(), 'the correct source disclosure is reopened')
      assert(await restored.evaluate((node) => node === document.activeElement),
        'focus returns to the exact retained reference rather than the page body')
    })
  })
}

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
        if (width < 700) {
          assert(await page.getByRole('combobox', { name: 'Choose view' }).isVisible())
          assert.equal(await page.getByRole('tablist').count(), 0)
          assert(
            await page.locator('.workbench-breadcrumb > span:first-child').isVisible(),
            'application context remains visible',
          )
        }
        for (const theme of ['Light', 'Dark', 'Monochrome']) {
          const button = page.getByRole('button', { name: `${theme} appearance`, exact: true })
          assert(await button.isVisible())
          await button.click()
          assert.equal(await button.getAttribute('aria-pressed'), 'true')
          if (width < 700) {
            const selected = page.getByRole('combobox', { name: 'Choose view' })
            const bounds = await selected.boundingBox()
            assert(
              bounds.x >= 0 && bounds.x + bounds.width <= width,
              'the complete view chooser stays in the viewport after an appearance change',
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

test('narrow generic tables preserve readable identifiers and local scrolling', async () => {
  const fixture = childFixture()
  const material = fixture.snapshot.views.find((item) => item.id === 'child-review')
  const token = 'record_0000000000'
  material.value.sections[0].blocks[0].rows[0].cells.extra = token
  await withPage(fixture, { viewport: { width: 390, height: 900 } }, async (page) => {
    await openTab(page, 'Specialist material')
    const value = page.getByText(token, { exact: true })
    await value.scrollIntoViewIfNeeded()
    assert.equal(
      await value.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      }),
      1,
      'an ordinary opaque identifier fits one readable table cell line',
    )
    await noPageOverflow(page)
  })
})

test('short columns leave room for readable references without unnecessary narrow scrolling', async () => {
  const fixture = childFixture()
  const collection = fixture.snapshot.views.find((item) => item.id === 'child-review').value
    .sections[0].blocks[0]
  collection.columns = [
    { key: 'name', label: 'ID', type: 'text' },
    { key: 'extra', label: 'Reference', type: 'text' },
  ]
  collection.rows.forEach((row, index) => {
    row.cells = { name: String(index + 1), extra: 'record_0000000000' }
  })
  await withPage(fixture, { viewport: { width: 320, height: 900 } }, async (page) => {
    await openTab(page, 'Specialist material')
    const table = page.getByRole('region', { name: 'Candidates', exact: true })
    assert(
      await table.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      'two concise columns fit the narrow reading area',
    )
    assert.equal(await page.getByRole('button', { name: 'Scroll Candidates right' }).count(), 0)
    await noPageOverflow(page)
  })
})

test('wide collections expose their remaining columns through usable scroll controls', async () => {
  const fixture = childFixture()
  await withPage(
    fixture,
    { viewport: { width: 320, height: 900 }, hasTouch: true },
    async (page) => {
      await openTab(page, 'Specialist material')
      const right = page.getByRole('button', { name: 'Scroll Candidates right', exact: true })
      await right.waitFor()
      assert(await right.isEnabled())
      const table = page.getByRole('region', { name: 'Candidates', exact: true })
      const element = await table.elementHandle()
      for (let step = 0; step < 12; step++) {
        if (
          await table.evaluate((node) => node.scrollLeft + node.clientWidth >= node.scrollWidth - 1)
        )
          break
        const previous = await table.evaluate((node) => node.scrollLeft)
        await right.click()
        await page.waitForFunction(({ element, previous }) => element.scrollLeft > previous, {
          element,
          previous,
        })
      }
      await page.waitForFunction((button) => button.disabled, await right.elementHandle())
      assert(
        await table.evaluate((node) => node.scrollLeft + node.clientWidth >= node.scrollWidth - 1),
      )
      const left = page.getByRole('button', { name: 'Scroll Candidates left', exact: true })
      assert(await left.isEnabled())
      assert((await left.boundingBox()).height >= 44)
      assert((await left.boundingBox()).width >= 44)
      await left.click()
      await page.waitForFunction((button) => !button.disabled, await right.elementHandle())
      assert(await right.isEnabled())
      await page.getByRole('button', { name: 'Monochrome appearance' }).click()
      await noPageOverflow(page)
    },
  )
})

test('narrow view chooser reaches the final child destination and preserves panel return', async () => {
  await withPage(childFixture(), { viewport: { width: 320, height: 900 } }, async (page) => {
    const chooser = page.getByRole('combobox', { name: 'Choose view', exact: true })
    await openTab(page, 'Specialist material')
    const selected = await chooser.inputValue()
    assert.match(
      await chooser.locator('option:checked').textContent(),
      /Specialist material.*Repair specialist/,
    )
    await page.getByRole('button', { name: 'Help & shortcuts', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(await chooser.inputValue(), selected)
    await page.getByRole('region', { name: 'Specialist material', exact: true }).waitFor()
    await noPageOverflow(page)
  })
})

test('changing navigation layout preserves keyboard focus and the chosen view', async () => {
  await withPage(hostFixture(), { viewport: { width: 390, height: 900 } }, async (page) => {
    await openTab(page, 'Execution')
    const chooser = page.getByRole('combobox', { name: 'Choose view', exact: true })
    await chooser.focus()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const tab = page.getByRole('tab', { name: 'Execution', exact: true })
    await page.waitForFunction((node) => node === document.activeElement, await tab.elementHandle())
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForFunction(
      (node) => node === document.activeElement,
      await chooser.elementHandle(),
    )
    await page.getByRole('region', { name: 'Execution', exact: true }).waitFor()
  })
})

test('adjacent authored reading sections share wide space and retain their order when narrow', async () => {
  const fixture = childFixture()
  const material = fixture.snapshot.views.find((item) => item.id === 'child-review')
  material.value.sections = [
    {
      title: 'First account',
      blocks: [{ kind: 'report', text: 'A complete first account. '.repeat(30) }],
    },
    { title: 'Second account', blocks: [{ kind: 'report', text: 'A complete second account.' }] },
    {
      title: 'Retained context',
      blocks: [{ kind: 'facts', items: [{ label: 'Source', value: 'Supplied' }] }],
    },
  ]
  await withPage(fixture, {}, async (page) => {
    await openTab(page, 'Specialist material')
    const first = page.getByRole('heading', { name: 'First account', exact: true }).locator('..')
    const second = page.getByRole('heading', { name: 'Second account', exact: true }).locator('..')
    const context = page
      .getByRole('heading', { name: 'Retained context', exact: true })
      .locator('..')
    const wide = await Promise.all([
      first.boundingBox(),
      second.boundingBox(),
      context.boundingBox(),
    ])
    assert(Math.abs(wide[0].y - wide[1].y) < 2, 'both accounts begin together')
    assert(wide[1].x >= wide[0].x + wide[0].width, 'reading surfaces do not overlap')
    assert(wide[2].y >= wide[0].y + wide[0].height, 'context follows the complete reading pair')
    await page.setViewportSize({ width: 390, height: 900 })
    const narrow = await Promise.all([first.boundingBox(), second.boundingBox()])
    assert(
      narrow[1].y >= narrow[0].y + narrow[0].height,
      'the authored sequence stacks on narrow screens',
    )
    assert.equal(
      await first.locator('.report').textContent(),
      material.value.sections[0].blocks[0].text,
    )
    await noPageOverflow(page)
  })
})

test('long explanations wrap while concise values retain their reading width', async () => {
  const fixture = childFixture()
  const collection = fixture.snapshot.views.find((item) => item.id === 'child-review').value
    .sections[0].blocks[0]
  const explanation =
    'A complete explanation stays readable without scrolling away from its record.'
  collection.columns = [
    { key: 'name', label: 'ID', type: 'text' },
    { key: 'extra', label: 'Explanation', type: 'text' },
  ]
  collection.rows.forEach((row, index) => {
    row.cells = { name: String(index + 1), extra: explanation }
  })
  await withPage(fixture, { viewport: { width: 320, height: 900 } }, async (page) => {
    await openTab(page, 'Specialist material')
    const table = page.getByRole('region', { name: 'Candidates', exact: true })
    assert(await table.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    assert.equal(await table.getByText(explanation, { exact: true }).count(), 2)
    assert.equal(await page.getByRole('button', { name: 'Scroll Candidates right' }).count(), 0)
    await noPageOverflow(page)
  })
})
