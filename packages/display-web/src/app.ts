import type {
  DisplayAttribution,
  DisplaySnapshot,
  DisplaySnapshotEnvelope,
} from '@jigging/display-model'
import {
  attentionImportance,
  compositionObservations,
  detectDisplayTextFormat,
  displayDelimitedRows,
  displayTextTokens,
  displayViewKey,
} from '@jigging/display-model'
import type { DetailBlock, MediaReference, Reference, Value } from '@jigging/reporting'
import { type ComponentChildren, h, render } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApplicationPage, CapturedContent, FormattedReport } from './application.js'
import { PrivateBrowserClient, privateBrowserCapability } from './client.js'
import {
  type PrivateCompositionRequestFocus,
  type PrivateCompositionSelection,
  privateCompositionSelection,
} from './composition.js'
import { CompositionPage } from './composition-view.js'
import { startPrivateExplorer } from './explorer-app.js'
import {
  PrivateBrowserClock,
  type PrivateBrowserLocal,
  type PrivateBrowserRecord,
  privateBrowserInvocationViews,
  privateBrowserLiteral,
  privateBrowserLocal,
  privateBrowserNavigationDestination,
  privateBrowserPeek,
  privateBrowserRecords,
  privateBrowserReferences,
  privateBrowserRelatedViews,
  privateBrowserResolve,
  privateBrowserRowKey,
  privateBrowserSurvivingSelection,
  privateBrowserTabs,
  privateBrowserValue,
  privateBrowserView,
} from './navigation.js'
import {
  privateBrowserCallSpans,
  privateBrowserDuration,
  privateBrowserObservationStatus,
} from './observations.js'

let capability = privateBrowserCapability(location.hash)
let hasCapability = !!capability
history.replaceState(null, '', location.pathname)
const root = document.getElementById('app')!
const local = new Map<string, PrivateBrowserLocal>()
const previousKeys = new Map<string, string[]>()
const scrollPositions = new Map<string, number>()
const treeChoices = new Map<string, boolean>()
let destinationKey = 'activity'
let humanNavigation = false
let landed = false
let lastBodyRevision = 0
let lastRootSourceId: string | undefined
let previousCallKeys: string[] = []
const elapsedClock = new PrivateBrowserClock()
let selectedCall: string | undefined
let compositionSelection: PrivateCompositionSelection = {}
let compositionViewport: { left: number; top: number } | undefined
let compositionCenterNodeId: string | undefined
let lastCompositionViewport: HTMLElement | undefined
let compositionViewportVisible = false
let compositionFocusScope: HTMLElement | undefined
let compositionMapFocused = false
let compositionScale = 1
let compositionScaleMode: 'automatic' | 'fit' | 'manual' = 'automatic'
let compositionRequestFocus: PrivateCompositionRequestFocus = 'all'
let compositionResizeObserver: ResizeObserver | undefined
let compositionResizeFrame: number | undefined
type CompositionOrigin = { rootSourceId: string; rootId: string; nodeId: string }
let compositionOrigin: CompositionOrigin | undefined
type InvocationViewOrigin = {
  rootSourceId: string
  callId: string
  childSourceId: string
  composition?: CompositionOrigin
}
let invocationViewOrigin: InvocationViewOrigin | undefined
let callFilter = ''
let panel: 'attention' | 'diagnostics' | 'help' | undefined
let panelOrigin: HTMLElement | undefined
// A block reference is not a collection record; preserve its actual focus owner.
let detailOrigin: { destination: string; key: string; element: HTMLElement } | undefined
let announcement = ''
let feedback = ''
let closing = false
let clock: ReturnType<typeof setInterval> | undefined
let client: PrivateBrowserClient | undefined
const navigationMedia = matchMedia('(max-width: 700px)')
navigationMedia.addEventListener('change', () => redraw())
// A breakpoint can hide the control that currently owns keyboard focus.
const detailMedia = matchMedia('(max-width: 1000px)')
detailMedia.addEventListener('change', (event) => {
  const active = document.activeElement
  if (
    event.matches &&
    active instanceof Element &&
    active.closest(
      '.workspace.show-detail .records, .application-workspace.show-detail .application-page',
    )
  )
    document.querySelector<HTMLButtonElement>('.back-to-records')?.focus({ preventScroll: true })
})

const literal = (text: string): ComponentChildren =>
  h('bdi', { class: 'literal' }, privateBrowserLiteral(text))
const button = (label: ComponentChildren, click: () => void, props: Record<string, unknown> = {}) =>
  h('button', { type: 'button', onClick: click, ...props }, label)
const teaser = (text: string, count = 180): string => {
  let result = '',
    length = 0
  for (const character of text) {
    if (length++ >= count) return `${result}…`
    result += character
  }
  return result
}
const observationTime = (time: number): string => {
  const date = new Date(time)
  return Number.isFinite(time) && Number.isFinite(date.getTime())
    ? date.toISOString()
    : 'Observation time unavailable'
}
const currentLocal = (): PrivateBrowserLocal => {
  if (!local.has(destinationKey)) local.set(destinationKey, privateBrowserLocal())
  return local.get(destinationKey)!
}
const view = () => privateBrowserView(client?.body, destinationKey)
const isMaterialPage = () => Boolean(view())
const records = (): PrivateBrowserRecord[] => {
  const selected = view()
  return selected ? privateBrowserRecords(selected, currentLocal()) : []
}
const selectedRecord = () => {
  const selected = view()
  const state = currentLocal()
  return selected
    ? privateBrowserRecords(selected, { ...state, filters: new Map() }).find(
        (record) => record.key === state.selected,
      )
    : undefined
}
const provenance = (value: DisplayAttribution): string =>
  value.provenance === 'recorded-claim'
    ? 'Recorded claim'
    : value.provenance === 'host-observed'
      ? 'Host observation'
      : value.ancestryIncomplete
        ? 'Accepted source · ancestry incomplete'
        : value.relation === 'root'
          ? 'Root publisher'
          : value.relation === 'observed-call'
            ? 'Observed publisher'
            : 'Accepted source · relationship unavailable'

function redraw(): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  // Native scrolling can precede its queued scroll event.
  if (
    compositionViewportVisible &&
    lastCompositionViewport?.isConnected &&
    lastCompositionViewport.clientWidth &&
    lastCompositionViewport.clientHeight
  )
    rememberCompositionViewport(lastCompositionViewport)
  if (
    client?.body &&
    (client.body.revision !== lastBodyRevision || client.body.rootSourceId !== lastRootSourceId)
  ) {
    const snapshot = client.body
    if (snapshot.rootSourceId !== lastRootSourceId) {
      compositionRequestFocus = 'all'
      invocationViewOrigin = undefined
      lastRootSourceId = snapshot.rootSourceId
    }
    const nextCompositionSelection = privateCompositionSelection(snapshot, compositionSelection)
    if (
      nextCompositionSelection.rootSourceId !== compositionSelection.rootSourceId ||
      nextCompositionSelection.rootId !== compositionSelection.rootId
    ) {
      compositionViewport = undefined
      compositionCenterNodeId = undefined
      compositionOrigin = undefined
      compositionScale = 1
      compositionScaleMode = 'automatic'
      releaseCompositionViewport()
    }
    if (compositionSelection.nodeId && !nextCompositionSelection.nodeId)
      feedback = 'The selected component is no longer available in this application map.'
    compositionSelection = nextCompositionSelection
    const tabs = privateBrowserTabs(snapshot)
    const eligible = new Set(tabs.map((tab) => tab.id))
    for (const key of local.keys())
      if (!eligible.has(key)) {
        local.delete(key)
        previousKeys.delete(key)
        scrollPositions.delete(key)
      }
    for (const key of treeChoices.keys())
      if (!snapshot.calls.some((call) => call.id === key)) treeChoices.delete(key)
    if (!eligible.has(destinationKey)) {
      const first = tabs[0]
      destinationKey = first?.id ?? ''
      feedback =
        first && lastBodyRevision > 0
          ? `The selected view is unavailable; showing ${first.title}.`
          : ''
    }
    if (!humanNavigation) {
      const rootViews = snapshot.views.filter(
        (item) => item.sourceId === snapshot.rootSourceId && eligible.has(displayViewKey(item.id)),
      )
      const landing = !landed && rootViews.find((item) => item.value.landing)
      if (landing) {
        destinationKey = displayViewKey(landing.id)
        landed = true
      } else if (
        rootViews.length &&
        (destinationKey === 'activity' || snapshot.workspace.phase === 'settled')
      )
        destinationKey = displayViewKey(rootViews[0]!.id)
    }
    for (const item of snapshot.views) {
      const viewKey = displayViewKey(item.id)
      if (!local.has(viewKey)) local.set(viewKey, privateBrowserLocal())
      const state = local.get(viewKey)!
      const collections = item.value.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'collection')
      for (const key of state.filters.keys())
        if (!collections.some((collection) => collection.id === key)) state.filters.delete(key)
      for (const key of state.collectionTools.keys())
        if (!collections.some((collection) => collection.id === key))
          state.collectionTools.delete(key)
      for (const [key, sort] of state.sorts)
        if (
          !collections.some(
            (collection) =>
              collection.id === key && collection.columns.some((column) => column.key === sort.key),
          )
        )
          state.sorts.delete(key)
      const nextRecords = privateBrowserRecords(item, { ...state, filters: new Map() })
      const keys = nextRecords.map((record) => record.key)
      if (state.selected) {
        state.selected = privateBrowserSurvivingSelection(
          previousKeys.get(viewKey) ?? [],
          state.selected,
          keys,
        )
        if (!humanNavigation) {
          state.selected = nextRecords.find((record) => record.row)?.key ?? state.selected
          state.detailOpen = true
        }
      }
      previousKeys.set(viewKey, keys)
    }
    const callKeys = snapshot.calls.map((call) => call.id)
    const previousSelectedCall = selectedCall
    if (selectedCall)
      selectedCall = privateBrowserSurvivingSelection(previousCallKeys, selectedCall, callKeys)
    if (selectedCall !== previousSelectedCall) compositionOrigin = undefined
    previousCallKeys = callKeys
    if (
      destinationKey === 'files' &&
      currentLocal().selected &&
      !snapshot.artifacts.files.some((file) => file.id === currentLocal().selected)
    )
      currentLocal().selected = snapshot.artifacts.files[0]?.id
    lastBodyRevision = snapshot.revision
  }
  if (client?.current)
    elapsedClock.observe(
      client.current.revision,
      client.current.workspace.elapsedMs,
      client.current.workspace.phase === 'live',
      client.observationFresh,
      performance.now(),
    )
  const record = selectedRecord()
  const signature = record
    ? JSON.stringify([destinationKey, record.key, record.signature])
    : `${destinationKey}:${currentLocal().selected ?? ''}`
  const state = currentLocal()
  if (signature !== state.signature) {
    state.signature = signature
    state.reference = undefined
    state.previewSearch = ''
    state.previewScroll = undefined
    state.expanded = false
  }
  const snapshot = client?.body
  const reference = state.reference ?? privateBrowserPeek(record)
  const target =
    snapshot && reference && record
      ? privateBrowserResolve(snapshot, record.sourceId, reference)
      : undefined
  const file =
    destinationKey === 'files'
      ? snapshot?.artifacts.files.find((item) => item.id === currentLocal().selected)
      : undefined
  const intent =
    client?.referencesEnabled &&
    snapshot &&
    currentLocal().detailOpen &&
    !panel &&
    (target?.kind === 'artifact' || file)
      ? {
          artifactId:
            file?.id ?? (target as Extract<typeof target, { kind: 'artifact' }>).artifactId,
          captureGeneration: file
            ? snapshot.artifacts.generation
            : target?.kind === 'artifact'
              ? target.captureGeneration
              : snapshot.artifacts.generation,
          signature: JSON.stringify([
            signature,
            privateBrowserReferences(record),
            state.reference ?? null,
          ]),
        }
      : undefined
  // Setting intent may synchronously notify; an identical intent is an idempotent no-op.
  client?.setPreview(intent)
  render(h(App, {}), root)
  restoreCompositionViewport()
  if (focused && !focused.isConnected) {
    if (focused.dataset.record !== undefined)
      document.querySelector<HTMLButtonElement>('[data-record][aria-pressed=true]')?.focus()
    else if (focused.dataset.call !== undefined)
      document.querySelector<HTMLButtonElement>('[data-call][aria-pressed=true]')?.focus()
    else if (focused.dataset.component !== undefined)
      document.querySelector<HTMLButtonElement>('[data-component][aria-pressed=true]')?.focus()
    else if (focused.getAttribute('role') === 'tab')
      document.querySelector<HTMLButtonElement>('[role=tab][tabindex="0"]')?.focus()
  }
}

