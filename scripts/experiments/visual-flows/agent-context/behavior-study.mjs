import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repository = fileURLToPath(new URL('../../../../', import.meta.url))
export const directory = fileURLToPath(new URL('.', import.meta.url))
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const studies = [
  {
    id: 'software-factory',
    briefs: ['factory-behavior.md', 'factory-job.md', 'factory-repair.md'],
    task: 'Change factory conflict policy: any two accepted jobs proposing the same destination path must conflict, even when replacement contents are identical. Preserve worker joining, per-job checkpointing, readiness requirements, and delivery. Edit only application source needed for this change.',
    questions: {
      identical: [
        'Do identical proposed contents for one destination conflict BEFORE this change?',
        ['yes', 'no'],
      ],
      timer: [
        'Does the per-job timer cover returned-evidence validation and deliverable writes?',
        ['yes', 'no'],
      ],
      join: [
        'When is final batch readiness decided?',
        ['after-each-checkpoint', 'after-all-workers-and-checkpoints'],
      ],
      goals: [
        'After a well-formed job starts, can goal.txt already exist when the router returns a malformed decision?',
        ['yes', 'no'],
      ],
      done: ['Can repair done still fail the factory evidence check?', ['yes', 'no']],
      correction: [
        'Which files does the next proposal replace?',
        ['original-files', 'previous-candidate'],
      ],
    },
    expected: {
      identical: 'no',
      timer: 'no',
      join: 'after-all-workers-and-checkpoints',
      goals: 'yes',
      done: 'yes',
      correction: 'original-files',
    },
    editable: ['flows/factory/batch.ts'],
  },
  {
    id: 'support-case',
    briefs: ['support-behavior.md'],
    task: 'Add a bounded credit-check refusal: when there are more than 16 supplied charges, check-credit returns limit with output {reason:"too_many_charges"} before local policy. Keep duplicate-ID rejection. Declare this outcome and its result shape in the credit contract. Make resolve pass this credit limit through, report the limit phase/reason, and skip accountId validation for it. Preserve assessment blocked/limit handling and ordinary done behavior.',
    questions: {
      refusal: ['Does assessment blocked currently invoke credit?', ['yes', 'no']],
      payload: ['What does credit receive?', ['account-and-proposal', 'message-only']],
      disposition: ['Is manual_review a Run outcome here?', ['yes', 'no']],
      unexpected: [
        'What does resolve currently do with a credit limit?',
        ['pass-through', 'throw'],
      ],
      identity: ['Does resolve check returned account identity?', ['yes', 'no']],
      effect: ['Does this application send an actual credit or customer message?', ['yes', 'no']],
    },
    expected: {
      refusal: 'no',
      payload: 'account-and-proposal',
      disposition: 'no',
      unexpected: 'throw',
      identity: 'yes',
      effect: 'no',
    },
    editable: [
      'flows/check-credit/method.ts',
      'flows/check-credit/FLOW.contract.json',
      'flows/resolve/resolve.ts',
    ],
  },
  {
    id: 'contact-import',
    briefs: ['contact-behavior.md'],
    task: 'Change the import coordinator: when conversion returns status needs_mapping, return blocked with output {reason: preview.reason}, show the blocked phase/reason, and do not invoke the exporter. Preserve ready preview export even when some rows are rejected, mapper blocked/limit passthrough, and immutable artifact forwarding for ready previews. Do not change mapper or converter behavior.',
    questions: {
      mapper: ['Which mapper is selected in the current project?', ['code', 'mixed', 'agent']],
      null: [
        'How does the code mapper return unrecognized headings?',
        ['done-null-mapping', 'blocked'],
      ],
      export: ['Does needs_mapping currently reach export BEFORE this change?', ['yes', 'no']],
      rows: ['Do rejected rows alone stop ready-preview export?', ['yes', 'no']],
      artifact: ['Does the coordinator require an immutable files artifact?', ['yes', 'no']],
      database: ['Does this preview application write contacts to a database?', ['yes', 'no']],
    },
    expected: {
      mapper: 'code',
      null: 'done-null-mapping',
      export: 'yes',
      rows: 'no',
      artifact: 'yes',
      database: 'no',
    },
    editable: ['flows/import/method.ts'],
  },
]

/** Read only public example source. Do not follow links or copy dependency trees. */
export async function sourceInventory(root) {
  const files = {}
  let entries = 0,
    sourceBytes = 0
  const walk = async (relative = '') => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (++entries > 2048) throw Error('Public source tree exceeds study bound')
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (['node_modules', '.git', '.jig', '.tmp', 'contracts', 'fixtures'].includes(entry.name))
        continue
      const info = await lstat(path.join(root, name))
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walk(name)
      else if (info.isFile() && /\.(ts|json)$/.test(name) && !name.includes('.test.')) {
        if (info.size > 65536) throw Error('Public source member exceeds study bound')
        if (Object.keys(files).length >= 256)
          throw Error('Public source inventory exceeds study bound')
        const handle = await open(
          path.join(root, name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        )
        try {
          const retained = await handle.stat()
          if (!retained.isFile() || retained.size > 65536)
            throw Error('Public source member exceeds study bound')
          const bytes = Buffer.alloc(65537)
          let used = 0
          while (used < bytes.length) {
            const value = await handle.read(bytes, used, bytes.length - used, null)
            if (!value.bytesRead) break
            used += value.bytesRead
          }
          sourceBytes += used
          if (used > 65536 || sourceBytes > 262144)
            throw Error('Public source bytes exceed study bound')
          const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            bytes.subarray(0, used),
          )
          files[name] = { source, sha256: sha256(source) }
        } finally {
          await handle.close()
        }
      }
    }
  }
  await walk()
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

