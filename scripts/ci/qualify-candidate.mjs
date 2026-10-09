import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidateTools, execute, sha256 } from './build-candidates.mjs'
import { verifyCandidateBundle } from './candidate-provenance.mjs'

const PACKAGE_KINDS = Object.freeze({
  flow: 'flow-sdk',
  agent: 'agent-method',
  acp: 'agent-acp',
  jig: 'jig',
})
const RUNTIME_HASH = 'e666c943af70078a72bad00757a094776a54621fecd83eb4aa982760f9186839'
const HELP_LINES = [
  '  jig init <directory>       Create a project with a small greeting Flow',
  '  jig review [project]       Review changes and approve an exact revision',
  '  jig run [target]           Choose or run a reviewed Flow or Binding',
  '  jig --version             Print the installed version',
]

// Keep stdin open until the invalid-input response exits, just as the local
// Agent candidate gate does; early EOF is a separate transport failure.
export async function rejectInstalledAgent(bun, entrypoint, cwd, env, spawnProcess = spawn) {
  const child = spawnProcess(bun, [entrypoint], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '',
    stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (data) => {
    stdout += data
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const stopped = new Promise((resolve) => child.once('close', resolve))
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000)
  try {
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => resolve(status))
      child.stdin.once('error', reject)
    })
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 'candidate', method: 'flow/run', params: {} })}\n`,
    )
    const status = await closed
    const record = JSON.parse(stdout)
    if (record.id !== 'candidate' || record.error?.code !== -32602 || status !== 0 || stderr !== '')
      throw new Error('Installed Agent did not return its exact invalid-input rejection')
  } finally {
    clearTimeout(deadline)
    child.stdin.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await stopped
  }
}

export async function qualifyCandidate(
  kind,
  directory,
  {
    repository = resolve(import.meta.dirname, '../..'),
    env = process.env,
    run = execute,
    verify = verifyCandidateBundle,
    rejectAgent = rejectInstalledAgent,
  } = {},
) {
  const packageKind = PACKAGE_KINDS[kind]
  if (!packageKind || !directory)
    throw new Error('Qualification requires flow|agent|acp|jig and a frozen bundle')
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: repository })
  const bundle = await verify(resolve(directory), { sourceRevision: revision })
  const tools = await candidateTools({ env, run })
  const selected = bundle.packages.find((entry) => entry.kind === packageKind)
  if (!selected) throw new Error(`Frozen bundle omits ${packageKind}`)
  const archive = join(resolve(directory), selected.archive)
  const temporary = await mkdtemp(join(tmpdir(), `jig-ci-qualify-${kind}-`))
  const gates = []
  try {
    const inputs = Object.fromEntries(
      [
        ['FLOW_SDK_PACKAGE_ARCHIVE', 'flow-sdk'],
        ['USER_UPDATES_PACKAGE_ARCHIVE', 'user-updates'],
        ['AGENT_METHOD_PACKAGE_ARCHIVE', 'agent-method'],
        ['AGENT_ACP_PACKAGE_ARCHIVE', 'agent-acp'],
        ['JIG_PACKAGE_ARCHIVE', 'jig'],
      ].map(([variable, inputKind]) => {
        const input = bundle.packages.find((entry) => entry.kind === inputKind)
        if (!input) throw new Error(`Frozen bundle omits ${inputKind}`)
        return [variable, join(resolve(directory), input.archive)]
      }),
    )
    const testEnv = {
      ...env,
      ...inputs,
      FLOW_NODE: tools.node,
      FLOW_NPM: tools.npm,
      JIG_NPM: tools.npm,
      JIG_AUTHORING_NODE_PATH: env.JIG_AUTHORING_NODE_PATH || tools.node,
      JIG_LINUX_ROOTLESS_HOSTILE: '',
      JIG_MACOS_PROCESS_TEST: '',
      PATH: `${dirname(tools.bun)}:${dirname(tools.node)}:${dirname(tools.npm)}:${env.PATH || '/usr/bin:/bin'}`,
    }
    const options = { cwd: repository, env: testEnv }
    const consumer = join(temporary, 'npm-consumer')
    await mkdir(consumer)
    if (kind === 'flow') {
      run(tools.bun, ['packages/flow-sdk/test/package-smoke.ts'], options)
      gates.push('package-smoke')
      run(
        tools.npm,
        [
          'install',
          '--prefix',
          consumer,
          '--ignore-scripts',
          '--no-package-lock',
          '--no-audit',
          '--no-fund',
          archive,
        ],
        options,
      )
      run(
        tools.node,
        [
          '--input-type=module',
          '-e',
          'const sdk=await import("@jigging/flow");if(typeof sdk.handle!=="function"||typeof sdk.OperationError!=="function")process.exit(70)',
        ],
        { ...options, cwd: consumer },
      )
      gates.push('npm-install-import')
    } else if (kind === 'agent' || kind === 'acp') {
      // Source and distribution-roundtrip tests have one owner in source-tests.
      // This obligation exercises the installed publishing candidate only.
      run(
        tools.npm,
        [
          'install',
          '--prefix',
          consumer,
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          archive,
        ],
        options,
      )
      const module = kind === 'acp' ? `${selected.name}/transport` : selected.name
      run(
        tools.node,
        [
          '--input-type=module',
          '-e',
          `const api=await import(${JSON.stringify(module)});if(Object.keys(api).length===0)process.exit(70)`,
        ],
        { ...options, cwd: consumer },
      )
      gates.push('npm-install-import')
      await rejectAgent(
        tools.bun,
        join(consumer, 'node_modules', selected.name, 'FLOW.ts'),
        consumer,
        testEnv,
      )
      gates.push('installed-flow-invalid-input')
    } else {
      run(tools.bun, ['packages/jig/test/package-smoke.ts'], options)
      gates.push('package-smoke')
      run(tools.bun, ['scripts/test-operational-baseline.ts'], options)
      gates.push('operational-baseline-1')
      run(tools.bun, ['scripts/test-installed-hostile-baseline.ts'], options)
      gates.push('installed-hostile-baseline')
      run(
        tools.npm,
        [
          'install',
          '--prefix',
          consumer,
          '--ignore-scripts',
          '--no-package-lock',
          '--no-audit',
          '--no-fund',
          archive,
        ],
        options,
      )
      const localJig = join(consumer, 'node_modules/.bin/jig')
      const localBun = join(consumer, 'node_modules/@oven/bun-linux-x64-baseline/bin/bun')
      await access(localJig, constants.X_OK)
      await access(localBun, constants.X_OK)
      assert.equal(
        run(localBun, ['--version'], options),
        '1.3.3',
        'npm installed the wrong Bun version',
      )
      assert.equal(
        run(localBun, ['--revision'], options),
        '1.3.3+274e01c73',
        'npm installed the wrong Bun revision',
      )
      assert.equal(
        sha256(await readFile(localBun)),
        RUNTIME_HASH,
        'npm installed the wrong Bun bytes',
      )
      const localHelp = run(localJig, ['--help'], options)
      for (const line of HELP_LINES)
        assert.ok(localHelp.split('\n').includes(line), `Installed command help omits ${line}`)
      gates.push('npm-local-install-help')
      const globalPrefix = join(temporary, 'npm-global')
      await mkdir(globalPrefix)
      run(
        tools.npm,
        [
          'install',
          '--global',
          '--prefix',
          globalPrefix,
          '--ignore-scripts',
          '--no-package-lock',
          '--no-audit',
          '--no-fund',
          archive,
        ],
        options,
      )
      const globalJig = join(globalPrefix, 'bin/jig')
      const globalBun = join(
        globalPrefix,
        'lib/node_modules/@jigging/jig/node_modules/@oven/bun-linux-x64-baseline/bin/bun',
      )
      await access(globalJig, constants.X_OK)
      await access(globalBun, constants.X_OK)
      assert.equal(
        sha256(await readFile(globalBun)),
        RUNTIME_HASH,
        'Global npm installed the wrong Bun bytes',
      )
      assert.equal(
        run(globalJig, ['--help'], options),
        localHelp,
        'Local and global npm commands differ',
      )
      gates.push('npm-global-install-help')
    }
    const final = await verify(resolve(directory), { sourceRevision: revision })
    if (
      final.receiptSha256 !== bundle.receiptSha256 ||
      run('git', ['rev-parse', 'HEAD'], { cwd: repository }) !== revision
    )
      throw new Error('Candidate identity or source changed during qualification')
    return {
      schemaVersion: 1,
      package: selected.name,
      version: selected.version,
      commit: revision,
      archive: selected.archive,
      sha256: selected.sha256,
      candidateReceiptSha256: bundle.receiptSha256,
      gates,
      bunVersion: tools.identity.version,
      bunRevision: tools.identity.revision,
      nodeVersion: tools.nodeVersion,
      npmVersion: tools.npmVersion,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (![4, 5].includes(process.argv.length))
      throw new Error(
        'usage: node scripts/ci/qualify-candidate.mjs <flow|agent|acp|jig> <bundle> [qualification.json]',
      )
    const result = await qualifyCandidate(process.argv[2], process.argv[3])
    const json = `${JSON.stringify(result, null, 2)}\n`
    if (process.argv[4]) await writeFile(resolve(process.argv[4]), json, { flag: 'wx' })
    console.log(json.trim())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