function navigate(id: string, preserveSubject = true): void {
  const body = document.getElementById('view-panel')
  if (body && !panel) scrollPositions.set(destinationKey, body.scrollTop)
  humanNavigation = true
  destinationKey = privateBrowserNavigationDestination(client?.body, view(), id, preserveSubject)
  detailOrigin = undefined
  if (
    invocationViewOrigin &&
    privateBrowserView(client?.body, destinationKey)?.sourceId !==
      invocationViewOrigin.childSourceId
  )
    invocationViewOrigin = undefined
  panel = undefined
  client?.setPreview(undefined)
  feedback = ''
  redraw()
  const nextBody = document.getElementById('view-panel')
  if (nextBody) nextBody.scrollTop = scrollPositions.get(id) ?? 0
}
function focusSelectedEntry(): void {
  if (destinationKey === 'composition') {
    document
      .querySelector<HTMLButtonElement>('[data-component][aria-pressed=true]')
      ?.focus({ preventScroll: true })
    return
  }
  if (
    detailOrigin?.destination === destinationKey &&
    detailOrigin.key === currentLocal().selected &&
    detailOrigin.element.isConnected &&
    detailOrigin.element.getClientRects().length > 0
  ) {
    detailOrigin.element.focus({ preventScroll: true })
    detailOrigin = undefined
    return
  }
  detailOrigin = undefined
  const selector = destinationKey === 'overview' ? '[data-call]' : '[data-record]'
  const selected = destinationKey === 'overview' ? selectedCall : currentLocal().selected
  const owner = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(
    (element) =>
      (destinationKey === 'overview' ? element.dataset.call : element.dataset.record) ===
        selected && element.getClientRects().length > 0,
  )
  if (owner) owner.focus()
  else if (destinationKey === 'overview')
    document.querySelector<HTMLInputElement>('[aria-label="Find observed calls"]')?.focus()
  else document.querySelector<HTMLButtonElement>('.selection-notice button')?.focus()
}
function focusDetailReturn(): void {
  const breakpoint =
    destinationKey === 'composition' ? '(max-width: 1120px)' : '(max-width: 1000px)'
  if (matchMedia(breakpoint).matches)
    document.querySelector<HTMLButtonElement>('.back-to-records')?.focus()
}
function select(key: string): void {
  detailOrigin = undefined
  humanNavigation = true
  currentLocal().selected = key
  currentLocal().detailOpen = true
  currentLocal().expanded = false
  currentLocal().reference = undefined
  feedback = ''
  redraw()
  focusDetailReturn()
}
function selectCall(id: string, origin?: CompositionOrigin): void {
  selectedCall = id
  compositionOrigin = origin
  invocationViewOrigin = undefined
  currentLocal().detailOpen = true
  let call = client?.body?.calls.find((item) => item.id === id)
  for (let depth = 0; call?.parentId && depth < 32; depth++) {
    treeChoices.set(call.parentId, true)
    call = client?.body?.calls.find((item) => item.id === call!.parentId)
  }
  redraw()
  if (origin) {
    const selectedButton = document.querySelector<HTMLButtonElement>(
      '[data-call][aria-pressed=true]',
    )
    if (selectedButton) selectedButton.focus()
    else document.getElementById('selected-call-heading')?.focus()
  }
  focusDetailReturn()
}

function openInvocationView(
  rootSourceId: string,
  callId: string,
  childSourceId: string,
  viewId: string,
): void {
  const snapshot = client?.body
  const child = snapshot && privateBrowserInvocationViews(snapshot, callId)
  if (
    !client?.referencesEnabled ||
    snapshot?.rootSourceId !== rootSourceId ||
    destinationKey !== 'overview' ||
    selectedCall !== callId ||
    child?.kind !== 'available' ||
    child.childSourceId !== childSourceId ||
    !child.views.some((item) => item.id === viewId)
  ) {
    feedback =
      'This reported view is unavailable for the selected invocation in the current observation.'
    redraw()
    return
  }
  invocationViewOrigin = {
    rootSourceId,
    callId,
    childSourceId,
    ...(compositionOrigin ? { composition: { ...compositionOrigin } } : {}),
  }
  navigate(displayViewKey(viewId), false)
  document.getElementById('invocation-return')?.focus()
}

function InvocationReturn(): ComponentChildren {
  const origin = invocationViewOrigin
  const snapshot = client?.body
  const selected = view()
  if (
    !origin ||
    !snapshot ||
    !selected ||
    snapshot.rootSourceId !== origin.rootSourceId ||
    selected.sourceId !== origin.childSourceId
  )
    return null
  const child = privateBrowserInvocationViews(snapshot, origin.callId)
  const available =
    child.kind === 'available' &&
    child.childSourceId === origin.childSourceId &&
    child.views.some((item) => item.id === selected.id)
  return h(
    'div',
    { class: 'invocation-context', 'aria-label': 'Invocation navigation' },
    button(
      '← Back to invocation',
      () => {
        const current = client?.body
        const currentChild = current && privateBrowserInvocationViews(current, origin.callId)
        if (
          !client?.referencesEnabled ||
          invocationViewOrigin !== origin ||
          current?.rootSourceId !== origin.rootSourceId ||
          view()?.id !== selected.id ||
          currentChild?.kind !== 'available' ||
          currentChild.childSourceId !== origin.childSourceId ||
          !currentChild.views.some((item) => item.id === selected.id)
        ) {
          feedback = 'The originating invocation is unavailable in the current observation.'
          redraw()
          return
        }
        callFilter = ''
        navigate('overview', false)
        selectCall(origin.callId, origin.composition)
        focusSelectedEntry()
        focusDetailReturn()
      },
      { id: 'invocation-return', disabled: !available || !client?.referencesEnabled },
    ),
    !available
      ? h(
          'p',
          { class: 'secondary' },
          'The originating invocation is no longer available in this observation.',
        )
      : !client?.referencesEnabled
        ? h(
            'p',
            { class: 'secondary' },
            'Invocation links are unavailable while this observation is stale or incomplete.',
          )
        : null,
  )
}

function compositionMatches(rootSourceId: string, rootId: string): boolean {
  return (
    client?.body?.rootSourceId === rootSourceId &&
    client.body.composition?.state === 'available' &&
    client.body.composition.rootId === rootId
  )
}

function releaseCompositionViewport(): void {
  compositionResizeObserver?.disconnect()
  compositionResizeObserver = undefined
  if (compositionResizeFrame !== undefined) cancelAnimationFrame(compositionResizeFrame)
  compositionResizeFrame = undefined
  lastCompositionViewport = undefined
  compositionViewportVisible = false
  compositionFocusScope?.removeEventListener('focusin', enterCompositionMap)
  compositionFocusScope?.removeEventListener('focusout', leaveCompositionMap)
  compositionFocusScope = undefined
  compositionMapFocused = false
}

function enterCompositionMap(): void {
  compositionMapFocused = true
}

function leaveCompositionMap(event: FocusEvent): void {
  // A responsive hide can blur before the resize observer runs.
  if (!compositionFocusScope?.clientWidth) return
  if (event.relatedTarget instanceof Node && compositionFocusScope.contains(event.relatedTarget))
    return
  compositionMapFocused = false
}

function compositionFitScale(viewport: HTMLElement): number | undefined {
  const width = Number(viewport.dataset.compositionWidth)
  const height = Number(viewport.dataset.compositionHeight)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !viewport.clientWidth ||
    !viewport.clientHeight
  )
    return
  return Math.min(
    1,
    Math.max(1, viewport.clientWidth - 2) / width,
    Math.max(1, viewport.clientHeight - 2) / height,
  )
}

function rememberCompositionViewport(viewport: HTMLElement): void {
  compositionViewport = { left: viewport.scrollLeft, top: viewport.scrollTop }
}

function compositionViewportCenter(viewport: HTMLElement): { x: number; y: number } | undefined {
  const canvas = viewport.querySelector<HTMLElement>('.composition-canvas')
  const scale = Number(viewport.dataset.compositionScale)
  if (
    !canvas ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !viewport.clientWidth ||
    !viewport.clientHeight
  )
    return
  const bounds = viewport.getBoundingClientRect()
  const map = canvas.getBoundingClientRect()
  return {
    x: (bounds.left + viewport.clientLeft + viewport.clientWidth / 2 - map.left) / scale,
    y: (bounds.top + viewport.clientTop + viewport.clientHeight / 2 - map.top) / scale,
  }
}

function centerCompositionPoint(viewport: HTMLElement, point: { x: number; y: number }): void {
  const canvas = viewport.querySelector<HTMLElement>('.composition-canvas')
  const scale = Number(viewport.dataset.compositionScale)
  if (
    !canvas ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !viewport.clientWidth ||
    !viewport.clientHeight
  )
    return
  const bounds = viewport.getBoundingClientRect()
  const map = canvas.getBoundingClientRect()
  viewport.scrollLeft = Math.max(
    0,
    viewport.scrollLeft +
      map.left +
      point.x * scale -
      bounds.left -
      viewport.clientLeft -
      viewport.clientWidth / 2,
  )
  viewport.scrollTop = Math.max(
    0,
    viewport.scrollTop +
      map.top +
      point.y * scale -
      bounds.top -
      viewport.clientTop -
      viewport.clientHeight / 2,
  )
  rememberCompositionViewport(viewport)
}

function centerCompositionNode(viewport: HTMLElement, node: HTMLElement): void {
  if (!viewport.clientWidth || !viewport.clientHeight) return
  const bounds = viewport.getBoundingClientRect()
  const card = node.getBoundingClientRect()
  viewport.scrollLeft = Math.max(
    0,
    viewport.scrollLeft +
      card.left +
      card.width / 2 -
      bounds.left -
      viewport.clientLeft -
      viewport.clientWidth / 2,
  )
  viewport.scrollTop = Math.max(
    0,
    viewport.scrollTop +
      card.top +
      card.height / 2 -
      bounds.top -
      viewport.clientTop -
      viewport.clientHeight / 2,
  )
  rememberCompositionViewport(viewport)
}

