import type { DisplayProjectRun, DisplayProjectSnapshot } from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { CompositionPage } from './composition-view.js'
import { type PrivateExplorerConnection, privateExplorerInput } from './explorer-client.js'
import type { PrivateExplorerScenario } from './explorer-scenarios.js'
import { privateBrowserLiteral } from './navigation.js'

export type PrivateExplorerViewProps = {
  project?: DisplayProjectSnapshot | undefined
  connection: PrivateExplorerConnection
  projectError: string
  projectNotice: string
  run?: DisplayProjectRun | undefined
  runCurrent: boolean
  runError: string
  requestError: string
  sending: boolean
  unresolved: boolean
  canLaunch: boolean
  closing: boolean
  filter: string
  input: string
  inputOpen: boolean
  inputTouched: boolean
  selectedFiles: readonly { attachment: string; filename: string; bytes: number }[]
  draftNotice: string
  scenarioName: string
  scenarioNotice: string
  loadedScenario?: PrivateExplorerScenario | undefined
  selectedNodeId?: string | undefined
  detailOpen: boolean
  scale: number
  theme: string
  onFilter: (value: string) => void
  onTarget: (id: string) => void
  onRefresh: () => void
  onRefreshRun: () => void
  onInput: (value: string) => void
  onInputTouched: () => void
  onFileSelected: (attachment: string, file?: File) => void
  onScenarioName: (name: string) => void
  onScenarioDownload: () => void
  onScenarioFile: (file: File) => void
  onScenarioApply: () => void
  onInputOpen: () => void
  onInputClose: () => void
  onRun: () => void
  onClose: () => void
  onTheme: (theme: string) => void
  onSelect: (id: string) => void
  onDetailClose: () => void
  onScale: (action: 'in' | 'out' | 'fit' | 'actual') => void
  onNodeKeyDown: (event: KeyboardEvent) => void
  onScroll: (left: number, top: number) => void
}

const literal = (value: string): ComponentChildren =>
  h('bdi', { class: 'literal' }, privateBrowserLiteral(value))
const button = (
  label: ComponentChildren,
  action: () => void,
  props: Record<string, unknown> = {},
) => h('button', { type: 'button', onClick: action, ...props }, label)
const paths = {
  map: 'M 4 4 H 10 V 10 H 4 Z M 14 14 H 20 V 20 H 14 Z M 14 4 H 20 V 10 H 14 Z M 10 7 H 14 M 7 10 V 17 H 14',
  play: 'M 8 5 L 19 12 L 8 19 Z',
  refresh: 'M 20 7 V 3 M 20 7 H 16 M 20 7 A 8 8 0 1 0 20 17',
  close: 'M 6 6 L 18 18 M 18 6 L 6 18',
  arrow: 'M 7 17 L 17 7 M 7 7 H 17 V 17',
  system: 'M3 4h18v12H3z M8 21h8 M12 16v5',
  light:
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
  dark: 'M20 15.5A9 9 0 0 1 8.5 4a9 9 0 1 0 11.5 11.5Z',
  'color-free': 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 3v18 M12 7h7 M12 11h9 M12 15h8 M12 19h5',
}
const icon = (name: keyof typeof paths): ComponentChildren =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: 18,
      height: 18,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': true,
    },
    h('path', { d: paths[name] }),
  )