export function readSources(packet, names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 8)
    throw Error('Read 1-8 exact source paths')
  return names.map((name) => {
    if (typeof name !== 'string' || !Object.hasOwn(packet.files, name))
      throw Error('Source path unavailable')
    return { file: name, sha256: packet.files[name].sha256, source: packet.files[name].source }
  })
}

/** Proposed edits stay inert. This function performs no imports, evaluation, or execution. */
export function applyProposedEdits(packet, answer, read) {
  if (
    !answer ||
    typeof answer !== 'object' ||
    Array.isArray(answer) ||
    !Array.isArray(answer.edits)
  )
    throw Error('Invalid response shape')
  if (answer.edits.length < 1 || answer.edits.length > 8) throw Error('Expected 1-8 edits')
  const result = {}
  for (const edit of answer.edits) {
    if (!edit || !packet.editable.includes(edit.file) || !read.has(edit.file))
      throw Error('Edit requires an allowed, previously read source file')
    if (
      typeof edit.old !== 'string' ||
      !edit.old ||
      typeof edit.new !== 'string' ||
      Buffer.byteLength(edit.new) > 24576
    )
      throw Error('Invalid edit text')
    const original = result[edit.file] ?? packet.files[edit.file].source
    if (original.split(edit.old).length !== 2) throw Error('Edit context must occur exactly once')
    result[edit.file] = original.replace(edit.old, () => edit.new)
    if (Buffer.byteLength(result[edit.file]) > 65536)
      throw Error('Changed file exceeds study bound')
  }
  return result
}

export function scoreBehavior(packet, answer) {
  return Object.fromEntries(
    Object.entries(packet.expected).map(([key, value]) => [key, answer?.answers?.[key] === value]),
  )
}

export function validateCurrentAnswers(packet, answer) {
  if (
    !answer ||
    typeof answer !== 'object' ||
    Array.isArray(answer) ||
    Object.keys(answer).sort().join(',') !== Object.keys(packet.questions).sort().join(',')
  )
    throw Error('Current behavior requires exactly the question fields')
  for (const [key, [, values]] of Object.entries(packet.questions))
    if (typeof answer[key] !== 'string' || ![...values, 'unknown'].includes(answer[key]))
      throw Error('Current behavior requires the declared vocabulary or unknown')
  return Object.freeze({ ...answer })
}

export async function loadStudy(destination) {
  const packets = JSON.parse(await readFile(path.join(destination, 'packets.json'), 'utf8'))
  const basis = JSON.parse(await readFile(path.join(directory, 'behavior-basis.json'), 'utf8'))
  for (const packet of packets)
    for (const [name, member] of Object.entries(packet.files)) {
      if (sha256(member.source) !== member.sha256) throw Error(`Corrupt source packet: ${name}`)
    }
  for (const packet of packets) {
    if (
      !Object.hasOwn(basis, packet.id) ||
      JSON.stringify(
        Object.fromEntries(
          Object.entries(packet.files).map(([name, member]) => [name, member.sha256]),
        ),
      ) !== JSON.stringify(basis[packet.id])
    )
      throw Error('Study source must match the audited public example basis')
  }
  return packets
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2]
  if (!destination || process.argv.length !== 3)
    throw Error('Usage: node behavior-study.mjs NEW_DIRECTORY')
  await mkdir(destination, { recursive: false })
  const basis = JSON.parse(await readFile(path.join(directory, 'behavior-basis.json'), 'utf8'))
  const packets = []
  for (const study of studies) {
    const files = await sourceInventory(path.join(repository, 'examples', study.id))
    if (
      JSON.stringify(
        Object.fromEntries(Object.entries(files).map(([name, value]) => [name, value.sha256])),
      ) !== JSON.stringify(basis[study.id])
    )
      throw Error('Stale behavioral interpretation: audit source before refreshing the basis')
    const briefs = await Promise.all(
      study.briefs.map((name) => readFile(path.join(directory, name), 'utf8')),
    )
    const inspect = spawnSync(
      path.join(repository, 'packages/jig/bin/jig'),
      ['inspect', '--flow'],
      {
        cwd: path.join(repository, 'examples', study.id),
        env: process.env,
        encoding: 'utf8',
        timeout: 90000,
        maxBuffer: 1048576,
      },
    )
    if (inspect.status !== 0)
      throw Error(`Public inspection failed for ${study.id}: ${inspect.stderr}`)
    packets.push({
      ...study,
      files,
      inspection: inspect.stdout,
      brief: briefs.join('\n\n'),
      basis: 'maintainer-interpreted public source; no admission or observations',
    })
  }
  await writeFile(path.join(destination, 'packets.json'), JSON.stringify(packets, null, 2) + '\n', {
    flag: 'wx',
  })
  console.log('Frozen three public source packets. No provider was contacted.')
}
