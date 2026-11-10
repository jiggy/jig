import { DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT } from '@jigging/display-model'
import { h, render } from 'preact'
import { PrivateExplorerClient, privateExplorerInput } from './explorer-client.js'
import { ExplorerPage } from './explorer-view.js'
import {
  PRIVATE_SCENARIO_FILE_BYTE_LIMIT,
  type PrivateExplorerScenario,
  privateExplorerScenario,
  privateExplorerScenarioFile,
} from './explorer-scenarios.js'

type Draft = {
  input: string
  bytes: number
  touched: boolean
  nodeId?: string | undefined
  detailOpen: boolean
  scale: number
  scaleMode: 'automatic' | 'fit' | 'manual'
  left: number
  top: number
}

/** The explorer owns project intent. Each launched Run keeps its ordinary readonly viewer. */
export function startPrivateExplorer(root: HTMLElement, capability: string | undefined): void {
  document.title = 'Jig · Explore'
  const drafts = new Map<string, Draft>()
  let activeKey = ''
  let filter = ''
  let inputOpen = false
  let draftNotice = ''
  let scenarioName = ''
  let scenarioNotice = ''
  let loadedScenario: PrivateExplorerScenario | undefined
  let scenarioReadGeneration = 0
  let theme = document.documentElement.dataset.theme ?? 'system'
  let viewport: HTMLElement | undefined
  let viewportVisible = false
  let mapFocused = false
  let resize: ResizeObserver | undefined
  let resizeFrame: number | undefined
  let disposed = false
  let restoredKey = ''
  let client: PrivateExplorerClient | undefined
  let unauthorized = !capability
  const empty: Draft = {
    input: '',
    bytes: 0,
    touched: false,
    detailOpen: false,
    scale: 1,
    scaleMode: 'automatic',
    left: 0,
    top: 0,
  }

  function selectedDraft(): Draft {
    const project = client?.project
    const key = project?.selected ? project.revision + ':' + project.selected.targetId : ''
    activeKey = key
    if (!key) return empty
    let draft = drafts.get(key)
    if (!draft) {
      draft = { ...empty }
      drafts.set(key, draft)
    } else {
      drafts.delete(key)
      drafts.set(key, draft)
    }
    let bytes = 0
    for (const item of drafts.values()) bytes += item.bytes
    for (const [oldKey, oldDraft] of drafts) {
      if (drafts.size <= 16 && bytes <= DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT) break
      if (oldKey === key) continue
      bytes -= oldDraft.bytes
      drafts.delete(oldKey)
      draftNotice =
        'An older input draft was cleared. This tab retains up to 16 drafts within 16 MiB.'
    }
    return draft
  }

  function releaseViewport(): void {
    resize?.disconnect()
    resize = undefined
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = undefined
    viewport = undefined
    viewportVisible = false
  }

  function rememberViewport(): void {
    const draft = drafts.get(activeKey)
    if (!draft || !viewport?.clientWidth || !viewport.clientHeight) return
    draft.left = viewport.scrollLeft
    draft.top = viewport.scrollTop
  }

  function fitScale(element: HTMLElement): number | undefined {
    const width = Number(element.dataset.compositionWidth)
    const height = Number(element.dataset.compositionHeight)
    if (
      !element.clientWidth ||
      !element.clientHeight ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return
    return Math.min(
      1,
      Math.max(1, element.clientWidth - 2) / width,
      Math.max(1, element.clientHeight - 2) / height,
    )
  }

  function restoreViewport(): void {
    const element = document.getElementById('composition-scroll')
    if (!element) {
      releaseViewport()
      return
    }
    const changed = element !== viewport || restoredKey !== activeKey || !viewportVisible
    if (element !== viewport) {
      releaseViewport()
      viewport = element
      resize = new ResizeObserver(() => {
        if (resizeFrame !== undefined || disposed) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          redraw()
        })
      })
      resize.observe(element)
    }
    const draft = selectedDraft()
    const fit = fitScale(element)
    if (fit === undefined) {
      viewportVisible = false
      if (mapFocused && draft.detailOpen && !inputOpen) {
        document.querySelector<HTMLButtonElement>('.back-to-components')?.focus()
        mapFocused = false
      }
      return
    }
    viewportVisible = true
    const scale =
      draft.scaleMode === 'fit'
        ? fit
        : draft.scaleMode === 'automatic'
          ? fit >= 0.75
            ? fit
            : 1
          : draft.scale
    if (scale !== draft.scale) {
      draft.scale = scale
      draw()
    }
    if (changed) {
      element.scrollLeft = draft.left
      element.scrollTop = draft.top
      restoredKey = activeKey
    }
  }

  function focusComponent(): void {
    document
      .querySelector<HTMLButtonElement>('[data-component][aria-pressed=true]')
      ?.focus({ preventScroll: true })
  }

  function selectComponent(id: string): void {
    rememberViewport()
    const draft = selectedDraft()
    draft.nodeId = id
    draft.detailOpen = true
    inputOpen = false
    redraw()
    if (matchMedia('(max-width: 1120px)').matches)
      document.querySelector<HTMLButtonElement>('.back-to-components')?.focus()
    else focusComponent()
  }

  function draw(): void {
    const draft = selectedDraft()
    render(
      h(ExplorerPage, {
        project: client?.project,
        connection: unauthorized ? 'unauthorized' : (client?.connection ?? 'connecting'),
        projectError: client?.projectError ?? '',
        projectNotice: client?.projectNotice ?? '',
        run: client?.run,
        runCurrent: client?.runCurrent ?? false,
        runError: client?.runError ?? '',
        requestError: client?.requestError ?? '',
        sending: client?.sending ?? false,
        unresolved: !!client?.unresolvedRequest,
        canLaunch: client?.canLaunch ?? false,
        closing: client?.closing ?? false,
        filter,
        input: draft.input,
        inputOpen,
        inputTouched: draft.touched,
        draftNotice,
        scenarioName,
        scenarioNotice,
        loadedScenario,
        selectedNodeId: draft.nodeId,
        detailOpen: draft.detailOpen,
        scale: draft.scale,
        theme,
        onFilter(value: string) {
          filter = value
          redraw()
        },
        onTarget(id: string) {
          if (!id || id === client?.project?.selected?.targetId) return
          rememberViewport()
          void client?.refreshProject(id)
        },
        onRefresh() {
          void client?.refreshProject(client.projectError ? null : undefined)
          void client?.refreshRun()
        },
        onRefreshRun() {
          void client?.refreshRun()
        },
        onInput(value: string) {
          draft.input = value
          draft.bytes = new TextEncoder().encode(value).byteLength
          if (draft.bytes > DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT)
            draftNotice =
              'This draft exceeds 16 MiB. It stays visible here but may be cleared when you choose another workflow.'
          redraw()
        },
        onInputTouched() {
          draft.touched = true
          redraw()
        },
        onScenarioName(value: string) {
          scenarioName = value
          scenarioNotice = ''
          redraw()
        },
        onScenarioDownload() {
          const selected = client?.project?.selected
          const target = client?.project?.targets.find((item) => item.id === selected?.targetId)
          if (!selected || !target) {
            scenarioNotice = 'Choose an approved workflow before saving a scenario.'
            redraw()
            return
          }
          const saved = privateExplorerScenarioFile(
            scenarioName,
            { kind: target.kind, label: target.label },
            draft.input,
          )
          if (saved.state === 'invalid') {
            scenarioNotice = saved.reason
            redraw()
            return
          }
          // A download is an explicit user action. No project file is written or cached by Jig.
          const url = URL.createObjectURL(new Blob([saved.text], { type: 'application/json' }))
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = saved.filename
          document.body.append(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          scenarioNotice = 'Scenario download requested. Review its full input before sharing.'
          redraw()
        },
        onScenarioFile(file: File) {
          const generation = ++scenarioReadGeneration
          loadedScenario = undefined
          if (file.size > PRIVATE_SCENARIO_FILE_BYTE_LIMIT) {
            scenarioNotice = 'The scenario file exceeds the 16 MiB input allowance.'
            redraw()
            return
          }
          scenarioNotice = 'Reading the selected scenario file…'
          redraw()
          void file.text().then(
            (source) => {
              if (disposed || generation !== scenarioReadGeneration) return
              const result = privateExplorerScenario(source)
              if (result.state === 'valid') {
                loadedScenario = result.scenario
                scenarioName = result.scenario.name
                scenarioNotice = 'Scenario loaded for review. Select Use input to change this workflow’s draft.'
              } else scenarioNotice = result.reason
              redraw()
            },
            () => {
              if (disposed || generation !== scenarioReadGeneration) return
              scenarioNotice = 'The selected scenario file could not be read.'
              redraw()
            },
          )
        },
        onScenarioApply() {
          const selected = client?.project?.selected
          const source = loadedScenario
          if (!source || !selected) return
          const draft = selectedDraft()
          draft.input = source.input
          draft.bytes = new TextEncoder().encode(source.input).byteLength
          draft.touched = false
          const target = client?.project?.targets.find((item) => item.id === selected.targetId)
          scenarioNotice =
            'Loaded “' + source.name + '” into this workflow’s input without starting a Run.' +
            (target && (target.label !== source.workflow.label || target.kind !== source.workflow.kind)
              ? ' Its recorded workflow name differs; review the selected target and input before running.'
              : '')
          inputOpen = true
          draft.detailOpen = false
          redraw()
          document.getElementById('explorer-input')?.focus()
        },
        onInputOpen() {
          rememberViewport()
          inputOpen = true
          draft.detailOpen = false
          redraw()
          document.getElementById('explorer-input')?.focus()
        },
        onInputClose() {
          inputOpen = false
          redraw()
          document
            .querySelector<HTMLButtonElement>('.explorer-workflow-heading .explorer-primary')
            ?.focus()
        },
        onRun() {
          draft.touched = true
          if (privateExplorerInput(draft.input).state !== 'valid') {
            redraw()
            return
          }
          void client?.launch(draft.input, crypto.randomUUID())
        },
        async onClose() {
          if (await client?.close()) {
            drafts.clear()
            loadedScenario = undefined
            scenarioReadGeneration++
            inputOpen = false
            redraw()
          }
        },
        onTheme(value: string) {
          theme = value
          document.documentElement.dataset.theme = value
          redraw()
        },
        onSelect: selectComponent,
        onDetailClose() {
          draft.detailOpen = false
          redraw()
          focusComponent()
        },
        onScale(action: 'in' | 'out' | 'fit' | 'actual') {
          rememberViewport()
          draft.scaleMode = action === 'fit' ? 'fit' : 'manual'
          draft.scale =
            action === 'actual'
              ? 1
              : action === 'in'
                ? Math.min(2, draft.scale * 1.2)
                : action === 'out'
                  ? Math.max(0.2, draft.scale / 1.2)
                  : draft.scale
          redraw()
          focusComponent()
          if (viewport?.clientWidth && viewport.clientHeight)
            document
              .querySelector<HTMLButtonElement>('[data-component][aria-pressed=true]')
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        },
        onNodeKeyDown(event: KeyboardEvent) {
          if (
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
          )
            return
          const nodes = client?.project?.selected?.composition
          if (nodes?.state !== 'available' || !nodes.nodes.length) return
          event.preventDefault()
          const index = nodes.nodes.findIndex((item) => item.id === draft.nodeId)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? nodes.nodes.length - 1
                : (Math.max(0, index) +
                    (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
                    nodes.nodes.length) %
                  nodes.nodes.length
          selectComponent(nodes.nodes[next]!.id)
          document
            .querySelector<HTMLButtonElement>('[data-component][aria-pressed=true]')
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        },
        onScroll(left: number, top: number) {
          if (!viewport?.clientWidth || !viewport.clientHeight) return
          draft.left = left
          draft.top = top
        },
      }),
      root,
    )
  }

  function redraw(): void {
    if (disposed) return
    const focused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const previousKey = activeKey
    rememberViewport()
    draw()
    if (activeKey !== previousKey) restoredKey = ''
    restoreViewport()
    if (focused && !focused.isConnected) {
      if (focused.dataset.explorerTarget !== undefined)
        document
          .querySelector<HTMLButtonElement>('[data-explorer-target][aria-current="page"]')
          ?.focus()
      else if (focused.dataset.component !== undefined)
        document.getElementById('explorer-workflow-title')?.focus()
    }
  }

  function escape(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      (event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable]'))
    )
      return
    const draft = selectedDraft()
    if (inputOpen) {
      event.preventDefault()
      inputOpen = false
      redraw()
      document
        .querySelector<HTMLButtonElement>('.explorer-workflow-heading .explorer-primary')
        ?.focus()
    } else if (draft.detailOpen) {
      event.preventDefault()
      draft.detailOpen = false
      redraw()
      focusComponent()
    }
  }
  document.addEventListener('keydown', escape)
  function focusChanged(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return
    mapFocused = !!event.target.closest('.composition-main')
  }
  root.addEventListener('focusin', focusChanged)
  if (capability) {
    client = new PrivateExplorerClient(capability, () => {
      if (client?.connection === 'closed' || client?.connection === 'unauthorized') drafts.clear()
      redraw()
    })
    client.start()
    capability = undefined
  } else redraw()
  addEventListener(
    'pagehide',
    () => {
      disposed = true
      scenarioReadGeneration++
      loadedScenario = undefined
      client?.stop()
      drafts.clear()
      releaseViewport()
      document.removeEventListener('keydown', escape)
      root.removeEventListener('focusin', focusChanged)
      render(null, root)
    },
    { once: true },
  )
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    disposed = false
    unauthorized = true
    redraw()
  })
}
