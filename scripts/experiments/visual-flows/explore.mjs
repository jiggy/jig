#!/usr/bin/env node
/** Standalone research command. This is not a Jig CLI command or runtime API. */
import { constants } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectGraph } from './lock-graph.mjs'
import { extractSourceGraph } from './source-graph.mjs'
import { renderExplorer } from './viewer.mjs'

const EXAMPLES = [
  ['support-case', 'Support case', 'Interpret a disputed charge, then check the supplied facts against credit policy.'],
  ['contact-import', 'Contact import', 'Inspect the configured import pipeline and its replaceable mapping methods.'],
  ['kitchen-roster', 'Kitchen roster', 'Inspect the methods for reading, proposing, checking, and exporting a roster.'],
  ['photo-organiser', 'Photo organiser', 'Inspect the configured methods for grouping images and producing photo artifacts.'],
  ['software-factory', 'Software factory', 'Inspect the candidate methods, explicit routes, and unresolved checkpoint requirement.'],
  ['tested-patch', 'Tested patch', 'Inspect the configured specialists and the resource boundaries used to prepare a patch.'],
]

const USAGE = `Usage:
  node explore.mjs --lock JIG_LOCK [--root SELECTOR] --output FILE
  node explore.mjs --project DIRECTORY [--root SELECTOR] --output FILE
  node explore.mjs --examples DIRECTORY [--sley PROBE_JSON] --output FILE

Options:
  --format html|json  Output format; defaults to html.
  --revision SHA     Optional source revision label for example source snapshots.

Input is read locally. Output must be a new file. No project code is executed.
Source mode understands literal declarations only. Lock mode does not verify admission.
`

export function parseArguments(argv) {
  const options = { format: 'html' }
  const valid = new Set(['lock', 'project', 'examples', 'sley', 'root', 'output', 'format', 'revision'])
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].startsWith('--') ? argv[index].slice(2) : ''
    if (!valid.has(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Supply a recognized option and its value. Use --help for usage.')
    }
    if (Object.hasOwn(options, key) && key !== 'format') throw new Error('Do not repeat options.')
    options[key] = argv[++index]
  }
  if (['lock', 'project', 'examples'].filter(key => options[key]).length !== 1 || !options.output) {
    throw new Error('Choose one input mode and an output file. Use --help for usage.')
  }
  if (!['html', 'json'].includes(options.format)) throw new Error('Format must be html or json.')
  if (options.sley && !options.examples) throw new Error('The Sley dataset accompanies --examples only.')
  if (options.root && options.examples) throw new Error('Select a root with --lock or --project.')
  if (options.revision && !/^[0-9a-f]{40}$/.test(options.revision)) throw new Error('Revision must be a complete Git commit SHA.')
  return options
}

async function readJson(path) {
  const maximum = 8 * 1024 * 1024
  // Nonblocking open lets POSIX reject a FIFO without waiting for a writer.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > maximum) throw new Error('JSON input must be a regular file at most 8 MiB.')
    const buffer = Buffer.alloc(maximum + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size)
      if (bytesRead === 0) break
      size += bytesRead
    }
    if (size > maximum) throw new Error('JSON input must be a regular file at most 8 MiB.')
    return JSON.parse(buffer.toString('utf8', 0, size))
  } finally { await handle.close() }
}

export async function buildExamples(directory, { sley, revision } = {}) {
  const graphs = []
  for (const [id, title, summary] of EXAMPLES) {
    const graph = await extractSourceGraph(resolve(directory, id))
    graphs.push({ id, title, summary, subtitle: 'Authored composition', ...(revision ? { revision } : {}), graph })
  }
  if (sley) {
    const graph = await readJson(sley)
    graphs.push({
      id: 'sley-review-loop', title: 'A loop you can inspect',
      subtitle: 'Runtime topology + 3 actual runs',
      summary: 'Sley reports a declared graph with a revision loop and scope exits. Select a recorded probe run to see actual handler entries.',
      graph,
    })
  }
  return graphs
}

export async function run(options) {
  let graphs
  if (options.lock) {
    const lock = await readJson(resolve(options.lock))
    graphs = [{
      id: 'configured-composition', title: options.root || 'Configured composition',
      subtitle: 'Desired-state lock',
      summary: 'Each arrow is a configured call through a slot. The viewer does not verify local approval or execution order.',
      graph: projectGraph(lock, { root: options.root }),
    }]
  } else if (options.project) {
    graphs = [{
      id: basename(resolve(options.project)), title: basename(resolve(options.project)),
      subtitle: 'Authored composition',
      summary: 'Connections come from literal source declarations. Unknown targets and unsupported syntax remain explicit.',
      ...(options.revision ? { revision: options.revision } : {}),
      graph: await extractSourceGraph(resolve(options.project), { root: options.root }),
    }]
  } else graphs = await buildExamples(resolve(options.examples), options)
  const output = resolve(options.output)
  const content = options.format === 'json' ? JSON.stringify(graphs, null, 2) + '\n' : renderExplorer({ graphs })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, content, { flag: 'wx' })
  return {
    output,
    graphs: graphs.map(({ id, graph }) => ({ id, nodes: graph.nodes.length, edges: graph.edges.length, warnings: graph.warnings.length })),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).includes('--help')) process.stdout.write(USAGE)
  else {
    try {
      console.log(JSON.stringify(await run(parseArguments(process.argv.slice(2))), null, 2))
    } catch (error) {
      // Refuse without copying source content, lock payloads, or filesystem paths into errors.
      const message = error?.code === 'EEXIST' ? 'Output already exists. Choose a new file.'
        : error?.code === 'ENOENT' ? 'An input file or directory is unavailable.'
        : error instanceof SyntaxError ? 'JSON input could not be parsed.'
        : error?.code ? `The experiment refused the input (${error.code}).`
        : error.message
      console.error(message)
      process.exitCode = 1
    }
  }
}
