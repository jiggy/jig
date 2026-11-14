import assert from 'node:assert/strict'
import test from 'node:test'
import { CompositionPage } from '../dist/composition-view.js'
import { privateExplorerInput } from '../dist/explorer-client.js'
import {
  PRIVATE_SCENARIO_FILE_BYTE_LIMIT,
  privateExplorerScenario,
  privateExplorerScenarioFile,
} from '../dist/explorer-scenarios.js'
import { ExplorerPage, ExplorerRunStatus } from '../dist/explorer-view.js'

const project = (targetId = 'review') => ({
  kind: 'project',
  revision: 'approved-one',
  state: 'approved',
  targets: [
    {
      id: 'review',
      label: 'Review changes',
      kind: 'binding',
      description: 'Draft, check, and review a change.',
      availability: 'ready',
    },
    { id: 'draft', label: 'Prepare a draft', kind: 'flow', availability: 'ready' },
    { id: 'worker', label: '<script>Worker</script>', kind: 'flow', availability: 'ready' },
  ],
  selected: {
    targetId,
    composition: {
      state: 'available',
      provenance: 'admitted',
      rootId: targetId,
      nodes: [
        {
          id: targetId,
          label: targetId === 'review' ? 'Review changes' : 'Prepare a draft',
          kind: targetId === 'review' ? 'binding' : 'flow',
        },
        { id: 'worker', label: '<script>Worker</script>', kind: 'flow' },
      ],
      edges: [{ id: 'worker-slot', source: targetId, target: 'worker', slot: 'draft' }],
    },
    input: {
      state: 'schema',
      schema: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] },
    },
    attachments: [],
    receives: [],
    launch: { state: 'available' },
  },
})

const walk = (value) =>
  Array.isArray(value)
    ? value.flatMap(walk)
    : value && typeof value === 'object' && 'props' in value
      ? [value, ...walk(value.props.children)]
      : []
const text = (value) =>
  Array.isArray(value)
    ? value.map(text).join('')
    : value && typeof value === 'object' && 'props' in value
      ? text(value.props.children)
      : value == null
        ? ''
        : String(value)
const props = () => ({
  project: project(),
  connection: 'current',
  projectError: '',
  projectNotice: '',
  run: { state: 'idle' },
  runCurrent: true,
  runError: '',
  requestError: '',
  sending: false,
  unresolved: false,
  canLaunch: true,
  closing: false,
  filter: '',
  input: '',
  inputOpen: false,
  inputTouched: false,
  selectedFiles: [],
  draftNotice: '',
  scenarioName: '',
  scenarioNotice: '',
  loadedScenario: undefined,
  detailOpen: false,
  scale: 1,
  theme: 'system',
  onFilter() {},
  onTarget() {},
  onRefresh() {},
  onRefreshRun() {},
  onInput() {},
  onInputTouched() {},
  onFileSelected() {},
  onScenarioName() {},
  onScenarioDownload() {},
  onScenarioFile() {},
  onScenarioApply() {},
  onInputOpen() {},
  onInputClose() {},
  onRun() {},
  onClose() {},
  onTheme() {},
  onSelect() {},
  onDetailClose() {},
  onScale() {},
  onNodeKeyDown() {},
  onScroll() {},
})

test('configuration map contains all calls without inventing Run facts or zero observations', () => {
  const page = CompositionPage({
    composition: project().selected.composition,
    selectedNodeId: 'worker',
    detailOpen: true,
    scale: 1,
    onSelect() {},
    onClose() {},
    onScale() {},
    onNodeKeyDown() {},
    onScroll() {},
  })
  const content = text(page)
  assert.match(content, /Selected root/)
  assert.match(content, /Configured callers/)
  assert.match(content, /Review changes/)
  assert.match(content, /<script>Worker<\/script>/)
  assert.doesNotMatch(
    content,
    /Run root|Run observation|Run phase|Observed calls|retained request|Requests in this run|0 requests/,
  )
  assert.equal(walk(page).filter((node) => node.props['data-component']).length, 2)
  assert.equal(walk(page).filter((node) => node.props['data-composition-edge']).length, 0)
  assert.equal(
    walk(page).some((node) => node.type === 'script'),
    false,
  )
  assert.equal(
    walk(page).some((node) => node.props.dangerouslySetInnerHTML),
    false,
  )
})

