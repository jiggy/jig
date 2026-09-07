import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { defineBinding } from '../src/project/author.js'
import { normalizeProjectCommands } from '../src/project/commands.js'
import { parseCapabilityContract } from '../src/capability/index.js'
import { compileSchemaFile } from '../src/schema/index.js'
import { canonicalJson } from '../src/json.js'
import {
  assertProjectCommandContract,
  parseProjectCommandInput,
  PROJECT_COMMAND_CONTRACT_DIGEST,
  projectCommandCandidateDigest,
} from '../src/internal/private-project-command.js'
import { collectProjectCommandStream } from '../src/internal/root-project-command-controller.js'

const commands = normalizeProjectCommands({
  cli: { run: 'src/cli.ts' },
  tests: { test: ['test/cli.test.ts'] },
})
const files = {
  'src/cli.ts': 'console.log("ok")',
  'test/cli.test.ts': 'import {test} from "bun:test"; test("ok", () => {})',
}

describe('Project Command contract and reviewed policy', () => {
  test('binds a closed command map as inert authoring data', async () => {
    const source = { cli: { run: 'src/cli.ts' } }
    const binding = defineBinding({ package: 'flows/repair', commands: source })
    source.cli.run = 'other.ts'
    expect(binding.commands).toEqual({ cli: { run: 'src/cli.ts' } })
    const schema = compileSchemaFile(
      await readFile(
        new URL('../../../docs/jig/spec/machine/project-authoring-1.schema.json', import.meta.url),
      ),
    )
    expect(() => schema.validate(binding)).not.toThrow()
    for (const invalid of [
      null,
      { cli: { shell: 'bun test' } },
      { cli: { run: '../bad.ts' } },
      { cli: { run: '/tmp/bad.ts' } },
      { cli: { run: 'x.ts', test: ['x.test.ts'] } },
      { test: { test: [] } },
    ])
      expect(() => defineBinding({ package: 'flows/repair', commands: invalid as never })).toThrow()
  })
  test('matches the exact companion and independently validates input/output shape', async () => {
    const parsed = parseCapabilityContract(
      await readFile(
        new URL(
          '../../../docs/jig/spec/contracts/project-command.capability.json',
          import.meta.url,
        ),
      ),
    )
    expect(parsed.digest).toBe(PROJECT_COMMAND_CONTRACT_DIGEST)
    expect(() => assertProjectCommandContract(parsed)).not.toThrow()
    parsed.schemas.get('/methods/run/input')!.validate({ command: 'cli', files })
    expect(() =>
      assertProjectCommandContract({
        ...parsed,
        descriptor: { ...parsed.descriptor, id: 'https://example.org/other' },
      }),
    ).toThrow()
    parsed.schemas
      .get('/methods/run/output')!
      .validate({
        candidateDigest: projectCommandCandidateDigest(files),
        command: 'cli',
        invocation: ['bun', 'src/cli.ts'],
        stdinDigest: `sha256:${'0'.repeat(64)}`,
        stdout: { text: 'ok', truncated: false },
        stderr: { text: '', truncated: false },
        exitCode: 0,
        signal: null,
        stopReason: 'exited',
        cleanup: 'complete',
      })
  })
  test('identifies exact bytes independently of map insertion order', () => {
    const input = { command: 'cli', files: { ...files }, args: ['--help'], stdin: 'record\n' }
    const parsed = parseProjectCommandInput(input, commands)
    input.files['src/cli.ts'] = 'changed'
    expect(parsed.input.files['src/cli.ts']).toBe(files['src/cli.ts'])
    expect(parsed.candidateDigest).toBe(
      projectCommandCandidateDigest(Object.fromEntries(Object.entries(files).reverse())),
    )
    expect(parsed.candidateDigest).toBe(
      `sha256:${new Bun.CryptoHasher('sha256').update(canonicalJson(files)).digest('hex')}`,
    )
    expect(parsed.invocation).toEqual(['bun', 'src/cli.ts', '--help'])
    expect(parsed.candidateDigest).not.toBe(projectCommandCandidateDigest(input.files))
  })
  test('rejects extra authority, malformed text, missing launch files and exceeded limits', () => {
    const valid = { command: 'cli', files }
    for (const invalid of [
      { ...valid, command: 'unknown' },
      { ...valid, executable: 'sh' },
      { ...valid, files: {} },
      { ...valid, files: { '../x.ts': '' } },
      { ...valid, files: { ...files, src: 'collision' } },
      { ...valid, files: { ...files, 'node_modules/a.ts': '' } },
      { ...valid, files: { ...files, 'bad.ts': '\ud800' } },
      { ...valid, files: { ...files, 'big.ts': 'x'.repeat(262145) } },
      { ...valid, args: null },
      { ...valid, args: ['x\0y'] },
      { ...valid, args: Array(33).fill('x') },
      { ...valid, stdin: null },
      { ...valid, stdin: 'x'.repeat(16385) },
      { ...valid, command: 'tests', args: ['--preload=bad.ts'] },
    ])
      expect(() => parseProjectCommandInput(invalid, commands)).toThrow()
  })
  test('drains a hostile stream but retains only its prefix and truthful truncation', async () => {
    let drained = 0
    async function* stream() {
      for (let i = 0; i < 80; i++) {
        drained++
        yield new Uint8Array(2048).fill(65)
      }
    }
    const result = await collectProjectCommandStream(stream())
    expect(drained).toBe(80)
    expect(result.text.length).toBe(65536)
    expect(result.truncated).toBe(true)
    async function* empty() {
      yield new Uint8Array()
    }
    expect(await collectProjectCommandStream(empty())).toEqual({ text: '', truncated: false })
  })
})
