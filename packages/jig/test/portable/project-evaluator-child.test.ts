import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPrivateAuthorEvaluatorChild } from '../../src/internal/project-evaluator-child.js'
import {
  PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES,
  PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES,
} from '../../src/internal/project-evaluator-policy.js'
import {
  type PrivateAuthorEvaluatorSupport,
  privateAuthorEvaluatorProgram,
  readPrivateAuthorEvaluatorProgram,
} from '../../src/internal/project-evaluator-program.js'

async function fixture(
  action: string | ((root: string) => string),
  check: (support: PrivateAuthorEvaluatorSupport, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'jig-evaluator-child-'))
  try {
    const workerSource = [
      'const bootstrap = globalThis.__jigCapturedAuthorEvaluator;',
      'delete globalThis.__jigCapturedAuthorEvaluator;',
      'const bytes = Buffer.from(bootstrap.request, "base64");',
      typeof action === 'string' ? action : action(root),
    ].join('\n')
    await check({ workerSource, sdkSource: 'captured SDK' }, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe.serial('trusted declaration subprocess settlement', () => {
  test('collects actual bytes only after a clean exit', async () => {
    await fixture(`process.stdout.write(bytes);`, async (support) => {
      const bytes = new TextEncoder().encode('exact captured request')
      expect(await runPrivateAuthorEvaluatorChild(bytes, support)).toEqual(bytes)
    })
  }, 10_000)
  test('passes captured SDK text without reopening a filesystem path', async () => {
    await fixture(`process.stdout.write(bootstrap.sdkSource);`, async (support) => {
      const bytes = await runPrivateAuthorEvaluatorChild(new Uint8Array(), support)
      expect(new TextDecoder().decode(bytes)).toBe(support.sdkSource)
    })
  }, 10_000)
  test('authored quotes, template syntax, Unicode and prototype keys remain inert data', async () => {
    await fixture(
      `
      const value = JSON.parse(bytes.toString());
      if (!Object.hasOwn(value, '__proto__') || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('JSON object semantics changed');
      if (globalThis.injected || ({}).polluted) throw new Error('request escaped its data boundary');
      process.stdout.write(bytes);
    `,
      async (support) => {
        const bytes = new TextEncoder().encode(
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Deliberate hostile script syntax must stay inert data.
          '{"__proto__":{"polluted":true},"source":"\\";globalThis.injected=true;// ` ${globalThis.injected=true} \\u2028 \\u2029 😀"}',
        )
        expect(await runPrivateAuthorEvaluatorChild(bytes, support)).toEqual(bytes)
      },
    )
  }, 10_000)
  test('bounds request and complete stdin program before creating a child', () => {
    const support = { workerSource: 'process.exit(0)', sdkSource: '' }
    expect(() =>
      privateAuthorEvaluatorProgram(
        new Uint8Array(PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES + 1),
        support,
      ),
    ).toThrow('request exceeds')
    expect(() =>
      privateAuthorEvaluatorProgram(new Uint8Array(), {
        workerSource: '"'.repeat(PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES / 2),
        sdkSource: '',
      }),
    ).toThrow('program exceeds')
  })
  test('consumes bootstrap once and rejects malformed or noncanonical framing', () => {
    const globals = globalThis as unknown as Record<string, unknown>
    const key = '__jigCapturedAuthorEvaluator'
    try {
      globals[key] = { request: 'YQ==', workerSource: 'worker', sdkSource: 'sdk' }
      const captured = readPrivateAuthorEvaluatorProgram()
      expect(captured.request).toEqual(Buffer.from('a'))
      expect(captured.support).toEqual({ workerSource: 'worker', sdkSource: 'sdk' })
      expect(Object.hasOwn(globals, key)).toBe(false)
      expect(() => readPrivateAuthorEvaluatorProgram()).toThrow('invalid evaluator bootstrap')
      for (const value of [
        null,
        { request: 'YQ', workerSource: 'worker', sdkSource: 'sdk' },
        { request: '!', workerSource: 'worker', sdkSource: 'sdk' },
        { request: '', workerSource: 'worker', sdkSource: 'sdk', extra: true },
        { request: '', workerSource: 1, sdkSource: 'sdk' },
      ]) {
        globals[key] = value
        expect(() => readPrivateAuthorEvaluatorProgram()).toThrow('invalid evaluator bootstrap')
        expect(Object.hasOwn(globals, key)).toBe(false)
      }
    } finally {
      delete globals[key]
    }
  })
  test('reaps a stalled child at its individual ceiling, without borrowing batch time', async () => {
    await fixture(
      (root) => `
      await Bun.write(${JSON.stringify(join(root, 'pid'))}, String(process.pid));
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    `,
      async (support, root) => {
        await expect(
          runPrivateAuthorEvaluatorChild(new Uint8Array(), support),
        ).rejects.toMatchObject({ code: 'PROJECT_EVALUATOR_DEADLINE' })
        const pid = Number(await readFile(join(root, 'pid'), 'utf8'))
        expect(() => process.kill(pid, 0)).toThrow()
      },
    )
  }, 20_000)
  for (const [suiteCaseIndex, suiteCaseValue] of [
    ["process.stdout.write('answer'); process.exit(2);", 'PROJECT_EVALUATION_FAILED'],
    [
      "process.stderr.write('x'.repeat(65537)); setInterval(() => {},1000);",
      'PROJECT_EVALUATION_LIMIT',
    ],
  ].entries()) {
    test(
      'nonzero exit or bounded-output loss cannot become success (%s)' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (source, code) => {
            await fixture(source!, async (support) => {
              await expect(
                runPrivateAuthorEvaluatorChild(new Uint8Array(), support),
              ).rejects.toMatchObject({ code })
            })
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
      10_000,
    )
  }
})
