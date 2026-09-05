import { expect, test } from 'bun:test'

test('handle reserves protocol stdout and redirects ordinary logs', async () => {
  const { output, error } = await invoke('fixture-flow.ts', 'host:stdio')
  expect(error).toBe(
    'handler log\nhandler info\nhandler debug\nimported library log\nafter handle\n',
  )
  expect(output.endsWith('\n')).toBe(true)
  expect(JSON.parse(output)).toEqual({
    jsonrpc: '2.0',
    id: 'host:stdio',
    result: {
      outcome: 'done',
      output: {
        input: { hello: 'world' },
        scratch: '/tmp/flow',
      },
    },
  })
})

test('a dynamic application import starts after console redirection', async () => {
  const { output, error } = await invoke('fixture-dynamic-flow.ts', 'host:dynamic')
  expect(error).toBe('application top-level log\napplication cached log\n')
  expect(JSON.parse(output)).toEqual({
    jsonrpc: '2.0',
    id: 'host:dynamic',
    result: {
      outcome: 'done',
      output: { input: { hello: 'world' } },
    },
  })
})

async function invoke(
  fixture: string,
  id: string,
): Promise<{
  readonly output: string
  readonly error: string
}> {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/${fixture}`], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'flow/run',
      params: {
        protocol: 'run/1',
        input: { hello: 'world' },
        settings: {},
        attachments: {},
        scratch: '/tmp/flow',
        deadlineUnixMs: 4_000_000_000_000,
      },
    })}\n`,
  )
  await child.stdin.flush()

  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited).toBe(0)
  expect(output.endsWith('\n')).toBe(true)
  return { output, error }
}