test('explorer selects approved workflows before execution and leaves input blank', () => {
  const page = ExplorerPage({ ...props(), inputOpen: true })
  const nodes = walk(page)
  assert.equal(nodes.filter((node) => node.props['data-explorer-target']).length, 3)
  assert.equal(
    nodes.find((node) => node.props['data-explorer-target'] === 'review').props['aria-current'],
    'page',
  )
  assert.equal(nodes.find((node) => node.type === 'textarea').props.value, '')
  assert.equal(
    nodes.find((node) => node.type === 'button' && node.props.type === 'submit').props.disabled,
    true,
  )
  assert.match(text(page), /Declared input schema/)
  assert.match(text(page), /Closing the explorer stops any active run/)
  assert.doesNotMatch(text(page), /Run phase|elapsed|0 requests|Ready to execute/)
})

test('unavailable file or channel requirements stay actionable beside Run input', () => {
  const data = project()
  data.selected.attachments = [{ name: 'source', mode: 'read', bound: false }]
  data.selected.receives = [{ name: 'events', required: true }]
  data.selected.launch = {
    state: 'unavailable',
    reason:
      'This workflow needs input files named source. Supply them through a Flow caller or jig run.',
  }
  const page = ExplorerPage({
    ...props(),
    project: data,
    input: '{"issue":"check"}',
    inputOpen: true,
    canLaunch: false,
  })
  assert.match(text(page), /input files named source/)
  assert.match(text(page), /Choose one local file for this read attachment/)
  assert.match(text(page), /Declared output streams/)
  assert.equal(walk(page).find((node) => node.props.type === 'submit').props.disabled, true)
})

test('required local files must be explicitly selected before Run is enabled', () => {
  const data = project()
  data.selected.attachments = [{ name: 'source', mode: 'read', bound: false }]
  const incomplete = ExplorerPage({
    ...props(),
    project: data,
    input: '{"issue":"check"}',
    inputOpen: true,
    canLaunch: true,
  })
  assert.equal(walk(incomplete).find((node) => node.props.type === 'submit').props.disabled, true)
  assert.match(text(incomplete), /No local file selected/)
  assert.equal(walk(incomplete).filter((node) => node.type === 'input' && node.props.type === 'file').length, 2,
    'scenario and declared input file pickers remain separate')
  const complete = ExplorerPage({
    ...props(),
    project: data,
    input: '{"issue":"check"}',
    inputOpen: true,
    selectedFiles: [{ attachment: 'source', filename: 'contacts.csv', bytes: 3 }],
    canLaunch: true,
  })
  assert.equal(walk(complete).find((node) => node.props.type === 'submit').props.disabled, false)
  assert.match(text(complete), /contacts.csv/)
})

test('settled Run is distinct from success and opens only its separate observer', () => {
  const viewerUrl = 'http://127.0.0.1:43210/#cap=' + 'a'.repeat(43)
  const page = ExplorerRunStatus({
    ...props(),
    run: { state: 'settled', requestId: 'run-one', targetId: 'review', viewerUrl },
  })
  assert.match(text(page), /Run settled/)
  assert.doesNotMatch(text(page), /success|failed/)
  const link = walk(page).find((node) => node.type === 'a')
  assert.equal(link.props.href, viewerUrl)
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noopener noreferrer')
})

