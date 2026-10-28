import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createDisplayBundle,
  decodeDisplayBundle,
  encodeDisplayBundle,
  previewCollection,
  REPORTING_CONTRACT,
  REPORTING_LIMITS,
  validateDisplayBundle,
  validateReportingMessage,
} from '../dist/index.js'

const collection = (count) => ({
  kind: 'collection',
  id: 'photos',
  title: 'Photos',
  columns: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'reference' },
  ],
  presentation: { kind: 'gallery', media: 'image', title: 'name', alt: 'name' },
  rows: Array.from({ length: count }, (_, index) => ({
    id: String(index),
    cells: {
      name: `Photo ${index}`,
      image: { kind: 'input-artifact', attachment: 'photos', path: `${index}.jpg` },
    },
    details: [
      { kind: 'report', text: 'Supplied caption.', format: 'plain' },
      { kind: 'facts', items: [{ label: 'Index', value: index }] },
    ],
  })),
})
const view = (content) => ({
  kind: 'view',
  id: 'photos',
  title: 'Photos',
  summary: 'Browse the supplied collection.',
  target: { definitionId: 'photos', instanceKey: 'family', subjectKey: 'family' },
  sections: [{ blocks: [content] }],
})

test('a thousand gallery records retain complete source references and row details', () => {
  const input = view(collection(1000))
  const accepted = validateReportingMessage(input)
  assert.equal(accepted.sections[0].blocks[0].rows.length, 1000)
  input.sections[0].blocks[0].rows[0].cells.name = 'Changed'
  assert.equal(accepted.sections[0].blocks[0].rows[0].cells.name, 'Photo 0')
  assert.ok(Object.isFrozen(accepted.sections[0].blocks[0].rows[0].details))
  const invalid = view(collection(1))
  invalid.sections[0].blocks[0].rows[0].cells.image = { kind: 'call', operationId: 'not-an-image' }
  assert.throws(() => validateReportingMessage(invalid), /artifact/)
  invalid.sections[0].blocks[0].presentation.media = 'unknown'
  assert.throws(() => validateReportingMessage(invalid), /declared column/)
})

test('explicit collection previews preserve whole values, totals and full-artifact references', () => {
  const input = collection(2000)
  input.total = 3000
  const complete = { kind: 'artifact', attachment: 'all', path: 'photos.json' }
  const selected = previewCollection(input, { limit: 15, complete })
  assert.equal(selected.shown, 15)
  assert.equal(selected.total, 3000)
  assert.equal(selected.omitted, 2985)
  assert.equal(selected.collection.total, 3000)
  assert.equal(input.rows.length, 2000)
  assert.deepEqual(selected.complete, complete)
  assert.deepEqual({ ...selected.collection.rows[14].cells }, input.rows[14].cells)
  const large = collection(1000)
  for (const row of large.rows) row.cells.name = 'x'.repeat(4096)
  const bounded = previewCollection(large)
  assert.ok(bounded.shown > 0 && bounded.shown < 1000)
  assert.equal(bounded.collection.rows[0].cells.name.length, 4096)
  assert.doesNotThrow(() => validateReportingMessage(view(bounded.collection)))
  const malformed = collection(1)
  malformed.rows[0].cells.name = true
  assert.throws(() => previewCollection(malformed), /Cell does not match/)
})

test('finite bundles derive tombstone conditions, own values, and reject ambiguous or executable fields', () => {
  const projection = view(collection(2))
  const context = {
    generation: 'generation-1',
    heads: [
      {
        definitionId: 'photos',
        instanceKey: 'family',
        revision: 'generation-1:7',
        retained: false,
      },
    ],
  }
  const bundle = createDisplayBundle(context, {
    requestId: 'publication-1',
    edition: 'Album edition',
    views: [{ view: projection, completeness: 'complete', domainRevision: 'domain-1' }],
  })
  assert.equal(bundle.views[0].expectedRevision, 'generation-1:7')
  projection.sections[0].blocks[0].rows[0].cells.name = 'Changed'
  assert.equal(bundle.views[0].view.sections[0].blocks[0].rows[0].cells.name, 'Photo 0')
  const document = encodeDisplayBundle(bundle)
  assert.ok(document.endsWith('\n'))
  assert.deepEqual(decodeDisplayBundle(new TextEncoder().encode(document)), bundle)
  assert.throws(() => validateDisplayBundle({ ...bundle, callback: 'execute' }))
  assert.throws(
    () => validateDisplayBundle({ ...bundle, views: [bundle.views[0], bundle.views[0]] }),
    /duplicated/,
  )
  assert.throws(() => decodeDisplayBundle(new Uint8Array([255])))
  assert.throws(
    () =>
      createDisplayBundle(
        { ...context, heads: [...context.heads, context.heads[0]] },
        { requestId: 'r', edition: 'e', views: [] },
      ),
    /duplicate/,
  )
  assert.equal(
    createDisplayBundle(
      { generation: 'g', heads: [] },
      {
        requestId: 'r',
        edition: 'e',
        views: [{ view: view(collection(0)), completeness: 'partial' }],
      },
    ).views[0].expectedRevision,
    null,
  )
})