function restoreCompositionViewport(): void {
  let viewport =
    destinationKey === 'composition' && !panel
      ? document.getElementById('composition-scroll')
      : null
  if (!viewport) {
    releaseCompositionViewport()
    return
  }
  const restoreSavedPosition = viewport !== lastCompositionViewport || !compositionViewportVisible
  if (viewport !== lastCompositionViewport) {
    releaseCompositionViewport()
    lastCompositionViewport = viewport
    compositionFocusScope = viewport.closest<HTMLElement>('.composition-main') ?? undefined
    compositionMapFocused = compositionFocusScope?.contains(document.activeElement) ?? false
    compositionFocusScope?.addEventListener('focusin', enterCompositionMap)
    compositionFocusScope?.addEventListener('focusout', leaveCompositionMap)
    compositionResizeObserver = new ResizeObserver(() => {
      if (compositionResizeFrame !== undefined) return
      compositionResizeFrame = requestAnimationFrame(() => {
        compositionResizeFrame = undefined
        if (lastCompositionViewport?.isConnected) redraw()
      })
    })
    compositionResizeObserver.observe(viewport)
  }
  const fit = compositionFitScale(viewport)
  if (fit === undefined) {
    const active = document.activeElement
    const moveFocus =
      compositionViewportVisible &&
      compositionMapFocused &&
      (compositionFocusScope?.contains(active) ||
        active === document.body ||
        active === document.documentElement)
    compositionViewportVisible = false
    compositionMapFocused = false
    if (moveFocus && currentLocal().detailOpen) {
      focusDetailReturn()
    }
    return
  }
  compositionViewportVisible = true
  const composition = client?.body?.composition
  if (composition?.state !== 'available') return
  const scale =
    compositionScaleMode === 'fit'
      ? fit
      : compositionScaleMode === 'automatic'
        ? fit >= 0.75
          ? fit
          : 1
        : compositionScale
  const center =
    compositionViewport && !restoreSavedPosition && scale !== compositionScale
      ? compositionViewportCenter(viewport)
      : undefined
  if (scale !== compositionScale) {
    compositionScale = scale
    render(h(App, {}), root)
    viewport = document.getElementById('composition-scroll')
    if (!viewport?.clientWidth || !viewport.clientHeight) return
  }
  if (compositionCenterNodeId) {
    const selected = [...viewport.querySelectorAll<HTMLButtonElement>('[data-component]')].find(
      (element) => element.dataset.component === compositionCenterNodeId,
    )
    compositionCenterNodeId = undefined
    if (selected) {
      centerCompositionNode(viewport, selected)
      return
    }
  }
  if (center) {
    centerCompositionPoint(viewport, center)
    return
  }
  if (compositionViewport) {
    if (restoreSavedPosition) {
      viewport.scrollLeft = compositionViewport.left
      viewport.scrollTop = compositionViewport.top
    }
    rememberCompositionViewport(viewport)
    return
  }
  const entry = [...viewport.querySelectorAll<HTMLButtonElement>('[data-component]')].find(
    (element) => element.dataset.component === composition.rootId,
  )
  if (entry) centerCompositionNode(viewport, entry)
  else rememberCompositionViewport(viewport)
}

function scaleComposition(action: 'in' | 'out' | 'fit' | 'actual'): void {
  const viewport = document.getElementById('composition-scroll')
  if (!viewport) return
  const fit = compositionFitScale(viewport)
  if (fit === undefined) return
  const center = compositionViewportCenter(viewport)
  compositionScaleMode = action === 'fit' ? 'fit' : 'manual'
  compositionScale =
    action === 'fit'
      ? fit
      : action === 'actual'
        ? 1
        : Math.max(
            Math.min(0.25, fit),
            Math.min(2, compositionScale * (action === 'in' ? 1.2 : 1 / 1.2)),
          )
  redraw()
  const next = document.getElementById('composition-scroll')
  if (!next?.clientWidth || !next.clientHeight) return
  if (action === 'fit') {
    next.scrollLeft = 0
    next.scrollTop = 0
    rememberCompositionViewport(next)
  } else if (center) centerCompositionPoint(next, center)
}

function Composition(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const composition = snapshot.composition
  const sourceId = snapshot.rootSourceId
  const rootId = composition?.state === 'available' ? composition.rootId : undefined
  return h(CompositionPage, {
    snapshot,
    selectedNodeId: compositionSelection.nodeId,
    detailOpen: currentLocal().detailOpen,
    referencesEnabled: client?.referencesEnabled ?? false,
    scale: compositionScale,
    requestFocus: compositionRequestFocus,
    onRequestFocus: (focus: PrivateCompositionRequestFocus) => {
      if (!rootId || !compositionMatches(sourceId, rootId)) return
      humanNavigation = true
      compositionRequestFocus = focus
      redraw()
    },
    onScale: (action: 'in' | 'out' | 'fit' | 'actual') => {
      if (rootId && compositionMatches(sourceId, rootId)) scaleComposition(action)
    },
    onSelect: (id: string) => {
      const current = client?.body?.composition
      if (
        !rootId ||
        !compositionMatches(sourceId, rootId) ||
        current?.state !== 'available' ||
        !current.nodes.some((node) => node.id === id)
      )
        return
      const fromDetails =
        document.activeElement instanceof HTMLElement &&
        !!document.activeElement.closest('.composition-detail')
      humanNavigation = true
      compositionSelection = { rootSourceId: sourceId, rootId, nodeId: id }
      compositionCenterNodeId = id
      currentLocal().detailOpen = true
      feedback = ''
      redraw()
      if (fromDetails && !matchMedia('(max-width: 1120px)').matches)
        document.getElementById('composition-detail-title')?.focus()
      else focusDetailReturn()
    },
    onClose: () => {
      currentLocal().detailOpen = false
      redraw()
      focusSelectedEntry()
    },
    onCall: (id: string) => {
      const body = client?.body,
        nodeId = compositionSelection.nodeId
      if (
        !client?.referencesEnabled ||
        !body ||
        !nodeId ||
        !rootId ||
        !compositionMatches(sourceId, rootId) ||
        !compositionObservations(body).matches.some(
          (match) => match.callId === id && match.targetNodeId === nodeId,
        )
      ) {
        feedback = 'The selected invocation is unavailable in the current observation.'
        redraw()
        return
      }
      callFilter = ''
      navigate('overview')
      selectCall(id, { rootSourceId: sourceId, rootId, nodeId })
    },
    onObservedCalls: () => {
      compositionOrigin = undefined
      navigate('overview')
    },
    onNodeKeyDown: (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
        return
      event.preventDefault()
      const nodes = [...document.querySelectorAll<HTMLButtonElement>('[data-component]')]
      const index = nodes.indexOf(event.currentTarget as HTMLButtonElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? nodes.length - 1
            : Math.max(
                0,
                Math.min(
                  nodes.length - 1,
                  index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1),
                ),
              )
      nodes[next]?.focus()
    },
    onScroll: (left: number, top: number) => {
      const viewport = document.getElementById('composition-scroll')
      if (
        viewport?.clientWidth &&
        viewport.clientHeight &&
        rootId &&
        compositionMatches(sourceId, rootId)
      )
        compositionViewport = { left, top }
    },
  })
}
function openPanel(next: typeof panel): void {
  const body = document.getElementById('view-panel')
  if (body && !panel) scrollPositions.set(destinationKey, body.scrollTop)
  humanNavigation = true
  panelOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  panel = next
  redraw()
  const panelBody = document.getElementById('view-panel')
  if (panelBody) panelBody.scrollTop = 0
  document.getElementById('panel-back')?.focus()
}
function closePanel(): void {
  panel = undefined
  redraw()
  const body = document.getElementById('view-panel')
  if (body) body.scrollTop = scrollPositions.get(destinationKey) ?? 0
  panelOrigin?.focus()
  panelOrigin = undefined
}
function activate(reference: Reference, record: PrivateBrowserRecord): void {
  if (!client?.referencesEnabled || !client.body) return
  const target = privateBrowserResolve(client.body, record.sourceId, reference)
  if (target.kind === 'unavailable') {
    feedback = target.label
    redraw()
    return
  }
  humanNavigation = true
  if (target.kind === 'artifact') {
    const origin = document.activeElement
    detailOrigin =
      origin instanceof HTMLElement
        ? { destination: destinationKey, key: record.key, element: origin }
        : undefined
    currentLocal().selected = record.key
    currentLocal().detailOpen = true
    currentLocal().reference = reference
    currentLocal().previewSearch = ''
    currentLocal().previewScroll = undefined
    redraw()
    focusDetailReturn()
    return
  }
  if (target.kind === 'record') {
    navigate(displayViewKey(target.viewId), false)
    const state = currentLocal()
    if (state.filters.delete(target.collectionId))
      feedback = 'The local filter was cleared to show the referenced record.'
    select(target.rowKey)
  } else {
    navigate('overview')
    selectCall(target.callId)
  }
}

function Progress({
  block,
}: {
  block: Extract<DetailBlock, { kind: 'progress' }>
}): ComponentChildren {
  return h(
    'div',
    { class: 'progress-block' },
    h('strong', {}, literal(block.label)),
    h(
      'span',
      { class: 'count' },
      `${block.completed}${block.total === undefined ? '' : ` / ${block.total}`} `,
      block.unit ? literal(block.unit) : null,
    ),
    block.total && block.total > 0
      ? h('progress', {
          value: block.completed,
          max: block.total,
          'aria-label': privateBrowserLiteral(block.label),
        })
      : null,
  )
}
function ReferenceButton({
  value,
  record,
}: {
  value: Reference
  record: PrivateBrowserRecord
}): ComponentChildren {
  const resolved = client?.body && privateBrowserResolve(client.body, record.sourceId, value)
  return button(
    h(
      'span',
      {},
      literal(
        value.kind === 'artifact' ? value.path : (resolved?.label ?? privateBrowserValue(value)),
      ),
      resolved?.kind === 'unavailable' ? h('small', {}, literal(resolved.label)) : null,
    ),
    () => activate(value, record),
    {
      class: 'reference',
      disabled: !client?.referencesEnabled || resolved?.kind === 'unavailable',
      title: !client?.referencesEnabled
        ? 'References are disabled while observation is stale.'
        : undefined,
    },
  )
}
function Field({
  label,
  value,
  record,
}: {
  label: string
  value: Value
  record: PrivateBrowserRecord
}): ComponentChildren {
  return h(
    'div',
    { class: 'field' },
    h('dt', {}, literal(label)),
    h(
      'dd',
      {},
      value !== null && typeof value === 'object'
        ? h(ReferenceButton, { value, record })
        : literal(privateBrowserValue(value)),
    ),
  )
}
const visibleMedia = new Map<
  HTMLElement,
  { artifactId: string; captureGeneration: string; signature: string }
>()
const mediaTargets = new Map<
  HTMLElement,
  { artifactId: string; captureGeneration: string; signature: string }
>()
const mediaObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const intent = mediaTargets.get(entry.target as HTMLElement)
      if (entry.isIntersecting && intent) visibleMedia.set(entry.target as HTMLElement, intent)
      else visibleMedia.delete(entry.target as HTMLElement)
    }
    client?.setMedia([...visibleMedia.values()])
  },
  { rootMargin: '120px' },
)

