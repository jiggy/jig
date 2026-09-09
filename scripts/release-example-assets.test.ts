import { expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workflow = Bun.YAML.parse(
  await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8'),
) as { jobs: { tag: { steps: { name?: string; run?: string }[] } } }
const script = workflow.jobs.tag.steps.find(
  (step) => step.name === 'Attach the retained applications to their matching Jig release',
)?.run
if (!script) throw new Error('Missing application-asset release step')

for (const scenario of ['new', 'retry', 'different', 'lost-upload', 'older-lightweight'] as const) {
  test(`prepared release assets: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-release-assets-'))
    try {
      const tools = join(root, 'tools'),
        candidates = join(root, 'flow-candidate/examples')
      const remote = join(root, 'remote')
      await mkdir(tools)
      await mkdir(candidates, { recursive: true })
      await mkdir(remote)
      const names = ['tested-patch.tar.gz', 'live-agent.tar.gz', 'examples.json'] as const
      for (const name of names) {
        await writeFile(join(candidates, name), `retained bytes: ${name}`)
        if (scenario === 'retry' || scenario === 'different')
          await copyFile(join(candidates, name), join(remote, name))
      }
      if (scenario === 'different') await writeFile(join(remote, names[0]), 'other bytes')
      await writeFile(
        join(tools, 'gh'),
        `#!${process.execPath}
import { appendFile, copyFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
const root = process.env.RUNNER_TEMP, scenario = process.env.ASSET_SCENARIO;
const args = process.argv.slice(2);
await appendFile(join(root, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  if (args[1].includes('/git/ref/')) console.log(args.at(-1) === '.object.type'
    ? (scenario === 'older-lightweight' ? 'commit' : 'tag')
    : (scenario === 'older-lightweight' ? 'older-revision' : 'tag-object'));
  else if (args[1].includes('/git/tags/')) console.log('source-revision');
  else process.exit(70);
} else if (args[0] === 'release' && args[1] === 'view') {
  for (const name of await readdir(join(root, 'remote'))) console.log(name);
} else if (args[0] === 'release' && args[1] === 'download') {
  const name = args[args.indexOf('--pattern') + 1], output = args[args.indexOf('--dir') + 1];
  await copyFile(join(root, 'remote', name), join(output, name));
} else if (args[0] === 'release' && args[1] === 'upload') {
  await copyFile(args[3], join(root, 'remote', basename(args[3])));
  if (scenario === 'lost-upload') process.exit(71);
} else process.exit(70);
`,
        { mode: 0o755 },
      )
      const child = Bun.spawn(['/bin/sh', '-c', script], {
        env: {
          PATH: `${tools}:${process.env.PATH}`,
          RUNNER_TEMP: root,
          GITHUB_REPOSITORY: 'fixture/repository',
          SOURCE_REVISION: 'source-revision',
          JIG_VERSION: '0.1.0-alpha.16',
          GH_TOKEN: 'fixture-only',
          ASSET_SCENARIO: scenario,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      const calls = (await readFile(join(root, 'calls'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
      const uploads = calls.filter((call) => call[1] === 'upload')
      if (scenario === 'different' || scenario === 'lost-upload') {
        expect(code).not.toBe(0)
        expect(uploads).toHaveLength(scenario === 'different' ? 0 : 1)
      } else {
        expect(code, stderr).toBe(0)
        expect(uploads).toHaveLength(scenario === 'new' ? 3 : 0)
      }
      if (scenario === 'older-lightweight') {
        expect(stdout).toContain('No Jig release from this revision')
        expect(calls.some((call) => call[0] === 'release')).toBe(false)
      }
      expect(calls.some((call) => call.includes('--clobber'))).toBe(false)
      if (scenario === 'new' || scenario === 'retry')
        for (const name of names)
          expect(await readFile(join(remote, name), 'utf8')).toBe(`retained bytes: ${name}`)
      if (scenario === 'different')
        expect(await readFile(join(remote, names[0]), 'utf8')).toBe('other bytes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
