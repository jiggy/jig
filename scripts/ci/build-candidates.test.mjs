import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import {
  buildCandidates,
  CANDIDATE_PACKAGES,
  candidateTools,
  execute,
  inspectArchive,
  QUALIFIED_BUN,
} from './build-candidates.mjs'
import { verifyCandidateBundle } from './candidate-provenance.mjs'
import { qualifyCandidate, rejectInstalledAgent } from './qualify-candidate.mjs'

process.env.LC_ALL = 'C'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-candidate-orchestration-')))
  const repository = join(root, 'repository')
  const bin = join(root, 'bin')
  await mkdir(repository)
  await mkdir(bin)
  for (const name of ['bun', 'npm', 'just']) {
    await writeFile(join(bin, name), '#!/bin/sh\nexit 1\n')
    await chmod(join(bin, name), 0o755)
  }
  const env = {
    ...process.env,
    FLOW_NODE: process.execPath,
    FLOW_NPM: join(bin, 'npm'),
    JIG_CI_BUN: join(bin, 'bun'),
  }
  for (const [kind, name] of Object.entries(CANDIDATE_PACKAGES)) {
    const directory = join(repository, 'packages', kind)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name, version: '0.1.0-alpha.1', publishConfig: { access: 'public' } }),
    )
  }
  execute('git', ['init', '--quiet', repository])
  execute('git', ['add', '.'], { cwd: repository })
  execute(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'source',
    ],
    { cwd: repository },
  )
  const calls = []
  const run = (command, args, options = {}) => {
    calls.push({ command, args, options })
    if (command === 'which') return join(bin, args[0])
    if (command === process.execPath && args[0] === '-e') return '24.0.0'
    if (command === join(bin, 'npm') && args[0] === '--version') return '11.6.2'
    if (command === join(bin, 'just') && args[0] === '--version') return 'just 1.43.1'
    if (command === join(bin, 'just')) return ''
    if (command === join(bin, 'bun')) {
      if (args.includes('-e')) return JSON.stringify(QUALIFIED_BUN)
      if (args[0] === 'install') {
        writeFileSync(join(options.cwd, 'bun.lock'), 'actual resolved dependency closure\n')
        return ''
      }
      if (args[0] === 'pm' || args[0] === 'scripts/pack.ts') {
        const manifest = JSON.parse(execute('cat', [join(options.cwd, 'package.json')]))
        const destination = args[args.indexOf('--destination') + 1]
        const stage = join(destination, '.packed')
        mkdirSync(join(stage, 'package'), { recursive: true })
        writeFileSync(join(stage, 'package/package.json'), JSON.stringify(manifest))
        for (const path of ['FLOW.ts', 'FLOW.contract.json', 'src/flow.ts', 'dist/flow.js']) {
          mkdirSync(join(stage, 'package', path, '..'), { recursive: true })
          writeFileSync(join(stage, 'package', path), 'fixture')
        }
        execute('tar', [
          '-czf',
          join(
            destination,
            `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
          ),
          '-C',
          stage,
          'package',
        ])
        return ''
      }
      return ''
    }
    if (command === join(bin, 'npm')) return ''
    if (command === process.execPath && args[0] === '--input-type=module') return ''
    return execute(command, args, options)
  }
  return {
    root,
    repository,
    bin,
    env,
    run,
    calls,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('build-only producer freezes one workspace build, eight archives and actual resolution without qualification', async () => {
  const f = await fixture()
  try {
    const output = join(f.root, 'candidate')
    await buildCandidates(output, f)
    const receipt = await verifyCandidateBundle(output)
    assert.equal(receipt.packages.length, 8)
    assert.deepEqual(
      receipt.packages.map(({ kind }) => kind),
      [
        'flow-sdk',
        'user-updates',
        'agent-method',
        'agent-acp',
        'display-model',
        'display-web',
        'display-tui',
        'jig',
      ],
    )
    assert.equal(receipt.buildProfile.revision, QUALIFIED_BUN.revision)
    assert.equal(
      await readFile(join(output, 'resolution/bun.lock'), 'utf8'),
      'actual resolved dependency closure\n',
    )
    assert.equal(
      f.calls.filter((call) => basename(call.command) === 'just' && call.args.includes('build'))
        .length,
      1,
    )
    assert.equal(f.calls.filter((call) => call.args.includes('--destination')).length, 8)
    const install = f.calls.find((call) => call.args[0] === 'install')
    for (const name of Object.values(CANDIDATE_PACKAGES)) assert.ok(install.args.includes(name))
    assert.ok(
      !f.calls.some((call) => call.args.some((arg) => /package-smoke|baseline|^test$/.test(arg))),
    )
    for (const entry of receipt.packages) {
      const record = JSON.parse(await readFile(join(output, entry.kind, 'SUCCESS.json'), 'utf8'))
      assert.deepEqual(record.gates, [])
      assert.equal(record.qualification, 'pending')
      assert.equal(record.sha256, entry.sha256)
    }
    assert.equal(execute('git', ['status', '--porcelain'], { cwd: f.repository }), '')
    assert.equal((await readFile(join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 8)
  } finally {
    await f.cleanup()
  }
})

test('wrong Bun profile and dirty tracked input refuse before installation or output creation', async () => {
  const f = await fixture()
  try {
    const output = join(f.root, 'candidate')
    await assert.rejects(
      buildCandidates(output, {
        ...f,
        run: (command, args, options) =>
          args.includes('-e') && command === join(f.bin, 'bun')
            ? JSON.stringify({ ...QUALIFIED_BUN, platform: 'darwin' })
            : f.run(command, args, options),
      }),
      /native Linux/,
    )
    assert.ok(!existsSync(output))
    await writeFile(join(f.repository, 'packages/jig/package.json'), '{}')
    await assert.rejects(buildCandidates(output, f), /tracked working tree must be clean/)
    assert.ok(!f.calls.some((call) => call.args[0] === 'install'))
    assert.ok(!existsSync(output))
  } finally {
    await f.cleanup()
  }
})

test('build failure and preexisting broken symlink cannot publish or overwrite a candidate', async () => {
  const f = await fixture()
  try {
    const output = join(f.root, 'candidate')
    await assert.rejects(
      buildCandidates(output, {
        ...f,
        run: (command, args, options) => {
          if (args[0] === 'scripts/pack.ts') throw new Error('packing failed')
          return f.run(command, args, options)
        },
      }),
      /packing failed/,
    )
    assert.ok(!existsSync(output))
    assert.ok(!(await readdir(f.root)).some((path) => path.startsWith('.jig-ci-candidates-')))
    await symlink('missing-original', output)
    await assert.rejects(buildCandidates(output, f), /output already exists/)
    assert.ok((await lstat(output)).isSymbolicLink())
  } finally {
    await f.cleanup()
  }
})

test('archive inspection rejects wrong package identity and missing ordinary Agent entrypoints', async () => {
  const f = await fixture()
  try {
    const stage = join(f.root, 'stage/package')
    await mkdir(stage, { recursive: true })
    await writeFile(
      join(stage, 'package.json'),
      JSON.stringify({
        name: '@jigging/agent-acp',
        version: '0.1.0-alpha.1',
        publishConfig: { access: 'public' },
      }),
    )
    const archive = join(f.root, 'archive.tgz')
    execute('tar', ['-czf', archive, '-C', join(f.root, 'stage'), 'package'])
    await assert.rejects(inspectArchive(archive, '@jigging/flow'), /selected public/)
    await assert.rejects(inspectArchive(archive, '@jigging/agent-acp'), /omits FLOW.ts/)
  } finally {
    await f.cleanup()
  }
})

test('qualifier consumes exact frozen FLOW bytes for Bun/Node smoke and ordinary npm imports without repacking', async () => {
  const f = await fixture()
  try {
    const directory = join(f.root, 'candidate')
    await buildCandidates(directory, f)
    f.calls.length = 0
    const result = await qualifyCandidate('flow', directory, f)
    assert.deepEqual(result.gates, ['package-smoke', 'npm-install-import'])
    assert.ok(
      !f.calls.some((call) => call.args.includes('--destination') || call.args.includes('build')),
    )
    const smoke = f.calls.find((call) => call.args[0] === 'packages/flow-sdk/test/package-smoke.ts')
    assert.equal(
      smoke.options.env.FLOW_SDK_PACKAGE_ARCHIVE,
      join(directory, 'flow-sdk', result.archive.split('/').at(-1)),
    )
    assert.equal(smoke.options.env.FLOW_NODE, process.execPath)
    assert.ok(
      f.calls
        .find((call) => call.args[0] === 'install')
        .args.includes(smoke.options.env.FLOW_SDK_PACKAGE_ARCHIVE),
    )
  } finally {
    await f.cleanup()
  }
})

test('qualifier preserves frozen Agent import/protocol gates and refuses candidate mutation', async () => {
  const f = await fixture()
  try {
    const directory = join(f.root, 'candidate')
    await buildCandidates(directory, f)
    let protocol
    const result = await qualifyCandidate('acp', directory, {
      ...f,
      rejectAgent: async (...args) => {
        protocol = args
      },
    })
    assert.deepEqual(result.gates, ['npm-install-import', 'installed-flow-invalid-input'])
    assert.ok(protocol[1].endsWith('/node_modules/@jigging/agent-acp/FLOW.ts'))
    assert.ok(!f.calls.some((call) => call.args[0] === 'test'))
    let count = 0
    await assert.rejects(
      qualifyCandidate('flow', directory, {
        ...f,
        verify: async (...args) => {
          const verified = await verifyCandidateBundle(...args)
          return { ...verified, receiptSha256: ++count === 1 ? verified.receiptSha256 : 'changed' }
        },
      }),
      /identity or source changed/,
    )
    const bytes = await readFile(join(directory, 'CANDIDATE.json'))
    const entry = (await verifyCandidateBundle(directory)).packages[0]
    await writeFile(join(directory, entry.archive), 'corrupted')
    await assert.rejects(qualifyCandidate('flow', directory, f), /digest mismatch/)
    assert.deepEqual(await readFile(join(directory, 'CANDIDATE.json')), bytes)
  } finally {
    await f.cleanup()
  }
})

test('Agent invalid-input proof observes installed response, clean exit and stderr with open stdin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-agent-protocol-proof-'))
  try {
    const program = join(root, 'flow.mjs')
    await writeFile(
      program,
      'process.stdin.once("data",b=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({id:r.id,error:{code:-32602}}));process.exit(0)})',
    )
    await rejectInstalledAgent(process.execPath, program, root, process.env)
    await writeFile(
      program,
      'process.stdin.once("data",()=>{process.stdout.write(JSON.stringify({id:"candidate",error:{code:-32602}}));process.stderr.write("unexpected");process.exit(0)})',
    )
    await assert.rejects(
      rejectInstalledAgent(process.execPath, program, root, process.env),
      /exact invalid-input rejection/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Jig qualification retains portable smoke and both baselines, then refuses altered installed runtime bytes', async () => {
  const f = await fixture()
  try {
    const directory = join(f.root, 'candidate')
    await buildCandidates(directory, f)
    f.calls.length = 0
    const record = await readFile(join(directory, 'CANDIDATE.json'))
    await assert.rejects(
      qualifyCandidate('jig', directory, {
        ...f,
        run: (command, args, options) => {
          if (command.endsWith('/npm-consumer/node_modules/@oven/bun-linux-x64-baseline/bin/bun')) {
            f.calls.push({ command, args, options })
            return args[0] === '--version' ? '1.3.3' : '1.3.3+274e01c73'
          }
          const result = f.run(command, args, options)
          if (command === join(f.bin, 'npm') && args[0] === 'install') {
            const prefix = args[args.indexOf('--prefix') + 1]
            for (const path of [
              'node_modules/.bin/jig',
              'node_modules/@oven/bun-linux-x64-baseline/bin/bun',
            ]) {
              const file = join(prefix, path)
              mkdirSync(join(file, '..'), { recursive: true })
              writeFileSync(file, 'altered executable')
              chmodSync(file, 0o755)
            }
          }
          return result
        },
      }),
      /wrong Bun bytes/,
    )
    const expected = [
      'packages/display-model/test/package-smoke.ts',
      'packages/display-web/test/package-smoke.ts',
      'packages/display-tui/test/package-smoke.ts',
      'packages/jig/test/package-smoke.ts',
      'scripts/test-operational-baseline.ts',
      'scripts/test-installed-hostile-baseline.ts',
    ]
    assert.deepEqual(
      f.calls.filter((call) => expected.includes(call.args[0])).map((call) => call.args[0]),
      expected,
    )
    for (const call of f.calls.filter((call) => expected.includes(call.args[0]))) {
      assert.equal(call.options.env.JIG_LINUX_ROOTLESS_HOSTILE, '')
      assert.equal(call.options.env.JIG_MACOS_PROCESS_TEST, '')
      assert.ok(call.options.env.JIG_PACKAGE_ARCHIVE.startsWith(`${directory}/jig/`))
      for (const [variable, kind] of [
        ['DISPLAY_MODEL_PACKAGE_ARCHIVE', 'display-model'],
        ['DISPLAY_WEB_PACKAGE_ARCHIVE', 'display-web'],
        ['DISPLAY_TUI_PACKAGE_ARCHIVE', 'display-tui'],
      ]) {
        const entry = JSON.parse(record).packages.find((item) => item.kind === kind)
        assert.equal(call.options.env[variable], join(directory, entry.archive))
      }
    }
    assert.equal(f.calls.filter((call) => call.args[0] === 'install').length, 1)
    assert.deepEqual(await readFile(join(directory, 'CANDIDATE.json')), record)
  } finally {
    await f.cleanup()
  }
})

test('a failed standalone display consumer prevents Jig qualification without rebuilding frozen candidates', async () => {
  const f = await fixture()
  try {
    const directory = join(f.root, 'candidate')
    await buildCandidates(directory, f)
    const record = await readFile(join(directory, 'CANDIDATE.json'))
    for (const kind of ['display-model', 'display-web', 'display-tui']) {
      f.calls.length = 0
      const failing = `packages/${kind}/test/package-smoke.ts`
      await assert.rejects(
        qualifyCandidate('jig', directory, {
          ...f,
          run: (command, args, options) => {
            if (args[0] === failing) throw new Error(`${kind} consumer failed`)
            return f.run(command, args, options)
          },
        }),
        new RegExp(`${kind} consumer failed`),
      )
      assert.ok(!f.calls.some((call) => call.args[0] === 'packages/jig/test/package-smoke.ts'))
      assert.ok(
        !f.calls.some((call) => call.args.includes('--destination') || call.args.includes('build')),
      )
      assert.deepEqual(await readFile(join(directory, 'CANDIDATE.json')), record)
      await verifyCandidateBundle(directory)
    }
  } finally {
    await f.cleanup()
  }
})

test('unqualified Just version refuses before candidate creation', async () => {
  const f = await fixture()
  try {
    const directory = join(f.root, 'candidate')
    await assert.rejects(
      buildCandidates(directory, {
        ...f,
        run: (command, args, options) =>
          command === join(f.bin, 'just') && args[0] === '--version'
            ? 'just 1.57.0'
            : f.run(command, args, options),
      }),
      /exact Just 1.43.1/,
    )
    assert.ok(!existsSync(directory))
    assert.ok(!f.calls.some((call) => call.args[0] === 'install'))
  } finally {
    await f.cleanup()
  }
})

test('malformed qualification requests fail before running source or package commands', async () => {
  for (const kind of ['unknown', 'display-model', 'display-web', 'display-tui'])
    await assert.rejects(qualifyCandidate(kind, '/unused'), /flow\|agent\|acp\|jig/)
  await assert.rejects(candidateTools({ env: { JIG_CI_BUN: 'relative' } }), /absolute executable/)
})
