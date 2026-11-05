import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

// Real package installation and Run/0 framing, with a controlled Agent reply.
// This establishes package mechanics, independently of native containment or model quality.
test('a fresh installed package selects through its bundled Flow without development dependencies', { timeout: 60_000 }, async () => {
  const root = resolve(import.meta.dirname, '..')
  const temporary = await mkdtemp(join(tmpdir(), 'semantic-router-pack-'))
  const original = await readFile(join(root, 'package.json'), 'utf8')
  try {
    const archives = join(temporary, 'archives')
    const consumer = join(temporary, 'consumer')
    await mkdir(archives)
    await mkdir(consumer)
    execFileSync('bun', ['pm', 'pack', '--ignore-scripts', '--destination', archives], { cwd: root, stdio: 'pipe' })
    const packed = (await readdir(archives)).filter((name) => name.endsWith('.tgz'))
    assert.equal(packed.length, 1)
    const archive = join(archives, packed[0])
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n')
    for (const member of ['FLOW.ts', 'FLOW.meta.json', 'FLOW.contract.json', 'dist/flow.js',
      'dist/index.js', 'dist/index.d.ts', 'contracts/agent-run/contract.json',
      'contracts/agent-run/contracts/agent-commands.json', 'contracts/reporting/reporting.json',
      'examples/recover-draft/flows/recovery/recover.ts'])
      assert.ok(entries.includes(`package/${member}`), member)
    assert.ok(!entries.some((name) => name.includes('/node_modules/') || name.endsWith('.tgz')))
    execFileSync(process.env.FLOW_NPM || 'npm', ['install', '--prefix', consumer, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', archive], { stdio: 'pipe' })
    const installed = join(consumer, 'node_modules/@jigging/semantic-router')
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    assert.equal(manifest.private, undefined)
    assert.deepEqual(manifest.dependencies ?? {}, {})
    assert.ok(!JSON.stringify(manifest.devDependencies).includes('workspace:'))
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      const {routingInput,checkRoutingResult}=await import('@jigging/semantic-router');
      const {candidates}=routingInput({task:'Finish.',candidates:[{id:'finish',description:'Finish a draft.'}]});
      if(checkRoutingResult({outcome:'done',output:{candidateId:'finish',reason:'Fits.'}},candidates).output.candidateId!=='finish')throw Error('Invalid installed validator');
    `], { cwd: consumer, stdio: 'pipe' })
    const child = spawn('bun', [join(installed, 'FLOW.ts')], { cwd: consumer, stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = '', stderr = '', terminal, calls = 0
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text) => { stderr += text })
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'run', method: 'flow/run', params: {
        protocol: 'run/0', input: { task: 'Finish the supplied draft.', candidates: [{ id: 'finish', description: 'Finish a supplied draft.' }] },
        settings: {}, attachments: {}, channels: {}, scratch: temporary, deadlineUnixMs: Date.now() + 10_000,
      } })}\n`)
      for await (const bytes of child.stdout) {
        buffer += bytes.toString('utf8')
        assert.ok(Buffer.byteLength(buffer) < 64 * 1024)
        while (buffer.includes('\n')) {
          const newline = buffer.indexOf('\n')
          const frame = JSON.parse(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          if (frame.method === 'flow/call') {
            assert.equal(++calls, 1)
            assert.equal(frame.params.slot, 'agent')
            const structured = { candidateId: 'finish', reason: 'The supplied description supports this task.' }
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { outcome: 'done', output: { text: JSON.stringify(structured), structured } } })}\n`)
          } else if (frame.id === 'run') {
            terminal = frame
            child.stdin.end()
          } else assert.fail('Unexpected Flow frame.')
        }
      }
      assert.equal(await closed, 0)
      assert.equal(stderr, '')
      assert.equal(calls, 1)
      assert.equal(terminal.result.outcome, 'done')
      assert.equal(terminal.result.output.candidateId, 'finish')
    } finally {
      clearTimeout(timer)
      child.stdin.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    }
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), original)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
