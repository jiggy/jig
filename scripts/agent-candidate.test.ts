import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
test('Agent candidate refuses malformed requests and missing tools before creating output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-candidate-refusal-'))
  try {
    for (const args of [
      [],
      ['unknown', join(directory, 'candidate')],
      ['agent-acp', join(directory, 'candidate')],
    ]) {
      const child = Bun.spawn(
        [process.execPath, join(root, 'scripts/build-agent-candidate.ts'), ...args],
        {
          env: { PATH: process.env.PATH!, FLOW_NODE: '', FLOW_NPM: '' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const stderr = new Response(child.stderr).text()
      expect(await child.exited).not.toBe(0)
      expect(await stderr).toContain(args[0] === 'agent-acp' ? 'FLOW_NODE' : 'usage:')
      expect(await readdir(directory)).toEqual([])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('ordinary Agent publishing uses exact candidates and retains separate authority gates', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/npm-publish.yml')).text(),
  ) as any
  const { build, publish, authorize, tag } = workflow.jobs
  expect(build.strategy.matrix.package).toEqual(['flow', 'agent', 'acp', 'jig'])
  expect(build.permissions).toEqual({ contents: 'read' })
  expect(publish.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
  expect(publish.needs).toEqual(['authorize', 'build'])
  expect(authorize.name).toContain('same-revision')
  expect(publish.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBeFalse()
  const script = publish.steps.find((step: any) => step.id === 'release').run
  const calls = script.split('\n').filter((line: string) => /^publish_candidate /.test(line))
  expect(calls).toEqual([
    'publish_candidate flow @jigging/flow',
    'publish_candidate agent @jigging/agent-method',
    'publish_candidate acp @jigging/agent-acp',
    'publish_candidate jig @jigging/jig',
  ])
  expect(script).toContain('registry bytes differ')
  expect(script).toContain('success.commit !== process.env.SOURCE_REVISION')
  expect(tag.permissions).toEqual({ contents: 'write' })
  for (const kind of ['agent', 'acp']) {
    expect(publish.outputs[`${kind}_version`]).toBeDefined()
    expect(publish.outputs[`${kind}_new`]).toBeDefined()
  }
})