async function wire(body, confirmation = false, observations = true) {
  const script = `import {handle} from '@jigging/flow'; import {withReporting} from './dist/index.js'; await handle(run=>withReporting(run,'updates',async report=>{${body}; ${confirmation ? 'await run.channels.confirm.close();' : ''} return {outcome:'done',output:true}}));`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const observed = [],
    pending = []
  let nextConfirmation = 0
  let stderr = '',
    result
  child.stderr.setEncoding('utf8').on('data', (value) => {
    stderr += value
  })
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const timeout = setTimeout(() => child.kill(), 15000)
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`)
  const confirm = () => {
    while (pending.length && observed.length > pending[0].revision) {
      const item = pending.shift()
      send({
        jsonrpc: '2.0',
        id: item.id,
        result: { item: { sequence: item.revision + 1, value: item.revision } },
      })
    }
  }
  send({
    jsonrpc: '2.0',
    id: 'host:1',
    method: 'flow/run',
    params: {
      protocol: 'run/0',
      input: {},
      settings: {},
      attachments: {},
      scratch: '/unused-reporting-scratch',
      deadlineUnixMs: Date.now() + 12000,
      channels: {
        ...(observations
          ? {
              updates: {
                endpoint: 'updates:1',
                direction: 'send',
                delivery: 'direct',
                contract: REPORTING_CONTRACT,
              },
            }
          : {}),
        ...(confirmation
          ? {
              confirm: {
                endpoint: 'confirm:1',
                direction: 'receive',
                delivery: 'direct',
                startSequence: 1,
              },
            }
          : {}),
      },
    },
  })
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const frame = JSON.parse(line)
      if (frame.method === 'channel/send') {
        observed.push(frame.params.value)
        send({ jsonrpc: '2.0', id: frame.id, result: null })
        confirm()
      } else if (frame.method === 'channel/next') {
        pending.push({ id: frame.id, revision: nextConfirmation++ })
        confirm()
      } else if (frame.method === 'channel/close')
        send({ jsonrpc: '2.0', id: frame.id, result: null })
      else if (frame.method === 'channel/release')
        send({ jsonrpc: '2.0', id: frame.id, result: { status: 'released' } })
      else if (frame.id === 'host:1') {
        result = frame
        child.stdin.end()
      } else assert.fail(`Unexpected protocol frame: ${JSON.stringify(frame)}`)
    }
    const status = await exited
    assert.equal(status.code, 0, stderr)
    assert.equal(result?.result?.outcome, 'done', stderr || JSON.stringify(result))
    return observed
  } finally {
    clearTimeout(timeout)
    child.kill()
    await exited
  }
}

test('real SDK publication coalesces rotating keys within an epoch and preserves barriers', async () => {
  const messages = await wire(
    `const views=['photos','organize','contact-sheet'].map(id=>report.view(id,{title:id})); for(let revision=0;revision<1000;revision++) for(const view of views) view.update({summary:String(revision),sections:[]}); report.notice('Edition boundary'); views[0].update({summary:'After boundary',sections:[]}); views[0].retire();`,
  )
  assert.deepEqual(
    messages.map((value) => value.kind),
    ['view', 'view', 'view', 'notice', 'view', 'retire-view'],
  )
  assert.deepEqual(
    messages.slice(0, 3).map((value) => value.summary),
    ['999', '999', '999'],
  )
})

test('real SDK publication crosses four MiB after actual protocol confirmation of each snapshot', async () => {
  const messages = await wire(
    `const view=report.view('records',{title:'Records'});const rows=Array.from({length:1000},(_,i)=>({id:String(i),cells:{text:'x'.repeat(420)}}));for(let revision=0;revision<11;revision++){view.update({summary:String(revision),sections:[{blocks:[{kind:'collection',id:'records',title:'Records',columns:[{key:'text',label:'Text',type:'text'}],rows}]}]});const observed=await run.channels.confirm.next();if(observed.done||observed.value!==revision)throw Error('Confirmation mismatch')}`,
    true,
  )
  assert.equal(messages.length, 11)
  assert.ok(
    messages.reduce((bytes, value) => bytes + Buffer.byteLength(JSON.stringify(value)), 0) >
      4194304,
  )
  assert.equal(messages.at(-1).summary, '10')
  assert.equal(REPORTING_LIMITS.attempts, 18000)
})

test('real SDK view declarations own independent application instances', async () => {
  const messages = await wire(
    `const target={definitionId:'photos',instanceKey:'family',subjectKey:'family'};const family=report.view('family',{title:'Photos',target});target.instanceKey='mutated';const spring=report.view('spring',{title:'Photos',target:{definitionId:'photos',instanceKey:'spring'}});family.update({summary:'Family',sections:[]});spring.update({summary:'Spring',sections:[]});`,
  )
  assert.deepEqual(
    messages.map((value) => value.target.instanceKey),
    ['family', 'spring'],
  )
})

for (const observations of [true, false]) {
  test(`real SDK reading-to-targeted-view handoff preserves one lifetime landing hint (${observations ? 'wired' : 'unwired'})`, async () => {
    const messages = await wire(
      `const reading=report.view('reading',{title:'Reading CSV'});reading.update({summary:'Reading source',sections:[]});reading.retire();const contacts=report.view('contacts',{title:'Contact preview',landing:true,target:{definitionId:'contact-preview',instanceKey:'captured-csv'}});contacts.update({summary:'Whole checked records',sections:[]});contacts.retire();let rejected=false;try{report.view('another',{title:'Another landing',landing:true}).update({summary:'Invalid second landing',sections:[]})}catch(error){if(!(error instanceof TypeError)||error.message!=='Only one view may nominate a landing hint')throw error;rejected=true}if(!rejected)throw Error('Retirement released the publisher lifetime landing claim');`,
      false,
      observations,
    )
    if (!observations) {
      assert.deepEqual(messages, [])
      return
    }
    assert.deepEqual(
      messages.map((value) => [value.kind, value.id]),
      [
        ['view', 'reading'],
        ['retire-view', 'reading'],
        ['view', 'contacts'],
        ['retire-view', 'contacts'],
      ],
    )
    assert.equal(messages[0].landing, undefined)
    assert.equal(messages[2].landing, true)
    assert.equal(messages[2].target.instanceKey, 'captured-csv')
  })
}

test('copyable publication and target identities reject hidden controls while preserving Unicode names', () => {
  const ordinary = view(collection(0))
  const unicode = {
    ...ordinary,
    target: { definitionId: 'café', instanceKey: 'álbum', subjectKey: '家族' },
  }
  const accepted = createDisplayBundle(
    { generation: 'génération', heads: [] },
    {
      requestId: 'édition',
      edition: 'Display label',
      views: [{ view: unicode, completeness: 'complete' }],
    },
  )
  assert.equal(accepted.requestId, 'édition')
  assert.equal(accepted.views[0].view.target.definitionId, 'café')
  for (const hidden of ['\0', '\u001b', '\u202e', '\u200b']) {
    for (const field of ['definitionId', 'instanceKey', 'subjectKey'])
      assert.throws(
        () =>
          validateReportingMessage({
            ...ordinary,
            target: { ...ordinary.target, [field]: 'unsafe' + hidden },
          }),
        /identity/,
      )
    for (const field of ['requestId', 'generation'])
      assert.throws(
        () => validateDisplayBundle({ ...accepted, [field]: 'unsafe' + hidden }),
        /identity/,
      )
    assert.throws(
      () =>
        validateDisplayBundle({
          ...accepted,
          views: [{ ...accepted.views[0], expectedRevision: 'unsafe' + hidden }],
        }),
      /identity/,
    )
    assert.throws(
      () =>
        createDisplayBundle(
          {
            generation: 'g',
            heads: [
              {
                definitionId: 'photos',
                instanceKey: 'family',
                revision: 'unsafe' + hidden,
                retained: false,
              },
            ],
          },
          { requestId: 'r', edition: 'e', views: [{ view: ordinary, completeness: 'partial' }] },
        ),
      /identity/,
    )
  }
})