test('input accepts JSON scalars and refuses empty, nonfinite, malformed, and overdeep values', () => {
  for (const source of ['null', 'false', '3', '"hello"', '[]', '{}'])
    assert.equal(privateExplorerInput(source).state, 'valid', source)
  assert.equal(privateExplorerInput('').state, 'empty')
  assert.equal(privateExplorerInput('1e999').state, 'invalid')
  assert.equal(privateExplorerInput('{"bad":}').state, 'invalid')
  assert.equal(privateExplorerInput('['.repeat(129) + '0' + ']'.repeat(129)).state, 'invalid')
})


test('portable scenarios round-trip literal input without carrying execution authority', () => {
  const input = '{"issue":"first","issue":"second"}'
  const saved = privateExplorerScenarioFile(
    'Recognized headings',
    { kind: 'binding', label: 'Review changes' },
    input,
  )
  assert.equal(saved.state, 'valid')
  assert.equal(saved.filename, 'recognized-headings.jig-scenario.json')
  const parsed = privateExplorerScenario(saved.text)
  assert.equal(parsed.state, 'valid')
  assert.equal(parsed.scenario.name, 'Recognized headings')
  assert.equal(parsed.scenario.workflow.label, 'Review changes')
  assert.equal(parsed.scenario.workflow.kind, 'binding')
  assert.equal(parsed.scenario.input, input)
  assert.equal('targetId' in parsed.scenario, false)
  assert.equal('revision' in parsed.scenario, false)
  assert.equal('approval' in parsed.scenario, false)
  assert.equal(privateExplorerScenarioFile('No input', { kind: 'flow', label: 'Flow' }, '').state, 'invalid')
})

test('scenario files reject malformed, unknown, oversized and unsafe metadata', () => {
  const valid = {
    format: 'jig-input-scenario.v1',
    name: 'One',
    workflow: { kind: 'flow', label: 'Prepare draft' },
    input: 'null',
  }
  for (const candidate of [
    { ...valid, format: 'jig-input-scenario.v2' },
    { ...valid, name: '../bad' + '\n' },
    { ...valid, name: '' },
    { ...valid, name: 'a'.repeat(81) },
    { ...valid, workflow: { kind: 'binding', label: '' } },
    { ...valid, workflow: { ...valid.workflow, targetId: 'forged' } },
    { ...valid, input: '{"unterminated"' },
    { ...valid, input: '1e999' },
    { ...valid, grants: ['native'] },
  ]) {
    const result = privateExplorerScenario(JSON.stringify(candidate))
    assert.equal(result.state, 'invalid', JSON.stringify(candidate).slice(0, 160))
  }
  assert.equal(privateExplorerScenario('[').state, 'invalid')
  assert.equal(privateExplorerScenario('x'.repeat(PRIVATE_SCENARIO_FILE_BYTE_LIMIT + 1)).state, 'invalid')
})

test('scenario controls do not select a workflow, modify input or run on import alone', () => {
  const scenario = {
    format: 'jig-input-scenario.v1',
    name: 'Example',
    workflow: { kind: 'flow', label: 'Another Flow' },
    input: '{"issue":"review"}',
  }
  let applied = 0, launched = 0
  const page = ExplorerPage({
    ...props(),
    inputOpen: true,
    loadedScenario: scenario,
    scenarioName: 'Example',
    onScenarioApply() { applied++ },
    onRun() { launched++ },
  })
  const nodes = walk(page)
  assert.equal(nodes.find((node) => node.type === 'textarea').props.value, '')
  assert.match(text(page), /Written for/)
  assert.match(text(page), /Another Flow/)
  assert.equal(nodes.filter((node) => node.props['data-explorer-target']).length, 3)
  assert.equal(nodes.find((node) => node.props['data-explorer-target'] === 'review').props['aria-current'], 'page')
  assert.equal(applied, 0)
  assert.equal(launched, 0)
  const apply = nodes.find((node) => node.type === 'button' && text(node) === 'Use input in selected workflow')
  assert(apply)
  apply.props.onClick()
  assert.equal(applied, 1)
  assert.equal(launched, 0)
})