function CapturedMedia({
  reference,
  record,
  alt,
}: {
  reference: MediaReference
  record: PrivateBrowserRecord
  alt: string
}): ComponentChildren {
  const element = useRef<HTMLElement>(null)
  const target = client?.body
    ? privateBrowserResolve(client.body, record.sourceId, reference)
    : undefined
  const intent =
    target?.kind === 'artifact'
      ? {
          artifactId: target.artifactId,
          captureGeneration: target.captureGeneration,
          signature: JSON.stringify([record.sourceId, reference]),
        }
      : undefined
  const signature = JSON.stringify(intent)
  useEffect(() => {
    const node = element.current
    if (!node || !intent) return
    mediaTargets.set(node, intent)
    mediaObserver.observe(node)
    return () => {
      mediaObserver.unobserve(node)
      mediaTargets.delete(node)
      visibleMedia.delete(node)
      client?.setMedia([...visibleMedia.values()])
    }
  }, [signature])
  const reply = intent ? client?.mediaPreview(intent) : undefined
  return h(
    'figure',
    { ref: element, class: 'captured-media' },
    h(CapturedContent, {
      reply,
      path: reference.path,
      alt,
      unavailable: !client?.referencesEnabled
        ? 'Capture unavailable while observation is stale.'
        : target?.kind !== 'artifact'
          ? (target?.label ?? 'Captured content unavailable.')
          : reply
            ? 'Preview unavailable. Open the captured source for details.'
            : 'Captured preview not loaded. Open the captured source for details.',
    }),
    h(
      'figcaption',
      {},
      h(
        'details',
        {},
        h('summary', {}, 'Captured source'),
        h(ReferenceButton, { value: reference, record }),
      ),
    ),
  )
}

function Block({
  block,
  record,
}: {
  block: DetailBlock
  record: PrivateBrowserRecord
}): ComponentChildren {
  if (block.kind === 'report')
    return h(
      'div',
      { class: block.references?.length ? 'report-with-references' : undefined },
      h(FormattedReport, { block }),
      block.references?.length
        ? h(
            'div',
            { class: 'report-actions' },
            block.references.map((value, index) =>
              h(ReferenceButton, { key: index, value, record }),
            ),
          )
        : null,
    )
  if (block.kind === 'content')
    return h(
      'section',
      { class: 'captured-block' },
      block.title ? h('h4', {}, literal(block.title)) : null,
      h(CapturedMedia, {
        reference: block.reference,
        record,
        alt: block.title ?? block.reference.path,
      }),
    )
  if (block.kind === 'progress') return h(Progress, { block })
  return h(
    'dl',
    { class: 'fields' },
    block.items.map((item, index) => h(Field, { key: index, ...item, record })),
  )
}
function ApplicationList(): ComponentChildren {
  const selected = view()
  if (!selected) return null
  const state = currentLocal()
  return h(
    'div',
    {},
    h(ApplicationPage, {
      view: selected,
      scope: h(ApplicationScope, {}),
      identity: h(ViewIdentity, {}),
      renderDownload: (reference, record, label) =>
        h(DownloadReference, { reference, record, label }),
      local: state,
      records: records(),
      onSelect: select,
      onRecordKeyDown: recordKeyDown,
      onFilter: (collection, query) => {
        humanNavigation = true
        state.filters.set(collection, query)
        redraw()
      },
      onClearFilters: () => {
        humanNavigation = true
        state.filters.clear()
        redraw()
        focusSelectedEntry()
      },
      onSort: (collection, key, descending) => {
        humanNavigation = true
        if (key) state.sorts.set(collection, { key, descending })
        else state.sorts.delete(collection)
        redraw()
      },
      renderMedia: (reference, record, alt) => h(CapturedMedia, { reference, record, alt }),
      renderBlock: (block, record) => h(Block, { block, record }),
      renderValue: (value, record) =>
        value !== null && typeof value === 'object'
          ? h(ReferenceButton, { value, record })
          : literal(privateBrowserValue(value)),
    }),
  )
}

function recordKeyDown(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-record]')]
  const index = buttons.indexOf(event.currentTarget as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  event.preventDefault()
  buttons[next]?.focus()
}

