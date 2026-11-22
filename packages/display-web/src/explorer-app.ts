import { DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT } from '@jigging/display-model'
import { h, render } from 'preact'
import {
  PRIVATE_EXPLORER_INPUT_BYTES,
  PrivateExplorerClient,
  privateExplorerInput,
} from './explorer-client.js'
import { ExplorerPage } from './explorer-view.js'

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
  let inputFileRead: FileReader | undefined
  let inputFileStatus = ''
  let fileRevision: string | undefined
  let previousSubmission:
    | Readonly<{ input: string; files: ReadonlyMap<string, readonly File[]> }>
    | undefined
  let comparisonOpen = false
  const files = new Map<string, readonly File[]>()
  let draftNotice = ''
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

  function clearInputFile(): void {
    inputFileRead?.abort()
    inputFileRead = undefined
    inputFileStatus = ''
  }

  function writeInput(draft: Draft, value: string): void {
    draft.input = value
    draft.bytes = new TextEncoder().encode(value).byteLength
  }

  function loadInputFile(draft: Draft, file: File): void {
    clearInputFile()
    if (file.size > PRIVATE_EXPLORER_INPUT_BYTES) {
      inputFileStatus = 'Input file exceeds 16 MiB. Choose a smaller file.'
      redraw()
      return
    }
    const reader = new FileReader()
    inputFileRead = reader
    inputFileStatus = 'Reading input file…'
    reader.onload = () => {
      if (inputFileRead !== reader) return
      inputFileRead = undefined
      let value: string
      try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(reader.result as ArrayBuffer)
      } catch {
        inputFileStatus = 'Input file must use UTF-8 text.'
        redraw()
        return
      }
      writeInput(draft, value)
      draft.touched = true
      inputFileStatus = 'Input file loaded.'
      redraw()
    }
    reader.onerror = () => {
      if (inputFileRead !== reader) return
      inputFileRead = undefined
      inputFileStatus = 'Could not read the input file. Choose it again.'
      redraw()
    }
    reader.readAsArrayBuffer(file)
    redraw()
  }

  function closeInput(): void {
    clearInputFile()
    inputOpen = false
    redraw()
    document
      .querySelector<HTMLButtonElement>('.explorer-workflow-heading .explorer-primary')
      ?.focus()
  }

  function selectComponent(id: string): void {
    rememberViewport()
    const draft = selectedDraft()
    draft.nodeId = id
    draft.detailOpen = true
    clearInputFile()
    inputOpen = false
    redraw()
    if (matchMedia('(max-width: 1120px)').matches)
      document.querySelector<HTMLButtonElement>('.back-to-components')?.focus()
    else focusComponent()
  }

  function draw(): void {
    const draft = selectedDraft()
    const revision = client?.project?.revision
    if (fileRevision !== revision) {
      files.clear()
      fileRevision = revision
    }
    const readPorts =
      client?.project?.selected?.attachments.filter(
        (attachment) => attachment.mode === 'read' && !attachment.bound,
      ) ?? []
    const previous = previousSubmission
    render(
      h(ExplorerPage, {
        project: client?.project,
        connection: unauthorized ? 'unauthorized' : (client?.connection ?? 'connecting'),
        projectError: client?.projectError ?? '',
        projectNotice: client?.projectNotice ?? '',
        run: client?.run,
        recent: client?.recent ?? [],
        comparisonOpen,
        onComparisonToggle(open: boolean) {
          comparisonOpen = open
        },
        runCurrent: client?.runCurrent ?? false,
        runError: client?.runError ?? '',
        requestError: client?.requestError ?? '',
        sending: client?.sending ?? false,
        unresolved: !!client?.unresolvedRequest,
        canLaunch:
          !inputFileRead && !!client?.canLaunch && readPorts.every((port) => files.has(port.name)),
        closing: client?.closing ?? false,
        filter,
        input: draft.input,
        canReuse:
          previous !== undefined &&
          (previous.input !== draft.input ||
            readPorts.some(
              ({ name }) =>
                previous.files.has(name) && previous.files.get(name) !== files.get(name),
            )),
        files,
        inputOpen,
        inputTouched: draft.touched,
        inputFileStatus,
        draftNotice:
          draftNotice ||
          (draft.bytes > PRIVATE_EXPLORER_INPUT_BYTES
            ? 'This draft exceeds 16 MiB. It stays visible here but may be cleared when you choose another workflow.'
            : ''),
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
          clearInputFile()
          rememberViewport()
          void client?.refreshProject(id)
        },
        onRefresh() {
          clearInputFile()
          void client?.refreshProject(client.projectError ? null : undefined)
          void client?.refreshRun()
        },
        onRefreshRun() {
          void client?.refreshRun()
        },
        onInput(value: string) {
          clearInputFile()
          writeInput(draft, value)
          redraw()
        },
        onInputFile(file: File) {
          loadInputFile(draft, file)
        },
        onReuse() {
          if (!previous) return
          clearInputFile()
          writeInput(draft, previous.input)
          draft.touched = true
          for (const { name } of readPorts) {
            const selected = previous.files.get(name)
            if (selected) files.set(name, selected)
          }
          inputFileStatus = readPorts.some(({ name }) => !files.has(name))
            ? 'Previous input loaded. Choose files for the remaining attachments.'
            : 'Previous input loaded.'
          redraw()
          document.getElementById('explorer-input')?.focus()
        },
        onInputTouched() {
          draft.touched = true
          redraw()
        },
        onFiles(port: string, selected: readonly File[]) {
          const next = new Map(files)
          next.delete(port)
          const retained = [...next.values()].flat()
          const size = retained.reduce((sum, file) => sum + file.size, 0)
          if (retained.length + selected.length > 64) {
            draftNotice =
              'Select up to 64 files for this approval. Clear another selection to make room.'
            redraw()
            return
          }
          if (
            size + selected.reduce((sum, file) => sum + file.size, 0) >
            DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT
          ) {
            draftNotice = 'Selected files exceed 16 MiB. Choose fewer or smaller files.'
            redraw()
            return
          }
          draftNotice = ''
          if (selected.length) files.set(port, selected)
          else files.delete(port)
          redraw()
        },
        onInputOpen() {
          rememberViewport()
          inputOpen = true
          draft.detailOpen = false
          redraw()
          document.getElementById('explorer-input')?.focus()
        },
        onInputClose: closeInput,
        onRun() {
          if (inputFileRead || !client?.canLaunch) return
          draft.touched = true
          if (privateExplorerInput(draft.input).state !== 'valid') {
            redraw()
            return
          }
          if (readPorts.some((port) => !files.has(port.name))) return
          const submitted = new Map(
            readPorts.flatMap((port) => {
              const selection = files.get(port.name)
              return selection === undefined ? [] : [[port.name, selection] as const]
            }),
          )
          const input = draft.input
          void client.launch(input, crypto.randomUUID(), submitted, () => {
            previousSubmission = { input, files: submitted }
          })
        },
        async onClose() {
          clearInputFile()
          if (await client?.close()) {
            drafts.clear()
            files.clear()
            previousSubmission = undefined
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

  function handleEscape(event: KeyboardEvent): void {
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
      closeInput()
    } else if (draft.detailOpen) {
      event.preventDefault()
      draft.detailOpen = false
      redraw()
      focusComponent()
    }
  }
  document.addEventListener('keydown', handleEscape)
  function focusChanged(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return
    mapFocused = !!event.target.closest('.composition-main')
  }
  root.addEventListener('focusin', focusChanged)
  if (capability) {
    client = new PrivateExplorerClient(capability, () => {
      if (client?.connection === 'closed' || client?.connection === 'unauthorized') {
        clearInputFile()
        drafts.clear()
        previousSubmission = undefined
      }
      redraw()
    })
    client.start()
    capability = undefined
  } else redraw()
  addEventListener(
    'pagehide',
    () => {
      disposed = true
      clearInputFile()
      client?.stop()
      drafts.clear()
      files.clear()
      previousSubmission = undefined
      releaseViewport()
      document.removeEventListener('keydown', handleEscape)
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
