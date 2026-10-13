import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Ordinary project source reused by source-host and installed consumer gates. */
export async function writeMappedFilesProject(input: {
  readonly root: string
  readonly jigVersion: string
  readonly flowVersion: string
}): Promise<void> {
  const put = async (path: string, value: string | object | Uint8Array) => {
    const target = join(input.root, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(
      target,
      typeof value === 'string' || value instanceof Uint8Array
        ? value
        : `${JSON.stringify(value, null, 2)}\n`,
    )
  }
  const route = (target: string, directory: string) => ({
    target,
    attachments: { source: { from: 'source' }, files: { into: 'files', directory } },
  })
  await put('package.json', {
    name: 'ordinary-mapped-files-consumer',
    private: true,
    type: 'module',
    workspaces: ['flows/*'],
    dependencies: { '@jigging/jig': input.jigVersion },
  })
  await put(
    'jig.ts',
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings')})
`,
  )
  await put(
    'bindings/root.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding(${JSON.stringify({
      package: 'flows/root',
      slots: {
        first: route('flow:flows/copy', 'first'),
        second: route('flow:flows/copy', 'second'),
        nested: route('binding:nested', 'nested'),
      },
    })})
`,
  )
  await put(
    'bindings/nested.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding(${JSON.stringify({ package: 'flows/nested', slots: { inner: route('flow:flows/copy', 'inner') } })})
`,
  )
  const output = {
    type: 'object',
    properties: {
      outcome: { type: 'string', enum: ['done'] },
      output: {
        type: 'object',
        properties: { count: { type: 'integer', minimum: 2, maximum: 2 } },
        required: ['count'],
        additionalProperties: false,
      },
    },
    required: ['outcome', 'output'],
    additionalProperties: false,
  }
  for (const [name, slots] of [
    ['copy', []],
    ['nested', ['inner']],
    ['root', ['first', 'second', 'nested']],
  ] as const) {
    await put(`flows/${name}/package.json`, {
      name: `mapped-files-${name}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': input.flowVersion },
    })
    await put(`flows/${name}/FLOW.meta.json`, {
      name: `mapped-files-${name}`,
      description: 'Copy finite immutable input through ordinary file Flow composition.',
      uses: Object.fromEntries(slots.map((slot) => [slot, {}])),
    })
    await put(`flows/${name}/FLOW.contract.json`, {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      attachments: { source: 'read', files: 'read-write' },
      input: { type: 'null' },
      result: output,
    })
  }
  await put(
    'flows/copy/FLOW.ts',
    `import {handle} from '@jigging/flow'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
await handle(async run=>{
  if(run.input!==null) throw new TypeError('Supply null input.')
  const source=run.attachments.source.path, files=run.attachments.files.path
  let denied=false
  try {await writeFile(source+'/must-not-write','forbidden',{flag:'wx'})} catch {denied=true}
  if(!denied) throw new Error('Source attachment was writable.')
  const binary=await readFile(source+'/data.bin'), empty=await readFile(source+'/empty.bin')
  if(binary.length!==3||binary[0]!==0||binary[1]!==128||binary[2]!==255||empty.length!==0)
    throw new Error('Unexpected immutable source bytes.')
  await writeFile(files+'/data.bin',binary,{flag:'wx'})
  await writeFile(files+'/empty.bin',empty,{flag:'wx'})
  await mkdir(files+'/empty-directory')
  return {outcome:'done',output:{count:2}}
})
`,
  )
  await put(
    'flows/nested/FLOW.ts',
    `import {handle} from '@jigging/flow'
import {readFile,stat} from 'node:fs/promises'
await handle(async run=>{
  const result=await run.call({operationId:'inner-copy',slot:'inner',input:null})
  if(result.outcome!=='done'||result.output?.count!==2) throw new Error('Invalid complete child result.')
  const bytes=await readFile(run.attachments.files.path+'/inner/data.bin')
  if(bytes.length!==3||bytes[2]!==255) throw new Error('Nested import was not visible after await.')
  if(!(await stat(run.attachments.files.path+'/inner/empty-directory')).isDirectory())
    throw new Error('Empty child directory was lost during import.')
  return {outcome:'done',output:{count:2}}
})
`,
  )
  await put(
    'flows/root/FLOW.ts',
    `import {handle} from '@jigging/flow'
import {readFile,stat} from 'node:fs/promises'
await handle(async run=>{
  const results=await Promise.all([
    run.call({operationId:'first-copy',slot:'first',input:null}),
    run.call({operationId:'second-copy',slot:'second',input:null}),
  ])
  for(const result of results)
    if(result.outcome!=='done'||result.output?.count!==2) throw new Error('Invalid complete sibling result.')
  const nested=await run.call({operationId:'nested-copy',slot:'nested',input:null})
  if(nested.outcome!=='done'||nested.output?.count!==2) throw new Error('Invalid nested result.')
  for(const directory of ['first','second','nested/inner']){
    const bytes=await readFile(run.attachments.files.path+'/'+directory+'/data.bin')
    if(bytes.length!==3||bytes[0]!==0||bytes[1]!==128||bytes[2]!==255)
      throw new Error('Committed child bytes unavailable to the live caller.')
    if(!(await stat(run.attachments.files.path+'/'+directory+'/empty-directory')).isDirectory())
      throw new Error('Empty child directory unavailable to the live caller.')
  }
  return {outcome:'done',output:{count:2}}
})
`,
  )
  await put('source/data.bin', Uint8Array.from([0, 128, 255]))
  await put('source/empty.bin', new Uint8Array())
}

/** Verify actual delivered bytes and original preservation, without host internals. */
export async function assertMappedFilesPacket(
  packet: string,
  source: string,
  composed = true,
): Promise<void> {
  for (const directory of composed ? ['first', 'second', 'nested/inner'] : ['']) {
    assert.deepEqual(
      await readFile(join(packet, 'files', directory, 'data.bin')),
      Buffer.from([0, 128, 255]),
    )
    assert.equal((await readFile(join(packet, 'files', directory, 'empty.bin'))).length, 0)
  }
  assert.deepEqual(await readFile(join(source, 'data.bin')), Buffer.from([0, 128, 255]))
  assert.equal((await readFile(join(source, 'empty.bin'))).length, 0)
  const record = JSON.parse(await readFile(join(packet, 'result.json'), 'utf8'))
  assert.equal(record.status, 'succeeded')
  assert.equal(record.outcome, 'done')
}
