import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('ordinary packing retains editable source, registry dependencies and a standalone runtime', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), 'agent-method-pack-test-'))
  const originalManifest = await readFile(join(root, 'package.json'), 'utf8')
  try {
    const first = join(temporary, 'first')
    const extracted = join(temporary, 'extracted')
    const repacked = join(temporary, 'repacked')
    await mkdir(extracted)
    await mkdir(first)
    await mkdir(repacked)
    const pack = (cwd: string, destination: string) =>
      execFileSync(
        process.execPath,
        ['pm', 'pack', '--ignore-scripts', '--destination', destination],
        {
          cwd,
          stdio: 'pipe',
        },
      )
    pack(root, first)
    const archives = (await readdir(first)).filter((name) => name.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    const archive = join(first, archives[0]!)
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    expect(entries).toContain('package/src/flow.ts')
    expect(entries).toContain('package/dist/conversation.d.ts')
    expect(entries).toContain('package/FLOW.contract.json')
    expect(entries.some((name) => name.includes('/tooling/') || name.endsWith('.tgz'))).toBe(false)
    expect(entries.some((name) => name.includes('/node_modules/'))).toBe(false)
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted])
    const manifest = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'))
    const settingsSchema = JSON.parse(
      await readFile(join(extracted, 'settings.schema.json'), 'utf8'),
    )
    expect(settingsSchema.properties.omitStore).toMatchObject({ type: 'boolean' })
    for (const name of ['@jigging/flow']) {
      const version = manifest.devDependencies[name]
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
      expect(version).not.toMatch(/workspace:|file:/)
    }
    expect(Object.keys(manifest.dependencies ?? {})).toHaveLength(0)
    // Public built exports and the complete Flow bundle work without development dependencies.
    execFileSync(
      process.execPath,
      [
        '-e',
        `await import('./dist/flow.js');
        const { prepareAgent, checkAgentResult } = await import('@jigging/agent-method');
        const reference = '013579ab-cdef-4567-89ab-0123456789ab';
        const prepared = prepareAgent({ instructions: 'Answer.', session: { restore: reference } });
        if (prepared.session.restore !== reference || prepared.request.prompt.includes(reference)) throw new Error('invalid session preparation');
        const result = checkAgentResult({ outcome: 'done', output: { text: 'answer', session: { status: 'retained', reference } } });
        if (result.output.session.reference !== reference || !Object.isFrozen(result.output.session)) throw new Error('invalid session receipt');
        const conversation = await import('@jigging/agent-method/conversation');
        if (typeof conversation.withAgentConversation !== 'function') throw new Error('missing public conversation helper')`,
      ],
      { cwd: extracted, stdio: 'pipe' },
    )
    // Exercise the packed entrypoint and real SDK wire, outside the workspace.
    // The HTTP peer is deliberately inert: this is protocol evidence, not a
    // provider or containment qualification.
    const invoke = async (
      input: Record<string, unknown>,
      settings: Record<string, unknown>,
      http?: { status: number; body: unknown },
    ) => {
      const child = Bun.spawn([process.execPath, 'FLOW.ts'], {
        cwd: extracted,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const timer = setTimeout(() => child.kill(), 10_000)
      const calls: { body: Record<string, unknown>; response: string }[] = []
      let terminal: unknown
      let buffer = ''
      const stderr = new Response(child.stderr).text()
      try {
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 'host:1',
            method: 'flow/run',
            params: {
              protocol: 'run/0',
              input,
              settings,
              attachments: {},
              channels: {},
              scratch: temporary,
              deadlineUnixMs: Date.now() + 10_000,
            },
          })}\n`,
        )
        for await (const chunk of child.stdout) {
          buffer += new TextDecoder().decode(chunk)
          expect(buffer.length).toBeLessThan(64 * 1024)
          while (true) {
            const newline = buffer.indexOf('\n')
            if (newline < 0) break
            const frame = JSON.parse(buffer.slice(0, newline))
            buffer = buffer.slice(newline + 1)
            if (frame.method === 'flow/call') {
              expect(frame.params.slot).toBe('http')
              calls.push(frame.params.input)
              if (http === undefined) throw new Error('Unexpected HTTP dispatch')
              child.stdin.write(
                `${JSON.stringify({
                  jsonrpc: '2.0',
                  id: frame.id,
                  result: { outcome: 'done', output: http },
                })}\n`,
              )
            } else if (frame.id === 'host:1') {
              terminal = frame
              child.stdin.end()
            }
          }
        }
        // A clean protocol exit does not turn an operational error into success.
        expect(await child.exited).toBe(0)
        return { calls, terminal, stderr: await stderr }
      } finally {
        clearTimeout(timer)
        child.kill()
        await child.exited
      }
    }
    const rejected = await invoke(
      { instructions: 'private fixture input' },
      { model: 'fixture-model' },
      {
        status: 422,
        body: {
          error: {
            param: 'max_completion_tokens',
            message: 'private fixture input and key',
          },
        },
      },
    )
    expect(rejected.calls).toHaveLength(1)
    expect(rejected.calls[0]!.body.store).toBe(false)
    expect(rejected.terminal).toMatchObject({
      error: {
        data: {
          code: 'INVALID_RESULT',
          details: {
            status: 422,
            parameter: 'max_completion_tokens',
            retry: 'not-attempted',
          },
        },
      },
    })
    expect(JSON.stringify(rejected.terminal)).not.toContain('private fixture input')
    expect(rejected.stderr).not.toContain('private fixture input')

    const responseSchema = {
      $schema: 'https://flow.jig.md/schemas/schema-0.json',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }
    const { $schema: _removed, ...projected } = responseSchema
    const format = { name: 'flow_agent_result', schema: projected, strict: true }
    for (const api of ['chat-completions', 'responses'] as const) {
      for (const content of ['{"answer":"checked"}', '{"answer":42}']) {
        const result = await invoke(
          { instructions: 'Answer.', responseSchema },
          {
            model: 'chosen-model',
            api,
            maxCompletionTokens: 16,
            structuredOutput: 'json-schema',
            omitStore: true,
          },
          {
            status: 200,
            body:
              api === 'chat-completions'
                ? {
                    object: 'chat.completion',
                    choices: [
                      {
                        index: 0,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content },
                      },
                    ],
                  }
                : {
                    object: 'response',
                    status: 'completed',
                    output: [
                      {
                        type: 'message',
                        role: 'assistant',
                        status: 'completed',
                        content: [{ type: 'output_text', text: content }],
                      },
                    ],
                  },
          },
        )
        expect(result.calls).toHaveLength(1)
        const call = result.calls[0]!
        expect(Object.hasOwn(call.body, 'store')).toBe(false)
        expect(call).toEqual({
          response: 'json',
          body: {
            model: 'chosen-model',
            stream: false,
            ...(api === 'chat-completions'
              ? {
                  messages: [{ role: 'user', content: expect.any(String) }],
                  max_completion_tokens: 16,
                  n: 1,
                  response_format: { type: 'json_schema', json_schema: format },
                }
              : {
                  input: expect.any(String),
                  max_output_tokens: 16,
                  text: { format: { type: 'json_schema', ...format } },
                }),
          },
        })
        if (content === '{"answer":"checked"}') {
          expect(result.terminal).toEqual({
            jsonrpc: '2.0',
            id: 'host:1',
            result: {
              outcome: 'done',
              output: { text: content, structured: { answer: 'checked' } },
            },
          })
        } else {
          expect(result.terminal).toMatchObject({
            error: { data: { code: 'INVALID_RESULT' } },
          })
        }
      }
    }
    const invalid = await invoke(
      { instructions: 'Answer.' },
      { model: 'chosen-model', omitStore: 'true' },
    )
    expect(invalid.calls).toHaveLength(0)
    expect(invalid.terminal).toMatchObject({ error: { data: { code: 'INVALID_INPUT' } } })
    pack(extracted, repacked)
    const next = (await readdir(repacked)).filter((name) => name.endsWith('.tgz'))
    expect(next).toHaveLength(1)
    const nextManifest = JSON.parse(
      execFileSync('tar', ['-xOf', join(repacked, next[0]!), 'package/package.json'], {
        encoding: 'utf8',
      }),
    )
    expect(nextManifest.devDependencies).toEqual(manifest.devDependencies)
    expect(
      execFileSync('tar', ['-xOf', join(repacked, next[0]!), 'package/src/flow.ts'], {
        encoding: 'utf8',
      }),
    ).toBe(await readFile(join(extracted, 'src/flow.ts'), 'utf8'))
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(originalManifest)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