function Preview({ path }: { path: string }): ComponentChildren {
  const state = currentLocal()
  const { previewSearch, previewWrap, plainDiff, csvRaw } = state
  const preview = client?.preview
  const reply = preview?.reply
  const text = privateBrowserLiteral(reply?.text ?? '')
  const format = detectDisplayTextFormat(path, text)
  const rows =
    !reply?.clipped && (format === 'csv' || format === 'tsv')
      ? displayDelimitedRows(text, format === 'tsv' ? '\t' : ',')
      : undefined
  const patchText = text.startsWith('diff --git ') || /^--- [^\n]+\n\+\+\+ [^\n]+\n@@ /.test(text)
  const diffLines = patchText ? (text.match(/[^\n]*\n|[^\n]+$/g) ?? []) : []
  const diff = !plainDiff && patchText && diffLines.length <= 2048
  let content: ComponentChildren = displayTextTokens(text, format).map((token, index) =>
    h(
      'span',
      {
        key: index,
        class:
          token.column === undefined ? `syntax-${token.role}` : `csv-column-${token.column % 6}`,
      },
      token.text,
    ),
  )
  if (patchText && plainDiff) content = text
  let matches = 0
  if (previewSearch && text) {
    const parts: ComponentChildren[] = []
    let start = 0,
      index = text.indexOf(previewSearch)
    while (index !== -1 && matches < 128) {
      parts.push(
        text.slice(start, index),
        h('mark', { key: index }, text.slice(index, index + previewSearch.length)),
      )
      start = index + previewSearch.length
      matches++
      index = text.indexOf(previewSearch, start)
    }
    parts.push(text.slice(start))
    content = parts
  } else if (diff)
    content = diffLines.map((line, index) =>
      h(
        'span',
        {
          key: index,
          class:
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-remove'
                : 'diff-context',
        },
        line,
      ),
    )
  return h(
    'section',
    { class: 'file-preview', 'aria-label': 'File content' },
    h('h2', {}, literal(path)),
    client?.preview?.intent
      ? button(
          'Download captured file',
          () => {
            const intent = client?.preview?.intent
            if (!intent) return
            void client?.download(intent).then((bytes) => {
              if (!bytes) {
                feedback = 'Captured download unavailable.'
                redraw()
                return
              }
              const url = URL.createObjectURL(
                new Blob([Uint8Array.from(bytes).buffer], { type: 'application/octet-stream' }),
              )
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = path.split('/').at(-1) ?? 'artifact'
              anchor.click()
              setTimeout(() => URL.revokeObjectURL(url), 0)
            })
          },
          { disabled: !client.referencesEnabled },
        )
      : null,
    !client?.referencesEnabled
      ? h(
          'p',
          { class: 'unavailable-note' },
          'File references are disabled while observation is stale.',
        )
      : !preview || preview.phase === 'loading'
        ? h('p', { role: 'status' }, 'Loading immutable preview…')
        : preview.phase === 'unavailable' || reply?.state === 'unavailable'
          ? h(
              'p',
              {},
              'Immutable text preview unavailable. Inspect the delivered evidence location reported in the terminal.',
            )
          : reply?.state === 'image' && reply.image
            ? h(
                'figure',
                { class: 'captured-image' },
                h('img', {
                  src: `data:${reply.image.mime};base64,${reply.image.base64}`,
                  alt: `Captured image: ${privateBrowserLiteral(path)}`,
                  width: reply.image.width,
                  height: reply.image.height,
                }),
                h(
                  'figcaption',
                  {},
                  `${reply.image.width} × ${reply.image.height} · ${reply.bytes} original bytes`,
                ),
              )
            : reply?.state === 'non-text'
              ? h('p', {}, 'This captured file has no UTF-8 text preview.')
              : reply?.state === 'empty'
                ? h('p', {}, 'This file is empty.')
                : h(
                    'div',
                    {},
                    h(
                      'div',
                      { class: 'preview-controls' },
                      button(previewWrap ? 'Preserve lines' : 'Wrap text', () => {
                        state.previewWrap = !previewWrap
                        redraw()
                      }),
                      rows
                        ? button(csvRaw ? 'Table view' : 'Raw text', () => {
                            state.csvRaw = !csvRaw
                            redraw()
                          })
                        : null,
                      h(
                        'span',
                        { class: 'secondary' },
                        format === 'plain' ? 'Plain text' : format.toUpperCase(),
                      ),
                      patchText
                        ? button(plainDiff ? 'Diff colors' : 'Plain text', () => {
                            state.plainDiff = !plainDiff
                            redraw()
                          })
                        : null,
                      h(
                        'label',
                        {},
                        'Search retained excerpt',
                        h('input', {
                          value: previewSearch,
                          maxLength: 1024,
                          placeholder: 'Literal text…',
                          onInput: (event: Event) => {
                            state.previewSearch = (event.target as HTMLInputElement).value
                            redraw()
                          },
                        }),
                      ),
                    ),
                    previewSearch
                      ? h(
                          'p',
                          { class: 'secondary' },
                          `${matches}${matches === 128 ? ' or more' : ''} matches in this retained excerpt`,
                        )
                      : null,
                    rows && !csvRaw && !previewSearch
                      ? h(
                          'div',
                          { class: 'csv-table', tabIndex: 0 },
                          h(
                            'table',
                            {},
                            h(
                              'thead',
                              {},
                              h(
                                'tr',
                                {},
                                rows[0]!.map((cell, i) =>
                                  h('th', { class: `csv-column-${i % 6}` }, cell),
                                ),
                              ),
                            ),
                            h(
                              'tbody',
                              {},
                              rows.slice(1).map((row) =>
                                h(
                                  'tr',
                                  {},
                                  row.map((cell, i) =>
                                    h('td', { class: `csv-column-${i % 6}` }, cell),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        )
                      : h(
                          'pre',
                          {
                            class: previewWrap ? 'wrap' : '',
                            tabIndex: 0,
                            'aria-label': 'Retained file excerpt',
                            onScroll: (event: Event) => {
                              const element = event.currentTarget as HTMLElement
                              state.previewScroll = {
                                signature: state.signature ?? '',
                                left: element.scrollLeft,
                                top: element.scrollTop,
                              }
                            },
                            ref: (element: HTMLElement | null) => {
                              const anchor = state.previewScroll
                              if (element && anchor && anchor.signature === state.signature) {
                                element.scrollTop = anchor.top
                                element.scrollLeft = anchor.left
                              }
                            },
                          },
                          h('code', {}, content),
                        ),
                  ),
    reply
      ? h(
          'p',
          { class: 'secondary' },
          `${reply.bytes} bytes · ${reply.provenance === 'recorded-capture' ? 'Recorded immutable capture' : 'Verified delivery'}${reply.clipped ? ' · excerpt clipped at 64 KiB' : ''}${reply.state === 'image' ? '.' : '. Search covers the retained excerpt only.'}`,
        )
      : null,
  )
}

function SelectedDetail(): ComponentChildren {
  const record = selectedRecord()
  const state = currentLocal()
  if (!record)
    return h(
      'aside',
      { class: 'detail empty' },
      h('h2', {}, 'Select an entry'),
      h('p', {}, 'Read supplied context or referenced evidence here.'),
    )
  const reference = state.reference ?? privateBrowserPeek(record)
  const target =
    reference && client?.body
      ? privateBrowserResolve(client.body, record.sourceId, reference)
      : undefined
  return h(
    'aside',
    { class: 'detail', 'aria-label': 'Selected detail' },
    button(
      '← Back to records',
      () => {
        state.detailOpen = false
        client?.setPreview(undefined)
        redraw()
        focusSelectedEntry()
      },
      { class: 'back-to-records' },
    ),
    isMaterialPage() && !records().some((item) => item.key === record.key)
      ? h(
          'div',
          { class: 'selection-notice selection-notice-detail', role: 'status' },
          h('span', {}, 'This record is outside the current filters. Its details remain open.'),
          button('Clear filters', () => {
            state.filters.clear()
            redraw()
            focusDetailReturn()
          }),
        )
      : null,
    h(
      'div',
      { class: 'detail-heading' },
      h('h2', {}, literal(record.title)),
      button(
        state.expanded ? 'Reduce detail' : 'Expand evidence',
        () => {
          humanNavigation = true
          state.expanded = !state.expanded
          redraw()
        },
        { 'aria-expanded': state.expanded },
      ),
    ),
    reference?.kind === 'artifact' || reference?.kind === 'input-artifact'
      ? target?.kind === 'artifact'
        ? h(Preview, { path: reference.path })
        : h(
            'section',
            {},
            h('h3', {}, literal(reference.path)),
            h('p', {}, target?.label ?? 'Artifact unavailable'),
          )
      : null,
    record.text ? h('p', { class: 'report' }, literal(record.text)) : null,
    record.block ? h(Block, { block: record.block, record }) : null,
    record.row
      ? h(
          'div',
          {},
          record.row.details?.length ? h('h3', {}, 'Supplied context') : null,
          record.row.details?.map((block, index) => h(Block, { key: index, block, record })),
          record.collection!.columns.length > 3
            ? h(
                'div',
                {},
                h('h3', {}, 'Additional fields'),
                h(
                  'dl',
                  { class: 'fields' },
                  record.collection!.columns.slice(3).map((column) =>
                    h(Field, {
                      key: column.key,
                      label: column.label,
                      value: record.row!.cells[column.key] ?? null,
                      record,
                    }),
                  ),
                ),
              )
            : null,
          state.expanded
            ? h(
                'div',
                {},
                h('h3', {}, 'Complete record fields'),
                h(
                  'dl',
                  { class: 'fields' },
                  record.collection!.columns.map((column) =>
                    h(Field, {
                      key: column.key,
                      label: column.label,
                      value: record.row!.cells[column.key] ?? null,
                      record,
                    }),
                  ),
                ),
              )
            : null,
          !record.row.details?.length && record.collection!.columns.length <= 3 && !reference
            ? h(
                'p',
                { class: 'secondary' },
                'No additional context was supplied. Expand to read all fields.',
              )
            : null,
        )
      : null,
    record.block?.kind === 'progress'
      ? h(
          'p',
          { class: 'secondary' },
          'These are publisher-reported counts. Reaching the total does not establish the application outcome.',
        )
      : null,
    privateBrowserReferences(record).length
      ? h(
          'div',
          { class: 'references' },
          h('h3', {}, 'References'),
          privateBrowserReferences(record).map((value, index) =>
            h(ReferenceButton, { key: index, value, record }),
          ),
        )
      : null,
  )
}

function Files(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const capture = snapshot.artifacts
  const state = currentLocal()
  const file = capture.files.find((item) => item.id === state.selected)
  return h(
    'div',
    {
      class: `workspace host-page ${state.detailOpen ? 'show-detail' : ''} ${state.expanded ? 'expanded' : ''}`,
    },
    h(
      'section',
      { class: 'records' },
      h('p', { class: 'host-page-intro' }, 'Inspect and download immutable delivered files.'),
      snapshot.mode === 'recorded-packet'
        ? h(
            'p',
            { class: 'secondary' },
            literal(
              snapshot.views.find((view) => view.hostRole === 'recorded-files')?.value.summary ??
                '',
            ),
          )
        : null,
      capture.phase === 'pending'
        ? h('p', {}, 'Files are pending verified delivery. No paths are guessed.')
        : capture.phase === 'unavailable'
          ? h('p', {}, 'File capture is unavailable.')
          : !capture.files.length
            ? h('p', {}, 'The verified inventory is empty.')
            : capture.files.map((item) =>
                button(
                  h(
                    'span',
                    {},
                    h('strong', {}, literal(item.path)),
                    h(
                      'small',
                      {},
                      item.state === 'image'
                        ? 'Image preview'
                        : item.state === 'non-text'
                          ? 'No text preview'
                          : item.state === 'unavailable'
                            ? 'Preview unavailable'
                            : item.state === 'empty'
                              ? 'Empty file'
                              : 'Text preview',
                    ),
                  ),
                  () => select(item.id),
                  {
                    key: item.id,
                    class: `record file-record ${state.selected === item.id ? 'selected' : ''}`,
                    'aria-pressed': state.selected === item.id,
                    'data-record': item.id,
                    onKeyDown: recordKeyDown,
                  },
                ),
              ),
    ),
    state.detailOpen && file
      ? h(
          'aside',
          { class: 'detail', 'aria-label': 'Selected file' },
          button(
            '← Back to files',
            () => {
              state.detailOpen = false
              redraw()
              focusSelectedEntry()
            },
            { class: 'back-to-records' },
          ),
          h(
            'div',
            {},
            h(
              'div',
              { class: 'detail-heading' },
              h('h2', {}, 'File evidence'),
              button(
                state.expanded ? 'Reduce detail' : 'Expand evidence',
                () => {
                  state.expanded = !state.expanded
                  redraw()
                },
                { 'aria-expanded': state.expanded },
              ),
            ),
            h(Preview, { path: file.path }),
          ),
        )
      : null,
  )
}

function Activity(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const live = client?.current?.workspace.phase === 'live'
  const host = snapshot.journal.filter((item) => item.kind === 'host')
  return h(
    'section',
    { class: 'host-page activity-page' },
    live
      ? h('p', { class: 'host-page-intro' }, literal(client?.current?.workspace.hostStage ?? ''))
      : h(
          'p',
          { class: 'host-page-intro' },
          'Nothing is running. These are retained observations.',
        ),
    live && snapshot.activities.length
      ? h(
          'div',
          { class: 'activity-list' },
          snapshot.activities.map((item) =>
            h(
              'article',
              { key: item.id },
              h('h3', {}, literal(item.value.label)),
              h('p', { class: 'source' }, literal(item.sourceLabel)),
              item.value.progress
                ? h(Progress, {
                    block: { kind: 'progress', label: item.value.label, ...item.value.progress },
                  })
                : null,
              item.value.detail
                ? h(
                    'details',
                    {},
                    h('summary', {}, 'Activity context'),
                    h('p', { class: 'report' }, literal(item.value.detail)),
                  )
                : null,
              item.value.operationId
                ? button(
                    'Inspect observed call',
                    () => {
                      const call = snapshot.calls.find(
                        (candidate) =>
                          candidate.sourceId === item.sourceId &&
                          candidate.operationId === item.value.operationId,
                      )
                      if (call) {
                        navigate('overview')
                        selectCall(call.id)
                      } else {
                        feedback = 'Associated observed call unavailable.'
                        redraw()
                      }
                    },
                    { disabled: !client?.referencesEnabled },
                  )
                : null,
            ),
          ),
        )
      : live
        ? h('p', { class: 'secondary' }, 'No current application activities were reported.')
        : null,
    h(
      'section',
      { class: 'journal-list', 'aria-label': 'Recent reports' },
      h('h2', {}, 'Recent reports'),
      !snapshot.journal.some((item) => item.kind !== 'host')
        ? h('p', { class: 'empty-state' }, 'No application or diagnostic reports are retained.')
        : snapshot.journal
            .filter((item) => item.kind !== 'host')
            .slice()
            .reverse()
            .map((item) =>
              h(
                'article',
                { key: item.id, class: 'journal-entry' },
                h(
                  'header',
                  {},
                  h(
                    'span',
                    { class: 'importance' },
                    item.importance === 'unknown'
                      ? 'Unknown severity'
                      : `${item.kind === 'flow' ? 'Flow-reported ' : ''}${item.importance}`,
                  ),
                  h('span', { class: 'source' }, literal(item.attribution.sourceLabel)),
                ),
                h('p', { class: 'report' }, literal(teaser(item.text, 280))),
                item.text.length > 280
                  ? h(
                      'details',
                      {},
                      h('summary', {}, 'Read complete retained report'),
                      h('p', { class: 'report' }, literal(item.text)),
                    )
                  : null,
                h(
                  'details',
                  { class: 'journal-provenance' },
                  h('summary', {}, 'Report attribution'),
                  h('p', { class: 'source' }, provenance(item.attribution)),
                ),
                item.clipped
                  ? h('p', { class: 'unavailable-note' }, 'This retained report is clipped.')
                  : null,
              ),
            ),
    ),
    host.length
      ? h(
          'details',
          {},
          h('summary', {}, `Stage history · ${host.length} retained entries`),
          host.map((item) => h('p', { key: item.id, class: 'report' }, literal(item.text))),
        )
      : null,
    Object.values(snapshot.omissions.journal).some(Boolean)
      ? h(
          'p',
          { class: 'unavailable-note' },
          `History is incomplete. Omitted: ${snapshot.omissions.journal.flow} Flow reports, ${snapshot.omissions.journal.host} host entries, ${snapshot.omissions.journal.diagnostic} diagnostics.`,
        )
      : null,
  )
}

function Overview(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const selected = snapshot.calls.find((call) => call.id === selectedCall)
  const childViews = selected && privateBrowserInvocationViews(snapshot, selected.id)
  const returnToComposition =
    selected &&
    compositionOrigin &&
    compositionMatches(compositionOrigin.rootSourceId, compositionOrigin.rootId) &&
    compositionObservations(snapshot).matches.some(
      (match) => match.callId === selected.id && match.targetNodeId === compositionOrigin!.nodeId,
    )
  const timeline = privateBrowserCallSpans(snapshot.calls)
  const matches = new Set(
    snapshot.calls
      .filter((call) =>
        privateBrowserLiteral(`${call.intent ?? ''} ${call.slot} ${call.state}`)
          .toLowerCase()
          .includes(callFilter.toLowerCase()),
      )
      .map((call) => call.id),
  )
  const included = new Set(matches)
  for (const id of matches) {
    let call = snapshot.calls.find((item) => item.id === id)
    for (let depth = 0; call?.parentId && depth < 32; depth++) {
      included.add(call.parentId)
      call = snapshot.calls.find((item) => item.id === call!.parentId)
    }
  }
  const children = new Map<string | undefined, DisplaySnapshot['calls'][number][]>()
  for (const call of snapshot.calls) {
    if (!included.has(call.id)) continue
    const parent = snapshot.calls.some((item) => item.id === call.parentId)
      ? call.parentId
      : undefined
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(call)
  }
  const problematic = (call: DisplaySnapshot['calls'][number], depth = 0): boolean =>
    depth < 32 &&
    (call.state !== 'returned' ||
      (children.get(call.id) ?? []).some((item) => problematic(item, depth + 1)))
  const nodes = (parent?: string, depth = 0): ComponentChildren =>
    depth >= 32
      ? h('p', {}, 'Additional call ancestry unavailable.')
      : h(
          'ul',
          { class: 'call-tree' },
          (children.get(parent) ?? []).map((call) => {
            const descendants = children.get(call.id) ?? []
            const open = !!callFilter || (treeChoices.get(call.id) ?? problematic(call))
            return h(
              'li',
              { key: call.id },
              h(
                'div',
                {
                  class: `call-row depth-${depth} call-${call.state} ${selectedCall === call.id ? 'selected' : ''}`,
                },
                h(
                  'div',
                  { class: 'call-identity' },
                  descendants.length
                    ? button(
                        open ? '▾' : '▸',
                        () => {
                          humanNavigation = true
                          treeChoices.set(call.id, !open)
                          redraw()
                        },
                        {
                          'aria-label': `${open ? 'Collapse' : 'Expand'} call branch`,
                          'aria-expanded': open,
                          class: 'tree-toggle',
                        },
                      )
                    : h('span', { class: 'tree-spacer' }),
                  button(
                    h(
                      'span',
                      {},
                      h('span', { class: 'call-name' }, literal(call.intent ?? call.slot)),
                      h(
                        'small',
                        { class: 'call-state' },
                        call.state === 'cancel-requested' ? 'Cancellation requested' : call.state,
                      ),
                    ),
                    () => {
                      humanNavigation = true
                      selectCall(call.id)
                    },
                    {
                      'aria-pressed': selectedCall === call.id,
                      'data-call': call.id,
                      onKeyDown: (event: KeyboardEvent) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                        event.preventDefault()
                        const buttons = [
                          ...document.querySelectorAll<HTMLButtonElement>('[data-call]'),
                        ]
                        const index = buttons.indexOf(event.currentTarget as HTMLButtonElement)
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? buttons.length - 1
                              : Math.max(
                                  0,
                                  Math.min(
                                    buttons.length - 1,
                                    index + (event.key === 'ArrowDown' ? 1 : -1),
                                  ),
                                )
                        buttons[next]?.focus()
                      },
                    },
                  ),
                ),
                h(
                  'div',
                  { class: 'call-span' },
                  timeline.spans.has(call.id)
                    ? h(
                        'svg',
                        {
                          viewBox: '0 0 1000 24',
                          preserveAspectRatio: 'none',
                          'aria-hidden': true,
                        },
                        h('rect', {
                          x: timeline.spans.get(call.id)!.x,
                          y: 8,
                          width: Math.max(2, timeline.spans.get(call.id)!.width),
                          height: 8,
                          rx: 3,
                        }),
                      )
                    : null,
                  h(
                    'small',
                    {},
                    timeline.spans.has(call.id)
                      ? privateBrowserDuration(timeline.spans.get(call.id)!.milliseconds)
                      : 'Timing unavailable',
                  ),
                ),
              ),
              !open && descendants.length
                ? h(
                    'small',
                    { class: 'secondary' },
                    `${descendants.length} direct children hidden${descendants.some((item) => problematic(item)) ? ' · active/problematic work within branch' : ''}`,
                  )
                : null,
              open && descendants.length ? nodes(call.id, depth + 1) : null,
            )
          }),
        )
  return h(
    'div',
    {
      class: `workspace host-page execution-workspace ${selected && currentLocal().detailOpen ? 'show-detail' : ''}`,
    },
    h(
      'section',
      { class: 'records' },
      h(
        'div',
        { class: 'host-toolbar' },
        returnToComposition
          ? button(
              '← Application map',
              () => {
                compositionSelection = { ...compositionOrigin! }
                navigate('composition')
                focusSelectedEntry()
                focusDetailReturn()
              },
              { class: 'composition-return' },
            )
          : null,
        h(
          'p',
          { class: 'call-summary' },
          `${snapshot.calls.length} observed ${snapshot.calls.length === 1 ? 'call' : 'calls'}`,
        ),
        snapshot.calls.length > 1 || callFilter
          ? h('input', {
              'aria-label': 'Find observed calls',
              placeholder: 'Find a call…',
              value: callFilter,
              onInput: (event: Event) => {
                callFilter = (event.target as HTMLInputElement).value
                humanNavigation = true
                redraw()
              },
            })
          : null,
        snapshot.calls.some((call) => call.parentId)
          ? h(
              'details',
              { class: 'graph-controls' },
              h('summary', {}, 'Branches'),
              button('Expand all', () => {
                for (const call of snapshot.calls) treeChoices.set(call.id, true)
                redraw()
              }),
              button('Collapse all', () => {
                for (const call of snapshot.calls) treeChoices.set(call.id, false)
                redraw()
              }),
            )
          : null,
      ),
      h(
        'details',
        { class: 'host-caption' },
        h('summary', {}, 'About observation timing'),
        h(
          'p',
          {},
          'Bars span the first to latest host observation. They show observed call relationships, not measured execution time.',
        ),
      ),
      h(
        'div',
        { class: 'timeline-heading', 'aria-hidden': true },
        h('span', {}, 'Call / observed state'),
        h('span', {}, '0ms', h('span', {}, privateBrowserDuration(timeline.milliseconds))),
      ),
      snapshot.calls.some(
        (call) => call.parentId && !snapshot.calls.some((parent) => parent.id === call.parentId),
      )
        ? h(
            'p',
            { class: 'unavailable-note' },
            'Some observed parents are unavailable. Those calls appear at the outer level; their ancestry is incomplete.',
          )
        : null,
      included.size
        ? nodes()
        : h(
            'p',
            { class: 'empty-state' },
            callFilter ? 'No calls match this filter.' : 'No child calls have been observed.',
          ),
      snapshot.omissions.calls
        ? h(
            'p',
            { class: 'unavailable-note' },
            `${snapshot.omissions.calls} call observations omitted; tree is incomplete.`,
          )
        : null,
    ),
    currentLocal().detailOpen && selected
      ? h(
          'aside',
          { class: 'detail call-detail', 'aria-label': 'Selected call' },
          button(
            '← Back to calls',
            () => {
              currentLocal().detailOpen = false
              redraw()
              focusSelectedEntry()
            },
            { class: 'back-to-records' },
          ),
          h(
            'div',
            {},
            h(
              'h2',
              { id: 'selected-call-heading', tabIndex: -1 },
              literal(selected.intent ?? selected.slot),
            ),
            h('p', { class: `call-${selected.state}` }, `Observed state: ${selected.state}`),
            h(
              'dl',
              { class: 'fields' },
              h(
                'div',
                { class: 'field' },
                h('dt', {}, 'First observed'),
                h('dd', {}, observationTime(selected.firstObservedAt)),
              ),
              h(
                'div',
                { class: 'field' },
                h('dt', {}, 'Latest observation'),
                h('dd', {}, observationTime(selected.observedAt)),
              ),
            ),
            selected.cause
              ? h('p', { class: 'report' }, literal(selected.cause))
              : h('p', { class: 'secondary' }, 'No additional safe cause was observed.'),
            selected.state === 'returned'
              ? h(
                  'p',
                  { class: 'secondary' },
                  'Returned describes execution observation, not application success.',
                )
              : null,
            h(
              'section',
              { class: 'call-views', 'aria-label': 'Reported views' },
              h('h3', {}, 'Reported views'),
              childViews?.kind === 'available'
                ? childViews.views.length
                  ? h(
                      'ul',
                      { class: 'call-view-links' },
                      childViews.views.map((item) =>
                        h(
                          'li',
                          { key: item.id },
                          button(
                            h(
                              'span',
                              {},
                              h('strong', {}, literal(item.value.title)),
                              h(
                                'small',
                                { class: 'secondary' },
                                'Reported by ',
                                literal(item.sourceLabel),
                              ),
                            ),
                            () =>
                              openInvocationView(
                                snapshot.rootSourceId,
                                selected.id,
                                childViews.childSourceId,
                                item.id,
                              ),
                            {
                              class: 'call-view-link',
                              'data-call-view': item.id,
                              disabled: !client?.referencesEnabled,
                            },
                          ),
                          item.ended ? h('p', { class: 'secondary' }, literal(item.ended)) : null,
                        ),
                      ),
                    )
                  : h('p', { class: 'secondary' }, 'No authored views are retained for this child.')
                : h('p', { class: 'secondary' }, childViews?.label),
              childViews?.kind === 'available' &&
                childViews.views.length &&
                !client?.referencesEnabled
                ? h(
                    'p',
                    { class: 'unavailable-note' },
                    'View links are unavailable while this observation is stale or incomplete.',
                  )
                : null,
            ),
            h('h3', {}, 'Related reports'),
            snapshot.journal.some(
              (item) =>
                item.attribution.provenance !== 'recorded-claim' &&
                item.attribution.callId === selected.id,
            )
              ? snapshot.journal
                  .filter(
                    (item) =>
                      item.attribution.provenance !== 'recorded-claim' &&
                      item.attribution.callId === selected.id,
                  )
                  .map((item) =>
                    h(
                      'details',
                      { key: item.id, class: 'related-report' },
                      h('summary', {}, literal(teaser(item.text, 100))),
                      h(
                        'p',
                        { class: 'source' },
                        literal(item.attribution.sourceLabel),
                        ' · ',
                        provenance(item.attribution),
                      ),
                      h('p', { class: 'report' }, literal(item.text)),
                      item.clipped
                        ? h('p', { class: 'secondary' }, 'Retained report clipped.')
                        : null,
                    ),
                  )
              : h(
                  'p',
                  { class: 'secondary' },
                  'No retained reports are associated with this call.',
                ),
            h(
              'details',
              {},
              h('summary', {}, 'Invocation identity'),
              h('p', {}, 'Reviewed slot: ', literal(selected.slot)),
              h('p', {}, 'Original operation: ', literal(selected.operationId)),
            ),
          ),
        )
      : null,
  )
}

function Panel({ current }: { current: DisplaySnapshotEnvelope }): ComponentChildren {
  const diagnostics =
    current.kind === 'incomplete'
      ? current.diagnostics
      : current.journal.filter((item) => item.kind === 'diagnostic')
  return h(
    'section',
    {
      class: 'host-page inspection-panel',
      'aria-label':
        panel === 'attention'
          ? 'Complete attention causes'
          : panel === 'diagnostics'
            ? 'Diagnostics'
            : 'Inspection help',
    },
    button('← Back to view', closePanel, { id: 'panel-back' }),
    panel === 'attention'
      ? h(
          'div',
          {},
          h('h2', {}, 'Retained attention causes'),
          current.attention.length
            ? current.attention.map((item) =>
                h(
                  'article',
                  { key: item.id, class: 'cause' },
                  h('h3', {}, literal(item.attribution.sourceLabel)),
                  h('p', { class: 'source' }, provenance(item.attribution)),
                  h('p', { class: 'report' }, literal(item.text)),
                ),
              )
            : h('p', {}, 'No attention causes are retained.'),
        )
      : panel === 'diagnostics'
        ? h(
            'div',
            { class: 'diagnostic-list' },
            h(
              'p',
              { class: 'host-page-intro' },
              'Retained causes and observations, with their original attribution.',
            ),
            diagnostics.length
              ? diagnostics.map((item) =>
                  h(
                    'details',
                    { key: item.id, class: 'diagnostic' },
                    h(
                      'summary',
                      { class: 'diagnostic-summary' },
                      h(
                        'span',
                        { class: 'importance' },
                        item.importance === 'unknown' ? 'Unknown severity' : item.importance,
                      ),
                      h('span', {}, literal(teaser(item.text, 160))),
                    ),
                    h('p', { class: 'report' }, literal(item.text)),
                    h(
                      'dl',
                      { class: 'view-identity' },
                      h(
                        'div',
                        {},
                        h('dt', {}, 'Publisher'),
                        h('dd', {}, literal(item.attribution.sourceLabel)),
                      ),
                      h(
                        'div',
                        {},
                        h('dt', {}, 'Attribution'),
                        h('dd', {}, provenance(item.attribution)),
                      ),
                      item.operationsPath?.length
                        ? h(
                            'div',
                            {},
                            h('dt', {}, 'Operation path'),
                            h(
                              'dd',
                              {},
                              literal(item.operationsPath.join(' → ')),
                              item.pathClipped ? ' · path clipped' : '',
                            ),
                          )
                        : null,
                    ),
                    item.clipped
                      ? h('p', { class: 'unavailable-note' }, 'Diagnostic excerpt clipped.')
                      : null,
                  ),
                )
              : h('p', {}, 'No diagnostic reports are retained.'),
          )
        : h(
            'div',
            {},
            h('h2', {}, 'Inspection help'),
            h(
              'p',
              {},
              'Use the view tabs and select an entry to read context. A single artifact reference opens a read-only preview; multiple references require a choice. Delivered files are available independently of application views.',
            ),
            h(
              'p',
              {},
              'Arrow keys move focus within tabs or record lists; Enter activates the focused control. Escape dismisses detail or this panel. Browser and text-editing shortcuts remain available.',
            ),
            h(
              'p',
              {},
              'Reloading removes the memory-only access capability. Open the original terminal link in a new browser tab; this does not restart work.',
            ),
            h(
              'p',
              {},
              'Close inspection for this command closes all viewers. Live work continues in the terminal. Closing only your browser tab disconnects this viewer.',
            ),
          ),
  )
}

function applicationName(): string {
  const body = client?.body
  return (
    view()?.value.application ??
    body?.views.find((item) => item.sourceId === body.rootSourceId)?.value.application ??
    client?.current?.workspace.target ??
    'Application'
  )
}
function Icon({
  kind,
}: {
  kind:
    | 'image'
    | 'document'
    | 'table'
    | 'run'
    | 'map'
    | 'activity'
    | 'files'
    | 'folder'
    | 'settings'
    | 'close'
    | 'help'
    | 'diagnostics'
}): ComponentChildren {
  const paths = {
    image: 'M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M7 7h.01',
    document: 'M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6',
    table: 'M3 3h18v18H3z M3 9h18 M9 3v18',
    run: 'M2 12h4l3-8 5 16 3-8h5',
    map: 'M9 3h6v5H9z M2 16h6v5H2z M16 16h6v5h-6z M12 8v4 M5 16v-4h14v4',
    activity: 'M4 6h16 M4 12h16 M4 18h16',
    files: 'M4 3h12v15H4z M8 18v3h12V7h-4',
    folder: 'M3 6h7l2 3h9v12H3z',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    close: 'M6 6l12 12 M18 6L6 18',
    help: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
    diagnostics: 'M12 3L22 21H2Z M12 9v4 M12 17h.01',
  }
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': true,
    },
    h('path', { d: paths[kind] }),
  )
}
function ApplicationScope(): ComponentChildren {
  const selected = view()
  const target = selected?.value.target
  if (!selected || !target) return null
  const choices =
    client?.body?.views.filter(
      (item) =>
        item.sourceId === selected.sourceId &&
        item.value.target?.definitionId === target.definitionId,
    ) ?? []
  if (choices.length < 2)
    return target.label
      ? h(
          'span',
          { class: 'application-scope' },
          target.scopeLabel ? h('span', {}, literal(target.scopeLabel)) : null,
          h('strong', {}, literal(target.label)),
        )
      : null
  return h(
    'label',
    { class: 'application-scope' },
    h('span', {}, literal(target.scopeLabel ?? 'View')),
    h(
      'select',
      {
        value: selected.id,
        'aria-label': target.scopeLabel ?? 'View instance',
        onChange: (event: Event) =>
          navigate(displayViewKey((event.target as HTMLSelectElement).value)),
      },
      choices.map((item, index) =>
        h(
          'option',
          { key: item.id, value: item.id },
          literal(item.value.target?.label ?? `View ${index + 1}`),
        ),
      ),
    ),
  )
}
function ViewIdentity(): ComponentChildren {
  const selected = view()
  if (!selected) return null
  const target = selected.value.target
  return h(
    'dl',
    { class: 'view-identity' },
    h('div', {}, h('dt', {}, 'Publisher'), h('dd', {}, literal(selected.sourceLabel))),
    target
      ? h('div', {}, h('dt', {}, 'Definition'), h('dd', {}, literal(target.definitionId)))
      : null,
    target
      ? h('div', {}, h('dt', {}, 'Instance identity'), h('dd', {}, literal(target.instanceKey)))
      : null,
  )
}
function DownloadReference({
  reference,
  record,
  label,
}: {
  reference: MediaReference
  record: PrivateBrowserRecord
  label: string
}): ComponentChildren {
  const target = client?.body
    ? privateBrowserResolve(client.body, record.sourceId, reference)
    : undefined
  const inventory =
    reference.kind === 'input-artifact' ? client?.body?.inputs : client?.body?.artifacts
  const file =
    target?.kind === 'artifact'
      ? inventory?.files.find((item) => item.id === target.artifactId)
      : undefined
  if (target?.kind !== 'artifact' || file?.downloadable !== true || !client?.referencesEnabled)
    return h(
      'span',
      { class: 'secondary' },
      target?.kind === 'unavailable'
        ? literal(target.label)
        : 'Captured download currently unavailable',
    )
  return button(
    literal(label),
    () => {
      void client
        ?.download({
          artifactId: target.artifactId,
          captureGeneration: target.captureGeneration,
          signature: JSON.stringify([record.sourceId, reference]),
        })
        .then((bytes) => {
          if (!bytes) {
            feedback = 'Captured download unavailable.'
            redraw()
            return
          }
          const url = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes).buffer], { type: 'application/octet-stream' }),
          )
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = reference.path.split('/').at(-1) ?? 'artifact'
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 0)
        })
    },
    { class: 'document-download-button' },
  )
}

