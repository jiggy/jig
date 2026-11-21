import { expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type Command = (argv: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>

export async function checkInstalledBindingSplit(
  cli: string,
  project: string,
  command: Command,
  flowVersion: string,
  membership: 'discovered' | 'exact',
) {
  const put = async (path: string, source: string | object) => {
    await mkdir(dirname(join(project, path)), { recursive: true })
    await writeFile(
      join(project, path),
      typeof source === 'string' ? source : JSON.stringify(source),
    )
  }
  const inspect = (...args: string[]) => command([cli, 'inspect', '--flow', ...args], project)
  const binding = (body: string) =>
    `import { defineBinding } from '@jigging/jig'\nexport default defineBinding({ ${body} })\n`
  const flow = async (name: string, body: string, attachment: string, slots?: string[]) => {
    await put(`flows/${name}/package.json`, {
      name: 'publisher-' + name,
      type: 'module',
      private: true,
      dependencies: { '@jigging/flow': flowVersion },
    })
    await put(`flows/${name}/FLOW.meta.json`, {
      name,
      description: 'Publishing fixture.',
      ...(slots ? { uses: Object.fromEntries(slots.map((slot) => [slot, {}])) } : {}),
    })
    await put(`flows/${name}/FLOW.contract.json`, {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      attachments: { [attachment]: 'read' },
    })
    await put(
      `flows/${name}/FLOW.ts`,
      `import { handle } from '@jigging/flow'
import { readFile } from 'node:fs/promises'
await handle(async (run) => { ${body} })
`,
    )
  }
  const explicitConfig = `import { defineJig, discover } from '@jigging/jig'
export default defineJig({
  flows: discover('flows'),
  bindings: [
    'specialists/specialist.ts',
    './wiring/offer.ts',
    './wiring/fresh-book.ts',
    './wiring/resumed-book.ts',
    './specialists/offer-editor.ts',
    './specialists/sample.ts' // Shared by the offer and both book routes.
  ],
})
`.replaceAll('\n', '\r\n')
  const config =
    membership === 'exact'
      ? explicitConfig
      : `import { defineJig, discover } from '@jigging/jig'
export default defineJig({ flows: discover('flows'), bindings: discover(['wiring', 'specialists']) })
`
  const enrolledConfig =
    membership === 'exact'
      ? config.replace(
          "'./specialists/sample.ts' // Shared by the offer and both book routes.\r\n",
          "'./specialists/sample.ts', // Shared by the offer and both book routes.\r\n    './specialists/offer-sample.ts'\r\n",
        )
      : config
  await put('jig.ts', config)
  await put('fixtures/manuscript/title.txt', 'Manuscript')
  for (const reviewer of ['specialist', 'offer-editor']) {
    await flow(
      reviewer,
      `return { outcome: 'done', output: {
        reviewer: '${reviewer}',
        title: await readFile(run.attachments.chapter.path + '/title.txt', 'utf8'),
        edition: run.input.edition,
      } }`,
      'chapter',
    )
    await put(`specialists/${reviewer}.ts`, binding(`package: 'flows/${reviewer}'`))
  }
  await flow('cover', "return { outcome: 'done', output: {} }", 'chapter')
  await flow(
    'sample',
    `await run.call({ slot: 'cover', operationId: 'cover', input: {} })
return await run.call({ slot: 'review', operationId: 'post-edit', input: run.settings })`,
    'draft',
    ['review', 'cover'],
  )
  await put('flows/sample/settings.schema.json', {
    $schema: 'https://flow.jig.md/schemas/schema-0.json',
    type: 'object',
    properties: { edition: { type: 'string' } },
    required: ['edition'],
    additionalProperties: false,
  })
  const shared = binding(`
    // Keep this project-local configuration for all editions.
    package: './flows/sample',
    settings: { edition: 'proof' },
    slots: {
      review: { target: 'binding:specialist', attachments: { chapter: { from: 'draft' } } },
      cover: { target: 'flow:flows/cover', attachments: { chapter: { from: 'draft' } } },
    },
  `)
  for (const route of ['offer', 'fresh-book', 'resumed-book']) {
    await flow(
      route,
      "return await run.call({ slot: 'sample', operationId: 'request-sample', input: {} })",
      'manuscript',
      ['sample'],
    )
    await put(
      `wiring/${route}.ts`,
      binding(`
        package: 'flows/${route}',
        slots: { sample: { target: 'binding:sample', attachments: { draft: { from: 'manuscript' } } } },
      `),
    )
  }
  await put('specialists/sample.ts', shared)
  const inactive = 'specialists/unselected.ts'
  const inactiveBytes = binding("package: 'flows/not-installed'")
  if (membership === 'exact') await put(inactive, inactiveBytes)
  const offerPath = join(project, 'wiring/offer.ts')
  const originalOffer = await readFile(offerPath, 'utf8')
  const originalFresh = await readFile(join(project, 'wiring/fresh-book.ts'), 'utf8')
  const originalResumed = await readFile(join(project, 'wiring/resumed-book.ts'), 'utf8')
  const newPath = join(project, 'specialists/offer-sample.ts')
  const specialized = shared.replace('binding:specialist', 'binding:offer-editor')
  const split = (select: string, name = 'offer-sample') =>
    command(
      [cli, 'split-binding', 'binding:offer', '--slot', 'sample', '--as', name, '--select', select],
      project,
    )
  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  const lockPath = join(project, 'jig.lock')
  const originalLock = await readFile(lockPath, 'utf8')
  const approved = await inspect('--approved', '--topology', '--all', '--json')
  const assertOriginal = async () => {
    expect(await readFile(offerPath, 'utf8')).toBe(originalOffer)
    expect(await readFile(join(project, 'specialists/sample.ts'), 'utf8')).toBe(shared)
    expect(await readFile(lockPath, 'utf8')).toBe(originalLock)
    expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(config)
    expect(existsSync(newPath)).toBe(false)
    expect(existsSync(join(project, '.jig-split-binding-stage'))).toBe(false)
  }
  await expect(split('review=binding:missing')).rejects.toThrow('JIG_BINDING_SPLIT_REFUSED')
  await assertOriginal()
  await expect(split('review=binding:offer-editor', 'fresh-book')).rejects.toThrow(
    'JIG_BINDING_SPLIT_EXISTS',
  )
  await assertOriginal()
  // Keep the unsupported declaration valid in ordinary evaluation.
  await put(
    'wiring/offer.ts',
    "const selected = 'binding:sample'\n" + originalOffer.replace("'binding:sample'", 'selected'),
  )
  await expect(split('review=binding:offer-editor')).rejects.toThrow('JIG_BINDING_SPLIT_SHAPE')
  await put('wiring/offer.ts', originalOffer)
  await assertOriginal()

  if (membership === 'exact') {
    const computed = config
      .replace('export default', "const members = ['./wiring/offer.ts']\r\nexport default")
      .replace("'./wiring/offer.ts',", '...members,')
    await put('jig.ts', computed)
    await expect(split('review=binding:offer-editor')).rejects.toThrow('JIG_BINDING_SPLIT_SHAPE')
    expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(computed)
    await put('jig.ts', config)
    await assertOriginal()

    // An unselected declaration can occupy the destination. No edit may replace it.
    await put('specialists/offer-sample.ts', inactiveBytes)
    await expect(split('review=binding:offer-editor')).rejects.toThrow('JIG_BINDING_SPLIT_EXISTS')
    expect(await readFile(newPath, 'utf8')).toBe(inactiveBytes)

    // Inspect the two states that can remain after an interrupted publication.
    const topology = async () => JSON.parse((await inspect('--topology', '--all', '--json')).stdout)
    const baseline = await topology()
    expect(
      baseline.targets.some((entry: { target: string }) => entry.target === 'binding:offer-sample'),
    ).toBe(false)
    await put('specialists/offer-sample.ts', specialized)
    expect(await topology()).toEqual(baseline)
    await put('jig.ts', enrolledConfig)
    const expanded = await topology()
    const newTarget = expanded.targets.find(
      (entry: { target: string }) => entry.target === 'binding:offer-sample',
    )
    expect(newTarget.flow.routes).toContainEqual({ slot: 'review', target: 'binding:offer-editor' })
    const offer = (graph: typeof baseline) =>
      graph.targets.find((entry: { target: string }) => entry.target === 'binding:offer')
    expect(offer(expanded).flow.routes).toEqual(offer(baseline).flow.routes)
    await put('jig.ts', config)
    await unlink(newPath)
    await assertOriginal()
  }

  const callerDirectory = join(project, 'wiring')
  const callerMode = (await stat(callerDirectory)).mode & 0o777
  await chmod(callerDirectory, callerMode & ~0o222)
  try {
    await expect(split('review=binding:offer-editor')).rejects.toThrow('JIG_BINDING_SPLIT_IO')
    await assertOriginal()
    expect((await inspect('--approved', '--topology', '--all', '--json')).stdout).toBe(
      approved.stdout,
    )
  } finally {
    await chmod(callerDirectory, callerMode)
  }

  const edit = await split('review=binding:offer-editor')
  expect(edit.stdout).toContain('binding:sample → binding:offer-sample')
  expect(edit.stdout).toContain('specialists/offer-sample.ts')
  if (membership === 'exact') expect(edit.stdout).toContain('to bindings in "jig.ts"')
  expect(await readFile(offerPath, 'utf8')).toBe(
    originalOffer.replace('binding:sample', 'binding:offer-sample'),
  )
  expect(await readFile(newPath, 'utf8')).toBe(specialized)
  expect(await readFile(join(project, 'specialists/sample.ts'), 'utf8')).toBe(shared)
  expect(await readFile(join(project, 'wiring/fresh-book.ts'), 'utf8')).toBe(originalFresh)
  expect(await readFile(join(project, 'wiring/resumed-book.ts'), 'utf8')).toBe(originalResumed)
  expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(enrolledConfig)
  expect(await readFile(lockPath, 'utf8')).toBe(originalLock)
  expect((await inspect('--approved', '--topology', '--all', '--json')).stdout).toBe(
    approved.stdout,
  )
  await expect(split('review=binding:offer-editor')).rejects.toThrow('JIG_BINDING_SPLIT_EXISTS')
  expect(await readFile(newPath, 'utf8')).toBe(specialized)
  expect((await readdir(project)).sort()).toEqual([
    '.jig',
    'fixtures',
    'flows',
    'jig.lock',
    'jig.ts',
    'specialists',
    'wiring',
  ])

  const current = JSON.parse((await inspect('--topology', '--all', '--json')).stdout)
  const target = (id: string) =>
    current.targets.find((entry: { target: string }) => entry.target === 'binding:' + id)
  expect(target('offer').flow.routes).toContainEqual({
    slot: 'sample',
    target: 'binding:offer-sample',
  })
  expect(target('fresh-book').flow.routes).toContainEqual({
    slot: 'sample',
    target: 'binding:sample',
  })
  expect(target('resumed-book').flow.routes).toContainEqual({
    slot: 'sample',
    target: 'binding:sample',
  })
  expect(target('sample').flow.routes).toContainEqual({
    slot: 'review',
    target: 'binding:specialist',
  })
  expect(target('offer-sample').flow.routes).toContainEqual({
    slot: 'review',
    target: 'binding:offer-editor',
  })
  if (membership === 'exact') {
    expect(target('unselected')).toBeUndefined()
    expect(await readFile(join(project, inactive), 'utf8')).toBe(inactiveBytes)
  }

  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  for (const [name, port, reviewer] of [
    ['offer', 'manuscript', 'offer-editor'],
    ['fresh-book', 'manuscript', 'specialist'],
    ['resumed-book', 'manuscript', 'specialist'],
    ['sample', 'draft', 'specialist'],
  ]) {
    const result = await command(
      [
        cli,
        'run',
        'binding:' + name,
        '--json',
        '--timeout',
        '2m',
        '--input',
        '{}',
        '--attach',
        port + '=fixtures/manuscript',
      ],
      project,
    )
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'succeeded',
      output: { reviewer, edition: 'proof', title: 'Manuscript' },
    })
  }
}
