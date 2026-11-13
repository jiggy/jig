import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const directory = path.dirname(fileURLToPath(import.meta.url))
export const repository = path.resolve(directory, '../../../..')
export const digest = (text) => createHash('sha256').update(text).digest('hex')
export const arms = ['sequence', 'dot', 'prose']
export async function loadPacket(root = repository) {
  const packet = JSON.parse(await readFile(path.join(directory, 'support-case.json'), 'utf8'))
  for (const [file, source] of Object.entries(packet.sources)) {
    const text = await readFile(path.join(root, packet.root, file), 'utf8')
    if (digest(text) !== source.sha256) throw Error(`Stale packet: ${file}`)
    for (const fact of packet.facts)
      for (const anchor of fact.evidence) {
        if (anchor.file !== file) continue
        const at = text.indexOf(anchor.quote)
        if (at < 0 || text.slice(0, at).split('\n').length !== anchor.line)
          throw Error(`Invalid anchor: ${fact.id}`)
      }
  }
  return packet
}
export function render(packet, arm) {
  if (!arms.includes(arm)) throw Error('Unknown representation')
  const header = `Basis: ${packet.basis}\nRevision: ${packet.revision}\nScope: ${packet.scope}\n`
  const labels = Object.entries(packet.entities)
    .map(([id, name]) => `${id} = ${name}`)
    .join('\n')
  // Each representation carries each identical fact once. Source anchors are shared.
  let body
  if (arm === 'sequence') {
    const lines = [
      'sequenceDiagram',
      ...Object.entries(packet.entities).map(([id, name]) => `    participant ${id} as ${name}`),
    ]
    const fact = (id) => packet.facts.find((f) => f.id === id)
    const emit = (id, message = false) => {
      const f = fact(id)
      const label = `[${f.id}] ${f.text}`
      lines.push(
        message
          ? `    ${f.from}->>${f.to}: ${label}`
          : `    Note over ${f.from}${f.from === f.to ? '' : ',' + f.to}: ${label}`,
      )
    }
    emit('routing')
    emit('agent-route')
    emit('duplicate')
    emit('assessment', true)
    emit('egress', true)
    emit('validate')
    lines.push(
      '    assess-->>resolve: assessment',
      '    alt assessment.outcome is blocked or limit',
    )
    emit('abstain')
    lines.push('    else assessment.outcome is done')
    emit('credit-input', true)
    lines.push('    credit-->>resolve: checked')
    emit('credit-return')
    emit('disposition')
    emit('policy')
    lines.push('    else other assessment outcome')
    emit('unexpected')
    lines.push('    end')
    emit('provider')
    emit('observation')
    body = lines.join('\n')
  } else if (arm === 'dot') {
    const lines = [
      'digraph support_case {',
      ...Object.entries(packet.entities).map(
        ([id, name]) => `  ${id} [label=${JSON.stringify(name)}];`,
      ),
    ]
    for (const f of packet.facts)
      lines.push(
        `  ${f.from} -> ${f.to} [label=${JSON.stringify(`[${f.id}] ${f.text}`)}, kind=${JSON.stringify(f.kind)}];`,
      )
    body = lines.concat('}').join('\n')
  } else
    body =
      labels +
      '\n\n' +
      packet.facts.map((f) => `[${f.id}] ${f.from} → ${f.to} (${f.kind}): ${f.text}`).join('\n')
  const anchors = packet.facts
    .map((f) => `[${f.id}] ${f.evidence.map((e) => `${e.file}:${e.line}`).join(', ')}`)
    .join('\n')
  return `${header}\n${body}\n\nSource anchors:\n${anchors}\n`
}
export const questions = {
  abstain: 'If assessment returns blocked, does resolve call credit? Answer yes/no/unknown.',
  data: 'Which value supplies credit.input.proposal? Answer assessment.output/run.input/reply/unknown.',
  decision:
    'Is manual_review an invocation outcome here or a disposition in done? Answer outcome/disposition/unknown.',
  privacy: 'Does the provider delete submitted data? Answer yes/no/unknown.',
  counts: 'How many actual Agent invocations were observed? Answer an integer or unknown.',
  change:
    'Which file owns the local credit amount cap? Answer its packet-relative path or unknown.',
  caller: 'Which participant calls credit? Answer resolve/assess/agent/unknown.',
  guard: 'Do duplicate charge IDs prevent the assessment call? Answer yes/no/unknown.',
}
export const expected = {
  abstain: 'no',
  data: 'assessment.output',
  decision: 'disposition',
  privacy: 'unknown',
  counts: 'unknown',
  change: 'flows/check-credit/policy.ts',
  caller: 'resolve',
  guard: 'yes',
}
export function score(answer) {
  return Object.fromEntries(
    Object.entries(expected).map(([id, value]) => [id, answer.answers?.[id] === value]),
  )
}
export function applyEdit(source, edit) {
  if (
    edit?.file !== expected.change ||
    edit.old !== 'const maximumCreditCents = 5000' ||
    edit.new !== 'const maximumCreditCents = 7500'
  )
    throw Error('Edit is outside the bounded task')
  if (source.split(edit.old).length !== 2) throw Error('Edit anchor is not unique')
  return source.replace(edit.old, edit.new)
}
export async function writeRepresentations(destination) {
  const packet = await loadPacket()
  await mkdir(destination, { recursive: false })
  for (const arm of arms)
    await writeFile(path.join(destination, `${arm}.txt`), render(packet, arm), { flag: 'wx' })
  await writeFile(path.join(destination, 'packet.json'), JSON.stringify(packet, null, 2) + '\n', {
    flag: 'wx',
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node experiment.mjs NEW_DIRECTORY')
  await writeRepresentations(path.resolve(process.argv[2]))
}