export function ExplorerRunStatus(
  props: Pick<
    PrivateExplorerViewProps,
    | 'project'
    | 'run'
    | 'runCurrent'
    | 'runError'
    | 'requestError'
    | 'sending'
    | 'unresolved'
    | 'onRefreshRun'
  >,
): ComponentChildren {
  const run = props.run
  if (
    !props.sending &&
    !props.unresolved &&
    !props.runError &&
    !props.requestError &&
    (!run || run.state === 'idle')
  )
    return null
  const target =
    run && run.state !== 'idle'
      ? props.project?.targets.find((item) => item.id === run.targetId)
      : undefined
  const heading = props.sending
    ? 'Submitting run'
    : props.unresolved
      ? 'Waiting for run confirmation'
      : run?.state === 'starting'
        ? 'Preparing run'
        : run?.state === 'running'
          ? 'Run in progress'
          : run?.state === 'settled'
            ? 'Run settled'
            : run?.state === 'refused'
              ? 'Run did not start'
              : run?.state === 'uncertain'
                ? 'Run needs attention'
                : props.requestError
                  ? 'Run did not start'
                  : 'Run status unavailable'
  return h(
    'section',
    {
      class:
        'explorer-run-status' +
        (props.requestError ||
        run?.state === 'refused' ||
        run?.state === 'uncertain' ||
        !props.runCurrent
          ? ' needs-attention'
          : ''),
      'aria-label': 'Current run',
      'aria-live': 'polite',
    },
    h(
      'div',
      { class: 'explorer-run-description' },
      h('strong', {}, heading, !props.runCurrent && !props.sending ? ' · status unconfirmed' : ''),
      target ? h('span', { class: 'secondary' }, literal(target.label)) : null,
      run?.state === 'refused' || run?.state === 'uncertain'
        ? h('p', {}, literal(run.reason))
        : null,
      props.runError ? h('p', {}, literal(props.runError)) : null,
      props.requestError
        ? h('p', {}, 'Request did not start: ', literal(props.requestError))
        : null,
      props.unresolved && !props.runError
        ? h('p', {}, 'Checking this request without submitting it again.')
        : null,
    ),
    run && (run.state === 'running' || run.state === 'settled') && run.viewerUrl
      ? h(
          'a',
          {
            class: 'explorer-open-run',
            href: run.viewerUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'Open run',
          icon('arrow'),
        )
      : null,
    props.runError || props.unresolved || run?.state === 'uncertain'
      ? button('Refresh status', props.onRefreshRun)
      : null,
  )
}

function InputPanel(props: PrivateExplorerViewProps): ComponentChildren {
  const selected = props.project?.selected
  if (!selected) return null
  const parsed = privateExplorerInput(props.input)
  const launch = selected.launch
  const schema = selected.input.state === 'schema' ? selected.input : undefined
  return h(
    'aside',
    { class: 'explorer-input-panel', 'aria-labelledby': 'explorer-input-heading' },
    h(
      'header',
      { class: 'explorer-panel-heading' },
      h(
        'div',
        {},
        h('h2', { id: 'explorer-input-heading', tabIndex: -1 }, 'Run with input'),
        h('p', { class: 'secondary' }, 'Give this workflow a JSON value.'),
      ),
      button(icon('close'), props.onInputClose, {
        'aria-label': 'Close run input',
        title: 'Close run input',
      }),
    ),
    h(
      'form',
      {
        onSubmit: (event: Event) => {
          event.preventDefault()
          props.onRun()
        },
      },
      h(
        'div',
        { class: 'explorer-input-toolbar' },
        h('label', { htmlFor: 'explorer-input' }, 'Input JSON'),
      ),
      h('textarea', {
        id: 'explorer-input',
        value: props.input,
        rows: 14,
        spellCheck: false,
        autoComplete: 'off',
        autoCapitalize: 'off',
        placeholder: 'Enter a JSON object, array, string, number, boolean, or null',
        'aria-describedby': 'explorer-input-help',
        'aria-invalid': props.inputTouched && parsed.state !== 'valid',
        disabled: props.sending,
        onInput: (event: Event) =>
          props.onInput((event.currentTarget as HTMLTextAreaElement).value),
        onBlur: props.onInputTouched,
      }),
      h(
        'p',
        {
          id: 'explorer-input-help',
          class:
            'explorer-input-help' +
            (props.inputTouched && parsed.state === 'invalid' ? ' invalid' : ''),
        },
        parsed.state === 'valid'
          ? 'Valid JSON. Jig checks the declared contract before starting.'
          : props.inputTouched
            ? parsed.reason
            : 'Input stays in this tab until you choose Run.',
      ),
      props.draftNotice ? h('p', { class: 'secondary' }, props.draftNotice) : null,
      h(
        'details',
        { class: 'explorer-scenarios' },
        h('summary', {}, 'Reusable input scenarios'),
        h(
          'p',
          { class: 'secondary' },
          'Save a named scenario file or load one from your project. Neither action starts a Run.',
        ),
        h(
          'div',
          { class: 'explorer-scenario-controls' },
          h('label', { htmlFor: 'explorer-scenario-name' }, 'Scenario name'),
          h('input', {
            id: 'explorer-scenario-name',
            type: 'text',
            maxLength: 80,
            value: props.scenarioName,
            placeholder: 'Recognized headings',
            onInput: (event: Event) =>
              props.onScenarioName((event.currentTarget as HTMLInputElement).value),
          }),
          button('Download scenario file', props.onScenarioDownload, {
            disabled: parsed.state !== 'valid' || !props.scenarioName.trim(),
          }),
          h('label', { htmlFor: 'explorer-scenario-file' }, 'Load a scenario file'),
          h('input', {
            id: 'explorer-scenario-file',
            type: 'file',
            accept: '.json,application/json',
            onChange: (event: Event) => {
              const input = event.currentTarget as HTMLInputElement
              const file = input.files?.[0]
              if (file) props.onScenarioFile(file)
              input.value = ''
            },
          }),
        ),
        props.loadedScenario
          ? h(
              'div',
              { class: 'explorer-scenario-loaded' },
              h('strong', {}, literal(props.loadedScenario.name)),
              h(
                'p',
                { class: 'secondary' },
                'Written for ',
                literal(props.loadedScenario.workflow.label),
                ' (',
                props.loadedScenario.workflow.kind === 'binding' ? 'Binding' : 'Flow',
                ').',
              ),
              h(
                'p',
                { class: 'secondary' },
                'Choose the approved workflow above. Applying only edits its input; it never selects or runs a workflow.',
              ),
              button('Use input in selected workflow', props.onScenarioApply),
            )
          : null,
        props.scenarioNotice
          ? h('p', { class: 'explorer-scenario-notice', role: 'status' }, literal(props.scenarioNotice))
          : null,
        h(
          'p',
          { class: 'secondary explorer-scenario-privacy' },
          'Scenario files contain the complete input, including any secrets. Review before sharing or committing them.',
        ),
      ),
      schema
        ? h(
            'details',
            { class: 'explorer-schema' },
            h('summary', {}, 'Declared input schema'),
            h('pre', {}, literal(JSON.stringify(schema.schema, null, 2))),
            schema.definitions
              ? h(
                  'details',
                  {},
                  h('summary', {}, 'Referenced definitions'),
                  h('pre', {}, literal(JSON.stringify(schema.definitions, null, 2))),
                )
              : null,
          )
        : h('p', { class: 'secondary' }, 'This workflow declares no narrower input schema.'),
      selected.attachments.length
        ? h(
            'section',
            { class: 'explorer-input-requirements' },
            h('h3', {}, 'Files'),
            h(
              'ul',
              {},
              selected.attachments.map((item) =>
                h(
                  'li',
                  { key: item.name },
                  h('code', {}, literal(item.name)),
                  h(
                    'span',
                    { class: 'secondary' },
                    item.mode === 'read-write'
                      ? 'Output captured for this run'
                      : item.bound
                        ? 'Input captured by the Binding'
                        : 'Choose one local file for this read attachment',
                  ),
                  item.mode === 'read' && !item.bound
                    ? h(
                        'div',
                        { class: 'explorer-file-select' },
                        h(
                          'label',
                          {},
                          'Choose input for ',
                          literal(item.name),
                          h('input', {
                            type: 'file',
                            'aria-label': 'Choose file for ' + item.name,
                            disabled: props.sending,
                            onChange: (event: Event) => {
                              const input = event.currentTarget as HTMLInputElement
                              props.onFileSelected(item.name, input.files?.[0])
                              input.value = ''
                            },
                          }),
                        ),
                        props.selectedFiles.find((file) => file.attachment === item.name)
                          ? h(
                              'p',
                              { class: 'secondary' },
                              literal(props.selectedFiles.find((file) => file.attachment === item.name)!.filename),
                              ' · ',
                              String(props.selectedFiles.find((file) => file.attachment === item.name)!.bytes),
                              ' bytes',
                              button('Remove file', () => props.onFileSelected(item.name)),
                            )
                          : h('p', { class: 'secondary' }, 'No local file selected'),
                      )
                    : null,
                ),
              ),
            ),
          )
        : null,
      selected.receives.length
        ? h(
            'details',
            { class: 'explorer-schema' },
            h('summary', {}, 'Declared output streams (' + selected.receives.length + ')'),
            h(
              'ul',
              {},
              selected.receives.map((channel) =>
                h(
                  'li',
                  { key: channel.name },
                  h('code', {}, literal(channel.name)),
                  channel.required ? ' · required' : '',
                ),
              ),
            ),
          )
        : null,
      launch.state === 'unavailable'
        ? h('p', { class: 'explorer-blocker', role: 'status' }, literal(launch.reason))
        : null,
      selected.attachments.some((item) => item.mode === 'read' && !item.bound)
        ? h(
            'p',
            { class: 'secondary' },
            'Select one file per unbound read attachment. Each file may be up to 4 MiB; total 8 MiB. Only the selected bytes are sent to the local Jig host when you choose Run. Scenario files retain JSON only.',
          )
        : null,
      !props.runCurrent && !props.sending
        ? h('p', { class: 'secondary' }, 'Waiting for current run status before enabling Run.')
        : null,
      props.run?.state === 'starting' || props.run?.state === 'running'
        ? h(
            'p',
            { class: 'secondary' },
            'One run is active. You can prepare input for the next run.',
          )
        : null,
      props.run?.state === 'uncertain' || props.unresolved
        ? h(
            'p',
            { class: 'explorer-blocker' },
            'Resolve the current run status before starting another run.',
          )
        : null,
      h(
        'button',
        {
          type: 'submit',
          class: 'explorer-primary',
          disabled: !props.canLaunch || parsed.state !== 'valid' ||
            selected.attachments.some((item) =>
              item.mode === 'read' && !item.bound &&
              !props.selectedFiles.some((file) => file.attachment === item.name)),
        },
        icon('play'),
        props.sending ? 'Submitting…' : 'Run workflow',
      ),
      h(
        'p',
        { class: 'explorer-run-note secondary' },
        'Run uses the selected approval and its configured powers. The execution view opens separately.',
      ),
    ),
  )
}

/** A project explorer renders approved configuration without creating observation facts. */
export function ExplorerPage(props: PrivateExplorerViewProps): ComponentChildren {
  if (props.connection === 'closed')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Explorer closing'),
      h(
        'p',
        {},
        'Jig is stopping any active run. Check the terminal for cleanup before starting another exploration session.',
      ),
    )
  if (props.connection === 'unauthorized')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Reopen your terminal link'),
      h(
        'p',
        {},
        'Open the original exploration link in a new tab. Access and input drafts stay only in browser memory.',
      ),
    )
  const project = props.project
  const selected = project?.selected
  const target = project?.targets.find((item) => item.id === selected?.targetId)
  const filter = props.filter.trim().toLocaleLowerCase()
  const targets =
    project?.targets.filter(
      (item) =>
        !filter ||
        [item.label, item.kind, item.description ?? '']
          .join(' ')
          .toLocaleLowerCase()
          .includes(filter),
    ) ?? []
  const duplicateLabels = new Map<string, number>()
  for (const item of project?.targets ?? [])
    duplicateLabels.set(item.label, (duplicateLabels.get(item.label) ?? 0) + 1)
  const targetLabel = (item: NonNullable<typeof project>['targets'][number]): string =>
    item.label +
    ' · ' +
    (item.kind === 'binding' ? 'Binding' : 'Flow') +
    ((duplicateLabels.get(item.label) ?? 0) > 1 ? ' · ' + item.id.slice(0, 12) : '')

  return h(
    'div',
    { class: 'explorer' },
    h(
      'header',
      { class: 'explorer-topbar' },
      h(
        'div',
        { class: 'explorer-brand' },
        h('span', { class: 'explorer-brand-mark', 'aria-hidden': true }, 'j'),
        h('strong', {}, 'jig'),
        h('span', { class: 'secondary' }, 'local workbench'),
      ),
      h('span', { class: 'explorer-topbar-title' }, 'Explore'),
      button(icon('refresh'), props.onRefresh, {
        title: 'Refresh approved project',
        'aria-label': 'Refresh approved project',
        disabled: props.closing,
      }),
      button(props.closing ? 'Closing…' : 'Close explorer', props.onClose, {
        disabled: props.closing,
        title: 'Closing the explorer stops any active run.',
      }),
    ),
    h(
      'div',
      { class: 'explorer-body' },
      h(
        'aside',
        { class: 'explorer-library', 'aria-label': 'Workflow selection' },
        h(
          'div',
          { class: 'explorer-library-heading' },
          h('strong', {}, 'Flows & bindings'),
          h('span', { class: 'secondary' }, project?.targets.length ?? ''),
        ),
        h('label', { class: 'screen-reader-only', htmlFor: 'explorer-filter' }, 'Find a workflow'),
        h('input', {
          id: 'explorer-filter',
          class: 'explorer-filter',
          type: 'search',
          value: props.filter,
          placeholder: 'Find a workflow…',
          onInput: (event: Event) =>
            props.onFilter((event.currentTarget as HTMLInputElement).value),
        }),
        h(
          'select',
          {
            class: 'explorer-mobile-target',
            'aria-label': 'Choose a workflow',
            value: selected?.targetId ?? '',
            onChange: (event: Event) =>
              props.onTarget((event.currentTarget as HTMLSelectElement).value),
          },
          project?.targets.length ? null : h('option', { value: '' }, 'No workflows'),
          project?.targets.map((item) =>
            h('option', { key: item.id, value: item.id }, privateBrowserLiteral(targetLabel(item))),
          ),
        ),
        h(
          'nav',
          { class: 'explorer-targets', 'aria-label': 'Approved workflows' },
          targets.map((item) =>
            button(
              h(
                'span',
                {},
                h('strong', {}, literal(item.label)),
                h(
                  'small',
                  {},
                  item.kind === 'binding' ? 'Binding' : 'Flow',
                  item.availability === 'unavailable' ? ' · unavailable' : '',
                  (duplicateLabels.get(item.label) ?? 0) > 1 ? ' · ' + item.id.slice(0, 12) : '',
                ),
              ),
              () => props.onTarget(item.id),
              {
                key: item.id,
                'aria-current': item.id === selected?.targetId ? 'page' : undefined,
                'data-explorer-target': item.id,
                title: privateBrowserLiteral(item.description ?? targetLabel(item)),
              },
            ),
          ),
          filter && !targets.length
            ? h(
                'p',
                { class: 'secondary explorer-empty-filter' },
                'No matching workflows.',
                button('Clear search', () => props.onFilter('')),
              )
            : null,
          filter && target && !targets.some((item) => item.id === target.id)
            ? h(
                'p',
                { class: 'secondary explorer-empty-filter' },
                'The current workflow is outside this search.',
                button('Clear search', () => props.onFilter('')),
              )
            : null,
        ),
        h(
          'div',
          { class: 'explorer-library-footer' },
          h('p', { class: 'secondary' }, 'Explore approved code. Run when you are ready.'),
          h(
            'div',
            { class: 'appearance', role: 'group', 'aria-label': 'Appearance' },
            (['system', 'light', 'dark', 'color-free'] as const).map((theme) => {
              const label =
                theme === 'color-free' ? 'Monochrome' : theme[0]!.toUpperCase() + theme.slice(1)
              return button(icon(theme), () => props.onTheme(theme), {
                key: theme,
                class: 'appearance-option',
                title: label,
                'aria-label': label + ' appearance',
                'aria-pressed': props.theme === theme,
              })
            }),
          ),
        ),
      ),
      h(
        'main',
        { class: 'explorer-main', id: 'explorer-main' },
        props.projectError
          ? h(
              'div',
              { class: 'explorer-notice', role: 'status' },
              h(
                'strong',
                {},
                project ? 'Showing the last readable configuration' : 'Project unavailable',
              ),
              h('p', {}, literal(props.projectError)),
              button('Refresh', props.onRefresh),
            )
          : null,
        props.projectNotice
          ? h('div', { class: 'explorer-notice', role: 'status' }, literal(props.projectNotice))
          : null,
        ExplorerRunStatus(props),
        target && selected
          ? h(
              'div',
              { class: 'explorer-workflow' },
              h(
                'header',
                { class: 'explorer-workflow-heading' },
                h(
                  'div',
                  {},
                  h(
                    'div',
                    { class: 'explorer-eyebrow' },
                    icon('map'),
                    'Application map',
                    h(
                      'span',
                      {},
                      props.connection === 'current'
                        ? 'Approved configuration'
                        : props.projectError
                          ? 'Previous configuration'
                          : 'Refreshing configuration…',
                    ),
                  ),
                  h('h1', { id: 'explorer-workflow-title', tabIndex: -1 }, literal(target.label)),
                  target.description
                    ? h(
                        'p',
                        { class: 'explorer-workflow-description' },
                        literal(target.description),
                      )
                    : null,
                ),
                button(h('span', {}, icon('play'), 'Run with input'), props.onInputOpen, {
                  class: 'explorer-primary',
                  'aria-expanded': props.inputOpen,
                  disabled: props.closing,
                }),
              ),
              h(
                'div',
                { class: 'explorer-workspace' + (props.inputOpen ? ' input-open' : '') },
                h(
                  'section',
                  { class: 'explorer-map', 'aria-label': 'Application configuration' },
                  CompositionPage({
                    composition: selected.composition,
                    selectedNodeId: props.selectedNodeId,
                    detailOpen: props.detailOpen && !props.inputOpen,
                    scale: props.scale,
                    onScale: props.onScale,
                    onSelect: props.onSelect,
                    onClose: props.onDetailClose,
                    onNodeKeyDown: props.onNodeKeyDown,
                    onScroll: props.onScroll,
                  }),
                ),
                props.inputOpen ? InputPanel(props) : null,
              ),
            )
          : h(
              'section',
              { class: 'explorer-empty' },
              icon('map'),
              h(
                'h1',
                {},
                props.connection === 'connecting'
                  ? 'Opening the project…'
                  : !project
                    ? 'Project unavailable'
                    : project.state === 'unreviewed'
                      ? 'Review your project to explore it'
                      : 'No approved workflows',
              ),
              h(
                'p',
                {},
                props.connection === 'connecting'
                  ? 'Reading the locally approved configuration.'
                  : !project
                    ? 'Refresh to read the approved project. Check the terminal if this continues.'
                    : 'Run jig review in your terminal, then refresh this page.',
              ),
              props.connection === 'connecting' ? null : button('Refresh project', props.onRefresh),
            ),
      ),
    ),
    h(
      'footer',
      { class: 'explorer-footer' },
      h(
        'span',
        {},
        props.connection === 'current'
          ? 'Local exploration'
          : props.connection === 'connecting'
            ? 'Reading project'
            : 'Configuration needs refresh',
      ),
      h(
        'select',
        {
          class: 'explorer-mobile-appearance',
          'aria-label': 'Appearance',
          value: props.theme,
          onChange: (event: Event) =>
            props.onTheme((event.currentTarget as HTMLSelectElement).value),
        },
        h('option', { value: 'system' }, 'System'),
        h('option', { value: 'light' }, 'Light'),
        h('option', { value: 'dark' }, 'Dark'),
        h('option', { value: 'color-free' }, 'Monochrome'),
      ),
      h('span', {}, 'Closing the explorer stops any active run.'),
    ),
  )
}