function Tabs(): ComponentChildren {
  const allTabs = privateBrowserTabs(client?.body, client?.current?.mode)
  const seen = new Set<string>()
  const selected = view()
  const tabs = allTabs.filter((tab) => {
    const candidate = privateBrowserView(client?.body, tab.id)
    if (!tab.application || !candidate?.value.target) return true
    const group = JSON.stringify([candidate.sourceId, candidate.value.target.definitionId])
    if (seen.has(group)) return false
    const peers = allTabs.filter((item) => {
      const itemView = privateBrowserView(client?.body, item.id)
      return (
        itemView?.sourceId === candidate.sourceId &&
        itemView?.value.target?.definitionId === candidate.value.target?.definitionId
      )
    })
    const preferred =
      peers.find((item) => item.id === destinationKey) ??
      peers.find(
        (item) =>
          privateBrowserView(client?.body, item.id)?.value.target?.subjectKey ===
          selected?.value.target?.subjectKey,
      ) ??
      peers[0]
    if (preferred?.id !== tab.id) return false
    seen.add(group)
    return true
  })
  const focusId = tabs.some((item) => item.id === destinationKey) ? destinationKey : tabs[0]?.id
  return h(
    'aside',
    { class: 'navigation' },
    h(
      'div',
      { class: 'workbench-brand' },
      h('span', { class: 'jig-mark', 'aria-hidden': true }, 'j'),
      h('strong', {}, 'jig'),
      h('span', {}, 'local workbench'),
    ),
    h(
      'div',
      { class: 'application-identity' },
      h(Icon, { kind: 'folder' }),
      h('strong', {}, literal(applicationName())),
    ),
    tabs.length
      ? h(
          'label',
          { class: 'mobile-view-picker' },
          h('span', {}, 'View'),
          h(
            'select',
            {
              'aria-label': 'Choose view',
              value: focusId,
              onChange: (event: Event) => navigate((event.target as HTMLSelectElement).value),
            },
            tabs.map((tab) =>
              h(
                'option',
                { key: tab.id, value: tab.id },
                privateBrowserLiteral(`${tab.title}${tab.source ? ` · ${tab.source}` : ''}`),
              ),
            ),
          ),
        )
      : null,
    tabs.length
      ? h(
          'nav',
          {
            role: 'tablist',
            'aria-orientation': navigationMedia.matches ? 'horizontal' : 'vertical',
            'aria-label':
              client?.current?.mode === 'retained-views' ? 'Application views' : 'Run views',
          },
          tabs.map((tab, index) =>
            h(
              'div',
              { key: tab.id },
              index === 0 || Boolean(tab.application) !== Boolean(tabs[index - 1]?.application)
                ? h(
                    'p',
                    { class: 'nav-group', role: 'presentation' },
                    tab.application
                      ? null
                      : client?.current?.mode === 'recorded-packet'
                        ? 'Recorded packet'
                        : 'Execution',
                  )
                : null,
              button(
                h(
                  'span',
                  { class: 'nav-entry' },
                  h(
                    'span',
                    { class: 'nav-icon' },
                    h(Icon, {
                      kind: privateBrowserView(client?.body, tab.id)
                        ? privateBrowserView(client?.body, tab.id)?.value.presentation
                          ? 'document'
                          : privateBrowserView(client?.body, tab.id)?.value.sections.some(
                                (section) =>
                                  section.blocks.some(
                                    (block) =>
                                      block.kind === 'collection' &&
                                      block.presentation?.kind === 'gallery',
                                  ),
                              )
                            ? 'image'
                            : 'table'
                        : tab.id === 'composition'
                          ? 'map'
                          : tab.id === 'overview'
                            ? 'run'
                            : tab.id === 'activity'
                              ? 'activity'
                              : 'files',
                    }),
                  ),
                  h(
                    'span',
                    {},
                    literal(tab.title),
                    !tab.application && tab.source ? h('small', {}, literal(tab.source)) : null,
                  ),
                ),
                () => navigate(tab.id),
                {
                  id: `tab-${encodeURIComponent(tab.id)}`,
                  role: 'tab',
                  'aria-selected': tab.id === destinationKey && !panel,
                  'aria-controls': 'view-panel',
                  tabIndex: tab.id === focusId ? 0 : -1,
                  title: privateBrowserLiteral(
                    `${tab.title}${tab.source ? ` · ${tab.source}` : ''}`,
                  ),
                  onKeyDown: (event: KeyboardEvent) => {
                    if (
                      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                        event.key,
                      )
                    )
                      return
                    event.preventDefault()
                    const index = tabs.findIndex((item) => item.id === tab.id)
                    const next =
                      event.key === 'Home'
                        ? tabs[0]!
                        : event.key === 'End'
                          ? tabs[tabs.length - 1]!
                          : tabs[
                              (index +
                                (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
                                tabs.length) %
                                tabs.length
                            ]!
                    navigate(next.id)
                    document.getElementById(`tab-${encodeURIComponent(next.id)}`)?.focus()
                  },
                },
              ),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'sidebar-tools' },
      client?.current?.mode === 'recorded-packet' &&
        client?.body?.views.some((view) => view.hostRole === 'recorded-diagnostics')
        ? null
        : button(
            [
              h('span', { class: 'sidebar-tool-icon' }, h(Icon, { kind: 'diagnostics' })),
              h('span', { class: 'sidebar-tool-label' }, 'Diagnostics'),
            ],
            () => openPanel('diagnostics'),
            {
              'aria-pressed': panel === 'diagnostics',
              'aria-label': 'Diagnostics',
              title: 'Diagnostics',
            },
          ),
      button(
        [
          h('span', { class: 'sidebar-tool-icon' }, h(Icon, { kind: 'help' })),
          h('span', { class: 'sidebar-tool-label' }, 'Help & shortcuts'),
        ],
        () => openPanel('help'),
        {
          'aria-pressed': panel === 'help',
          'aria-label': 'Help & shortcuts',
          title: 'Help & shortcuts',
        },
      ),
      h(
        'div',
        { class: 'appearance', role: 'group', 'aria-label': 'Appearance' },
        [
          { theme: 'system', label: 'System', path: 'M3 4h18v12H3z M8 21h8 M12 16v5' },
          {
            theme: 'light',
            label: 'Light',
            path: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
          },
          { theme: 'dark', label: 'Dark', path: 'M20 15.5A9 9 0 0 1 8.5 4a9 9 0 1 0 11.5 11.5Z' },
          {
            theme: 'color-free',
            label: 'Monochrome',
            path: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 3v18 M12 7h7 M12 11h9 M12 15h8 M12 19h5',
          },
        ].map(({ theme, label, path }) =>
          button(
            h(
              'svg',
              {
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': 1.6,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'aria-hidden': true,
              },
              h('path', { d: path }),
            ),
            () => {
              document.documentElement.dataset.theme = theme
              redraw()
            },
            {
              key: theme,
              class: 'appearance-option',
              title: label,
              'aria-label': `${label} appearance`,
              'aria-pressed': (document.documentElement.dataset.theme ?? 'system') === theme,
            },
          ),
        ),
      ),
    ),
  )
}

function App(): ComponentChildren {
  const current = client?.current
  if (!hasCapability || client?.connection === 'unauthorized')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Reopen your terminal link'),
      h(
        'p',
        {},
        'This page has no current access capability. Open the original terminal link in a new browser tab. This does not restart work.',
      ),
      h(
        'p',
        {},
        'Access stays in browser memory and is removed from the address. Reloading requires the original link again.',
      ),
    )
  if (client?.connection === 'closed')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Inspection ended'),
      h(
        'p',
        {},
        'This command’s browser inspection is closed. Closing inspection does not request execution cancellation. Consult the terminal for the run and final result.',
      ),
    )
  if (!current)
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Connecting to local inspection'),
      h(
        'p',
        { role: 'status' },
        client?.connection === 'disconnected'
          ? 'Observation unavailable; retrying with bounded backoff. Work is not restarted.'
          : 'Waiting for a readable host snapshot…',
      ),
    )
  const live = current.workspace.phase === 'live'
  const elapsed = elapsedClock.read(performance.now())
  const seconds = Math.floor(elapsed / 1000)
  const winner = current.attention.reduce<(typeof current.attention)[number] | undefined>(
    (previous, item) => (!previous || item.priority > previous.priority ? item : previous),
    undefined,
  )
  const state = currentLocal()
  const hasDestination = privateBrowserTabs(client?.body, current.mode).some(
    (tab) => tab.id === destinationKey,
  )
  return h(
    'div',
    { class: 'inspector' },
    h(
      'header',
      { class: 'shell' },
      h(
        'div',
        { class: 'workbench-breadcrumb' },
        h('span', {}, literal(applicationName())),
        h('span', { 'aria-hidden': true }, '›'),
        h(
          'h1',
          { id: 'current-view-title' },
          literal(
            panel === 'help'
              ? 'Help & shortcuts'
              : panel === 'diagnostics'
                ? 'Diagnostics'
                : panel === 'attention'
                  ? 'Needs attention'
                  : (privateBrowserTabs(client?.body).find((tab) => tab.id === destinationKey)
                      ?.title ?? 'Application views'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'workbench-tools' },
        h(
          'span',
          { class: 'workspace-observation' },
          live
            ? 'Execution running'
            : current.mode === 'retained-views'
              ? 'Retained views · currency unknown'
              : current.mode === 'recorded-packet'
                ? 'Recorded result'
                : 'Settled run',
        ),
        h(
          'details',
          { class: 'run-context-menu' },
          h(
            'summary',
            { title: 'Run details and execution facts' },
            h(Icon, { kind: 'settings' }),
            h('span', { class: 'visually-hidden' }, 'Run details'),
          ),
          h(
            'div',
            { class: 'run-context-content' },
            h('strong', {}, literal(current.workspace.target)),
            h('p', {}, literal(current.workspace.hostStage)),
            current.context ? h('p', {}, literal(current.context)) : null,
            current.mode === 'live-run'
              ? h(
                  'p',
                  {},
                  `Elapsed ${Math.floor(seconds / 60)}m ${seconds % 60}s${current.workspace.limitMs === undefined ? '' : ` · limit ${Math.floor(current.workspace.limitMs / 1000)}s`}`,
                )
              : null,
            current.workspace.facts
              ? h(
                  'dl',
                  { class: 'host-facts' },
                  Object.entries(current.workspace.facts).map(([name, fact]) =>
                    h(
                      'div',
                      { key: name },
                      h('dt', {}, name[0]!.toUpperCase() + name.slice(1)),
                      h(
                        'dd',
                        {},
                        literal(fact.value),
                        h(
                          'small',
                          {},
                          fact.provenance === 'host-observed'
                            ? 'Host observed'
                            : fact.provenance === 'recorded-claim'
                              ? 'Recorded claim'
                              : 'Application reported',
                        ),
                        fact.clipped ? ' · clipped' : '',
                      ),
                    ),
                  ),
                )
              : null,
            h(
              'p',
              { class: 'secondary' },
              'Close inspection closes all viewers for this command. It does not cancel execution.',
            ),
          ),
        ),
        button(
          closing ? 'Closing…' : 'Close inspection',
          () => {
            closing = true
            redraw()
            void client?.closeInspection().then((closed) => {
              closing = false
              if (!closed)
                feedback =
                  'Close acknowledgment unavailable; inspection may have ended. No execution cancellation was requested.'
              redraw()
            })
          },
          {
            disabled: closing,
            class: 'close-inspection',
            title: 'Closes inspection for this command and all viewers. Does not cancel execution.',
          },
        ),
      ),
    ),
    h(
      'section',
      { class: 'attention-shell', 'aria-label': 'Attention and inspection controls' },
      winner
        ? button(
            h(
              'span',
              {},
              h(
                'strong',
                {},
                attentionImportance(winner.priority).replace(/^./, (letter) =>
                  letter.toUpperCase(),
                ),
              ),
              ' · ',
              literal(winner.attribution.sourceLabel),
              h('span', { class: 'attention-teaser' }, literal(teaser(winner.text, 220))),
              h(
                'small',
                {},
                `Read full cause${current.attention.length > 1 ? ` · ${current.attention.length - 1} additional causes` : ''} →`,
              ),
            ),
            () => openPanel('attention'),
            { class: `attention ${winner.priority >= 4 ? 'host-failure' : ''}` },
          )
        : null,
    ),
    client?.connection !== 'current'
      ? h(
          'p',
          { class: 'connection-note', role: 'status' },
          'Observation disconnected; retained data may be stale. References are disabled. Work is not restarted.',
        )
      : null,
    client?.bodyStale
      ? h(
          'p',
          { class: 'connection-note' },
          'Current projection is incomplete: ',
          literal(current.kind === 'incomplete' ? current.reason : ''),
          '. The last complete body is stale and its references are disabled. Current causes, Diagnostics and Close remain available.',
        )
      : null,
    current.kind === 'snapshot' && current.incomplete
      ? h('p', { class: 'connection-note' }, literal(current.incomplete))
      : null,
    h(
      'div',
      { class: 'run-layout' },
      h(Tabs, {}),
      h(
        'div',
        { class: 'run-content' },
        feedback ? h('p', { class: 'feedback', role: 'status' }, feedback) : null,
        !panel ? h(InvocationReturn, {}) : null,
        h(
          'main',
          {
            id: 'view-panel',
            role:
              panel || !hasDestination
                ? undefined
                : navigationMedia.matches
                  ? 'region'
                  : 'tabpanel',
            'aria-labelledby':
              panel || !hasDestination
                ? undefined
                : navigationMedia.matches
                  ? 'current-view-title'
                  : `tab-${encodeURIComponent(destinationKey)}`,
            'aria-label': panel
              ? 'Inspection panel'
              : !hasDestination
                ? 'Application views'
                : destinationKey === 'files'
                  ? 'Delivered files'
                  : undefined,
            class: state.expanded ? 'expanded-body' : '',
          },
          panel
            ? h(Panel, { current })
            : !client?.body
              ? h(
                  'section',
                  { class: 'single' },
                  h('h2', {}, 'Body unavailable'),
                  h('p', {}, 'Use current attention and Diagnostics to inspect the known causes.'),
                )
              : !hasDestination
                ? h(
                    'section',
                    { class: 'single' },
                    h('h2', {}, 'No application views'),
                    h('p', {}, 'No retained application views match this selection.'),
                  )
                : destinationKey === 'activity'
                  ? h(Activity, {})
                  : destinationKey === 'composition'
                    ? h(Composition, {})
                    : destinationKey === 'overview'
                      ? h(Overview, {})
                      : destinationKey === 'files'
                        ? h(Files, {})
                        : h(
                            'div',
                            {
                              class: `application-workspace ${state.detailOpen ? 'show-detail' : ''} ${state.expanded ? 'expanded' : ''}`,
                            },
                            h(ApplicationList, {}),
                            state.detailOpen ? h(SelectedDetail, {}) : null,
                          ),
        ),
      ),
    ),
    h(
      'footer',
      {},
      h(
        'span',
        {},
        current.mode === 'recorded-packet'
          ? 'Recorded result'
          : current.mode === 'retained-views'
            ? 'Retained application projection'
            : live
              ? 'Live observation'
              : 'Settled inspection',
      ),
      h(
        'span',
        {
          class: `observation-status ${privateBrowserObservationStatus(client!).tone}`,
          role: 'status',
          title: client?.synchronizedAt
            ? `Latest synchronized snapshot: ${new Date(client.synchronizedAt).toISOString()}. References require a current complete snapshot.`
            : undefined,
        },
        privateBrowserObservationStatus(client!).label,
      ),
    ),
    h(
      'div',
      { class: 'screen-reader-status', 'aria-live': 'polite', 'aria-atomic': true },
      announcement,
    ),
  )
}

if (location.pathname === '/explore') {
  startPrivateExplorer(root, capability)
  capability = undefined
} else {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (
      event.target instanceof Element &&
      event.target.closest('input,textarea,select,[contenteditable]')
    )
      return
    if (panel) {
      event.preventDefault()
      closePanel()
      return
    }
    const state = currentLocal()
    if (state.expanded) {
      event.preventDefault()
      state.expanded = false
      redraw()
    } else if (state.detailOpen) {
      event.preventDefault()
      state.detailOpen = false
      client?.setPreview(undefined)
      redraw()
      focusSelectedEntry()
    }
  })
  if (capability) {
    let previousConnection = ''
    client = new PrivateBrowserClient(capability, () => {
      if (client && client.connection !== previousConnection) {
        previousConnection = client.connection
        announcement =
          client.connection === 'current'
            ? 'Observation synchronized.'
            : client.connection === 'closed'
              ? 'Inspection ended.'
              : client.connection === 'disconnected'
                ? 'Observation disconnected. Retained data may be stale.'
                : ''
      }
      if (client?.connection === 'closed' || client?.connection === 'unauthorized') {
        if (clock) clearInterval(clock)
        clock = undefined
      }
      redraw()
    })
    capability = undefined
    client.start()
    clock = setInterval(() => {
      if (client?.current?.workspace.phase === 'live') render(h(App, {}), root)
    }, 1000)
  }
  redraw()
  addEventListener(
    'pagehide',
    () => {
      if (clock) clearInterval(clock)
      client?.stop()
      render(null, root)
      local.clear()
      previousKeys.clear()
      previousCallKeys = []
      scrollPositions.clear()
      treeChoices.clear()
      compositionSelection = {}
      compositionViewport = undefined
      compositionCenterNodeId = undefined
      compositionScale = 1
      compositionScaleMode = 'automatic'
      compositionRequestFocus = 'all'
      lastRootSourceId = undefined
      releaseCompositionViewport()
      compositionOrigin = undefined
      invocationViewOrigin = undefined
    },
    { once: true },
  )
  addEventListener('pageshow', (event) => {
    if (event.persisted) {
      hasCapability = false
      redraw()
    }
  })
}
