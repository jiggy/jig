import { describe, expect, test } from 'bun:test'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ProjectAdministrationError,
  type ProjectPlanResult,
  type ProjectSession,
} from '../src/administration/project.js'
import type {
  RootAdministration,
  RootRunStatus,
  RootRunTerminal,
  StartRootRunRequest,
} from '../src/administration/root.js'
import { RootAdministrationError } from '../src/administration/root.js'
import {
  main,
  type PrivateCliCommandHost,
  type PrivateCliOptions,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
} from '../src/cli.js'
import { canonicalJson, JSON_1_LIMITS } from '../src/json.js'
import { createProject, type ProjectInitFileSystem } from '../src/project-init.js'

const cli = resolve(import.meta.dir, '../src/cli.ts')

test('real confirmation accepts a line without cursor control on a plain terminal', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { main } from ${JSON.stringify(cli)};
     Object.defineProperty(process.stdout, 'isTTY', { value: true });
     const session = {
       async plan() { return { state: 'applicable', operation: 'admission',
         planDigest: 'sha256:' + '0'.repeat(64),
         review: { text: 'review', details: 'review' } }; },
       async apply() { process.stdout.write('APPLIED\\n'); },
       async close() { process.stdout.write('CLOSED\\n'); },
     };
     process.exitCode = await main(['review'], {
       interactive: true, host: { async acquire() { return session; } },
     });`,
    ],
    {
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const timeout = setTimeout(() => child.kill(), 8_000)
  let output = ''
  let answered = false
  try {
    const stderr = new Response(child.stderr).text()
    for await (const chunk of child.stdout) {
      output += new TextDecoder().decode(chunk)
      if (!answered && output.includes('[y/N] ')) {
        answered = true
        child.stdin.write('yes\n')
        child.stdin.end()
      }
    }
    expect(await child.exited).toBe(0)
    expect(answered).toBe(true)
    expect(output).toContain('APPLIED\nCLOSED\n')
    expect(output).toContain('Project ready')
    const combined = output + (await stderr)
    expect(combined).not.toContain('\u001b')
    expect(combined).not.toContain('\u009b')
  } finally {
    clearTimeout(timeout)
    child.kill()
    await child.exited
  }
}, 10_000)

test('terminal approval treats EOF as declining and emits no plain-mode cursor controls', async () => {
  const script = `
    import { main } from ${JSON.stringify(cli)};
    process.exitCode = await main(['review'], {
      interactive: true,
      host: { acquire: async () => ({
        plan: async () => ({ state: 'applicable', operation: 'admission', planDigest: 'sha256:' + 'a'.repeat(64), review: { text: 'Review changes before approval\\n', details: '', mediaType: 'text/plain; charset=utf-8' } }),
        apply: async () => { throw new Error('EOF must never approve') },
        close: async () => {},
      }) },
    });
  `
  const child = Bun.spawn([process.execPath, '--eval', script], {
    env: { ...process.env, NO_COLOR: '1' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  try {
    expect(await child.exited).toBe(1)
    const output = await new Response(child.stdout).text()
    const error = await new Response(child.stderr).text()
    expect(output).toContain('Approve this exact revision')
    expect(error).toContain('JIG_CHANGES_DECLINED')
    expect(output + error).not.toContain('\u001b')
  } finally {
    child.kill()
  }
}, 10_000)

test('jig init --bare creates only the fixed inert project envelope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-'))
  const destination = join(root, 'project')
  try {
    const initialized = Bun.spawn([process.execPath, cli, 'init', '--bare', destination], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await initialized.exited).toBe(0)
    expect(await new Response(initialized.stdout).text()).toBe(
      `Created bare Jig project ${JSON.stringify(destination)}.\n\nNext:\n  Add a Flow under flows/ and select it in jig.ts, then run jig review.\n`,
    )
    expect(await new Response(initialized.stderr).text()).toBe('')

    expect((await readdir(destination)).sort()).toEqual([
      '.gitignore',
      'bindings',
      'flows',
      'jig.ts',
    ])
    expect(await readdir(join(destination, 'flows'))).toEqual([])
    expect(await readdir(join(destination, 'bindings'))).toEqual([])
    expect(await readFile(join(destination, '.gitignore'), 'utf8')).toBe('.jig/\n')
    expect(await readFile(join(destination, 'jig.ts'), 'utf8')).toBe(
      [
        'import { defineJig, discover } from "@jigging/jig";',
        '',
        'export default defineJig({',
        '  flows: discover("./flows"),',
        '  bindings: discover("./bindings"),',
        '});',
        '',
      ].join('\n'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('jig init --bare rejects an existing destination without changing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-existing-'))
  const destination = join(root, 'project')
  try {
    await mkdir(destination)
    await writeFile(join(destination, 'owned.txt'), 'keep\n')

    const initialized = Bun.spawn([process.execPath, cli, 'init', '--bare', destination], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await initialized.exited).toBe(1)
    expect(await new Response(initialized.stdout).text()).toBe('')
    const diagnostic = await new Response(initialized.stderr).text()
    expect(diagnostic).toBe(
      'Error: Project destination already exists\n\n  the destination already exists.\n  Next step: Choose a new directory; existing files are never replaced.\n\n  Diagnostic code: JIG_INIT_DESTINATION_EXISTS\n',
    )
    expect(diagnostic).not.toContain(destination)
    expect(await readFile(join(destination, 'owned.txt'), 'utf8')).toBe('keep\n')
    expect(await readdir(root)).toEqual(['project'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('jig init --bare closes unavailable filesystem diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-unavailable-'))
  const destination = join(root, 'missing-parent', 'project')
  try {
    const initialized = Bun.spawn([process.execPath, cli, 'init', '--bare', destination], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await initialized.exited).toBe(2)
    expect(await new Response(initialized.stdout).text()).toBe('')
    const diagnostic = await new Response(initialized.stderr).text()
    expect(diagnostic).toBe(
      'Error: Project could not be created\n\n  the destination cannot be initialized.\n  Next step: Check the destination parent directory and its write permissions; see jig init --help.\n\n  Diagnostic code: JIG_INIT_UNAVAILABLE\n',
    )
    expect(diagnostic).not.toContain(destination)
    expect(diagnostic).not.toContain('ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bare initialization removes only its own entries after a controlled write failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-failure-'))
  const destination = join(root, 'project')
  const fileSystem: ProjectInitFileSystem = {
    mkdir,
    rmdir,
    unlink,
    writeFile: (async (path, data, options) => {
      if (String(path).endsWith('/jig.ts')) throw new Error('injected write failure')
      await writeFile(path, data, options)
    }) as typeof writeFile,
  }
  try {
    await expect(createProject(destination, fileSystem, true)).rejects.toMatchObject({
      code: 'JIG_INIT_UNAVAILABLE',
      message: 'the destination cannot be initialized',
    })
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bare initialization never removes unknown concurrent content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-foreign-'))
  const destination = join(root, 'project')
  let injected = false
  const fileSystem: ProjectInitFileSystem = {
    mkdir,
    rmdir,
    unlink,
    writeFile: (async (path, data, options) => {
      if (!injected && String(path).endsWith('/.gitignore')) {
        injected = true
        await writeFile(join(destination, 'foreign.txt'), 'keep\n')
        throw new Error('injected write failure')
      }
      await writeFile(path, data, options)
    }) as typeof writeFile,
  }
  try {
    await expect(createProject(destination, fileSystem, true)).rejects.toMatchObject({
      code: 'JIG_INIT_CLEANUP_FAILED',
      message: 'initialization failed and its created files could not be removed',
    })
    expect(await readFile(join(destination, 'foreign.txt'), 'utf8')).toBe('keep\n')
    expect(await readdir(destination)).toEqual(['foreign.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent bare initializers have exactly one winner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-init-concurrent-'))
  const destination = join(root, 'project')
  try {
    const runs = [0, 1].map(() =>
      Bun.spawn([process.execPath, cli, 'init', '--bare', destination], {
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )
    const results = await Promise.all(
      runs.map(async (run) => ({
        exit: await run.exited,
        stdout: await new Response(run.stdout).text(),
        stderr: await new Response(run.stderr).text(),
      })),
    )
    expect(results.map((result) => result.exit).sort()).toEqual([0, 1])
    expect(results.filter((result) => result.exit === 0)[0]?.stdout).toBe(
      `Created bare Jig project ${JSON.stringify(destination)}.\n\nNext:\n  Add a Flow under flows/ and select it in jig.ts, then run jig review.\n`,
    )
    expect(results.filter((result) => result.exit === 1)[0]?.stderr).toBe(
      'Error: Project destination already exists\n\n  the destination already exists.\n  Next step: Choose a new directory; existing files are never replaced.\n\n  Diagnostic code: JIG_INIT_DESTINATION_EXISTS\n',
    )
    expect((await readdir(destination)).sort()).toEqual([
      '.gitignore',
      'bindings',
      'flows',
      'jig.ts',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('default init writes an ordinary editable SDK Flow without installing or approving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-welcome-'))
  const directory = join(root, 'hello')
  let output = ''
  try {
    expect(
      await main(['init', 'hello'], {
        currentDirectory: root,
        writeOutput: (text) => {
          output += text
        },
      }),
    ).toBe(0)
    expect(output).toContain("cd 'hello'")
    expect(output).toContain('jig review --allow-resolution-network')
    expect(output).toContain(`jig run flow:flows/hello --input '"Ada"'`)
    expect(await readFile(new URL('../README.md', import.meta.url), 'utf8')).toContain(
      `jig run flow:flows/hello --input '"Ada"'`,
    )
    for (const args of [['--help'], ['run', '--help']]) {
      let help = ''
      expect(
        await main(args, {
          writeOutput: (text) => {
            help += text
          },
        }),
      ).toBe(0)
      expect(help).toContain(`jig run flow:flows/hello --input '"Ada"'`)
    }
    expect(await readFile(join(directory, 'flows/hello/FLOW.ts'), 'utf8')).toContain(
      'import { handle } from "@jigging/flow"',
    )
    const sdkManifest = JSON.parse(
      await readFile(new URL('../../flow-sdk/package.json', import.meta.url), 'utf8'),
    )
    expect(JSON.parse(await readFile(join(directory, 'flows/hello/package.json'), 'utf8'))).toEqual(
      { private: true, dependencies: { '@jigging/flow': sdkManifest.version } },
    )
    for (const path of ['.jig', 'jig.lock', 'flows/hello/node_modules', 'flows/hello/bun.lock'])
      await expect(lstat(join(directory, path))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(directory, 'README.md'), 'utf8')).toContain('declining cannot undo')
    await expect(createProject(directory)).rejects.toMatchObject({
      code: 'JIG_INIT_DESTINATION_EXISTS',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inspect is read-only and host-free, with exact JSON for subprocesses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-inspect-'))
  try {
    for (const args of [['inspect'], ['inspect', '--json'], ['inspect', '--help']]) {
      let output = ''
      expect(privateCliRequiresHost(args)).toBeFalse()
      expect(
        await main(args, {
          currentDirectory: root,
          host: {
            acquire: async () => {
              throw new Error('must not acquire')
            },
          },
          writeOutput: (text) => {
            output += text
          },
          writeRecord: async (text) => {
            output += text
          },
        }),
      ).toBe(0)
      if (!args.includes('--help'))
        expect(JSON.parse(output)).toEqual({ state: 'unreviewed', targets: [] })
      expect(await readdir(root)).toEqual([])
    }
    let output = ''
    expect(
      await main(['inspect'], {
        currentDirectory: root,
        terminalOutput: true,
        writeOutput: (text) => {
          output += text
        },
      }),
    ).toBe(0)
    expect(output).toContain('No approved revision')
    expect(output).toContain('jig review')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

describe('finite Jig project commands', () => {
  const digest = `sha256:${'a'.repeat(64)}`

  test('help is focused on the selected command and never acquires the host', async () => {
    for (const arguments_ of [
      ['--help'],
      ['init', '--help'],
      ['review', '-h'],
      ['run', '--help'],
    ]) {
      const invocation = commandInvocation(unusedHost())
      expect(await main(arguments_, invocation.options)).toBe(0)
      expect(privateCliRequiresHost(arguments_)).toBe(false)
      expect(invocation.output).toContain('Usage:')
      if (arguments_[0] === 'run') {
        expect(invocation.output).toContain('--timeout DURATION')
        expect(invocation.output).toContain('default: 30s')
        expect(invocation.output).not.toContain('Usage: jig review')
      } else if (arguments_[0] === 'review') {
        expect(invocation.output).toContain('--details')
        expect(invocation.output).toContain('--yes alone does not approve new resource authority')
      } else if (arguments_[0] === 'init') {
        expect(invocation.output).toContain('--bare')
      } else expect(invocation.output).toContain('jig --version')
      expect(invocation.output).not.toContain('package check')
      expect(invocation.error).toBe('')
    }

    const removed = commandInvocation(unusedHost())
    expect(await main(['package', 'check', '.'], removed.options)).toBe(2)
    expect(removed.error).toContain('Usage:')

    const superseded = commandInvocation(unusedHost())
    expect(await main(['check'], superseded.options)).toBe(2)
    expect(superseded.error).toContain('Usage:')
  })

  test('version reports the package version without host acquisition', async () => {
    const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json()
    const invocation = commandInvocation(unusedHost())
    expect(privateCliRequiresHost(['--version'])).toBe(false)
    expect(await main(['--version'], invocation.options)).toBe(0)
    expect(invocation.output).toBe(`${manifest.version}\n`)
    expect(invocation.error).toBe('')

    const extra = commandInvocation(unusedHost())
    expect(await main(['--version', 'extra'], extra.options)).toBe(2)
    expect(extra.output).toBe('')
    expect(extra.error).toContain('Usage:')
  })

  test.each([
    { args: ['run'], reason: 'Choose a target' },
    { args: ['run', 'flow:flows/hello', '--input'], reason: '--input needs a value' },
    {
      args: ['run', 'flow:flows/hello', '--timout', '2m'],
      reason: 'Unknown run option "--timout"',
    },
    { args: ['run', 'flow:flows/hello', '--timeout', '0s'], reason: '--timeout must be' },
    { args: ['review', '--yes', '--yes'], reason: 'repeated review option' },
  ])('syntax diagnostics do not require a supported host: $reason', async ({ args, reason }) => {
    const invocation = commandInvocation(unusedHost())
    expect(privateCliRequiresHost(args)).toBe(false)
    expect(await main(args, invocation.options)).not.toBe(0)
    expect(invocation.error).toContain(reason)
  })

  test('details selects the complete review without changing approval semantics', async () => {
    const events: string[] = []
    const invocation = commandInvocation(
      fakeHost(
        fakeSession(events, {
          plan: {
            state: 'applicable',
            operation: 'admission',
            planDigest: digest,
            review: {
              mediaType: 'text/plain; charset=utf-8',
              authorityChanges: false,
              text: 'summary\n',
              details: 'complete policy\n',
            },
          },
        }),
        events,
      ),
    )
    expect(await main(['review', '--details', '--yes'], invocation.options)).toBe(0)
    expect(invocation.output).toBe(
      'complete policy\nProject ready\n\n  The exact reviewed revision is approved. No Flow was started.\n  Next: jig run <target> (see jig run --help).\n',
    )
    expect(events).toContain(`apply:${digest}`)
  })

  test('terminal status stays off stdout and does not equate blocked with success', async () => {
    const terminal: RootRunTerminal = {
      status: 'succeeded',
      outcome: 'blocked',
      output: { why: 'needs a decision' },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const events: string[] = []
    const invocation = commandInvocation(fakeHost(fakeSession(events, { terminal }), events), {
      terminalOutput: true,
    })
    expect(await main(['run', 'flow:flows/work', '--json'], invocation.options)).toBe(0)
    expect(JSON.parse(invocation.output)).toEqual(terminal)
    expect(invocation.output).toBe(
      '{"diagnostics":{"stderr":"","stderrBytes":0,"stderrTruncated":false},"outcome":"blocked","output":{"why":"needs a decision"},"status":"succeeded"}\n',
    )
    expect(invocation.error).toContain('Application outcome: "blocked"')
    expect(invocation.error).toContain('Stopping remaining work and cleaning up')
    expect(invocation.error).not.toContain('\u001b')
    expect(invocation.error).not.toContain('Success')
  })

  test('interactive runs show a readable result while redirected runs preserve exact JSON', async () => {
    const terminal: RootRunTerminal = {
      status: 'succeeded',
      outcome: 'done',
      output: { answer: 'One answer.\nA second paragraph.', count: 2 },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const events: string[] = []
    const human = commandInvocation(fakeHost(fakeSession(events, { terminal }), events), {
      terminalOutput: true,
    })
    expect(await main(['run', 'flow:flows/work'], human.options)).toBe(0)
    expect(human.output).toContain('Run output: result')
    expect(human.output).toContain('One answer.\n')
    expect(human.output).not.toContain('"diagnostics"')
    expect(human.error).toContain('result above')
    const machine = commandInvocation(fakeHost(fakeSession(events, { terminal }), events), {
      terminalOutput: false,
    })
    expect(await main(['run', 'flow:flows/work'], machine.options)).toBe(0)
    expect(machine.output).toBe(new TextDecoder().decode(canonicalJson(terminal)) + '\n')
  })

  test('explains invalid input before expanding details and names the whole input clearly', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'INVALID_INPUT',
      message: 'input rejected',
      details: {
        instancePointer: '',
        schemaPointer: '/type',
        path: 'input.schema.json',
        typeMismatch: { expected: ['string'], received: 'object' },
      },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const invocation = commandInvocation(fakeHost(fakeSession([], { terminal }), []), {
      terminalOutput: true,
    })
    const transcript: string[] = []
    expect(
      await main(['run', 'flow:flows/work'], {
        ...invocation.options,
        writeError: (text) => {
          transcript.push(text)
          invocation.options.writeError?.(text)
        },
        writeOutput: (text) => {
          transcript.push(text)
          invocation.options.writeOutput?.(text)
        },
      }),
    ).toBe(1)
    const output = transcript.join('')
    expect(output).toContain('Value: entire input')
    expect(output).toMatch(/jig inspect\s+<target>/)
    expect(output).toContain('Run output: result')
    expect(output.indexOf('Expected string; received object.')).toBeLessThan(
      output.indexOf('Run output: result'),
    )
    expect(output).not.toContain('Value: ""')
  })

  test('stale approval requests review, preserves machine details, and does not imply execution', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'REVIEW_REQUIRED',
      message: 'Review required',
      details: {
        reason: 'EXECUTION_ENVIRONMENT_CHANGED',
        flowStarted: false,
      },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    for (const terminalOutput of [true, false]) {
      const invocation = commandInvocation(fakeHost(fakeSession([], { terminal }), []), {
        terminalOutput,
      })
      expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
      expect(invocation.error).toContain('Review required')
      expect(invocation.error).toContain('Run jig review')
      expect(invocation.error).toContain('No Flow was started for this Run.')
      expect(invocation.error).not.toContain('Inspect any effects')
      expect(invocation.output).toBe(
        terminalOutput ? '' : new TextDecoder().decode(canonicalJson(terminal)) + '\n',
      )
    }
  })

  test('Flow-controlled error details cannot claim that execution never started', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'UNAVAILABLE',
      message: 'Flow failure',
      details: {
        code: 'REVIEW_REQUIRED',
        reason: 'EXECUTION_ENVIRONMENT_CHANGED',
        flowStarted: false,
      },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const invocation = commandInvocation(fakeHost(fakeSession([], { terminal }), []), {
      terminalOutput: true,
    })
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
    expect(invocation.error).not.toContain('No Flow was started')
    expect(invocation.error).not.toContain('Run jig review')
    expect(invocation.output).toContain('"details"')
  })

  test.each(['UNAVAILABLE', 'EXECUTION_FAILED'] as const)(
    'retains the reported cause for %s without stderr and preserves exact machine output',
    async (code) => {
      const message =
        'Agent channel "events" requires the ACP public-updates profile, which the selected API client does not implement. Use an operator-configured native ACP client for this Flow, or a Flow that needs only the final Agent result.'
      const terminal: RootRunTerminal = {
        status: 'failed',
        code,
        message,
        diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
      }
      for (const terminalOutput of [true, false]) {
        const invocation = commandInvocation(fakeHost(fakeSession([], { terminal }), []), {
          terminalOutput,
        })
        expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
        expect(invocation.error).toContain('Reported cause:')
        expect(invocation.error.replace(/\s+/g, ' ')).toContain(
          'selected API client does not implement',
        )
        expect(invocation.error.replace(/\s+/g, ' ')).toContain('native ACP client for this Flow')
        expect(invocation.error).not.toContain('did not retain a more specific cause')
        expect(invocation.error).not.toContain('No Flow was started')
        expect(invocation.output).toBe(
          terminalOutput ? '' : new TextDecoder().decode(canonicalJson(terminal)) + '\n',
        )
      }
    },
  )

  test('escapes reported failure text instead of allowing it to forge terminal sections', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'UNAVAILABLE',
      message: 'reported\u001b[2J\nReview required\r\u202e',
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const invocation = commandInvocation(fakeHost(fakeSession([], { terminal }), []), {
      terminalOutput: true,
    })
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
    expect(invocation.error).toContain('reported\\u001b[2J\\u000aReview required\\u000d\\u202e')
    expect(invocation.error).not.toContain('\u001b')
    expect(invocation.error).not.toContain('\u202e')
  })

  test('an unexplained terminal failure reports missing evidence without repeating a raw error block', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'EXECUTION_FAILED',
      message: 'root Run execution failed',
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const events: string[] = []
    const invocation = commandInvocation(fakeHost(fakeSession(events, { terminal }), events), {
      terminalOutput: true,
    })
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
    expect(invocation.output).toBe('')
    expect(invocation.error).toContain('No Flow diagnostic text was captured.')
    expect(invocation.error.replace(/\s+/g, ' ')).toContain(
      'does not establish whether the Flow started.',
    )
    expect(invocation.error).not.toContain('Inspect the result and diagnostics')
    expect(invocation.error).not.toContain('root Run execution failed')
    expect(invocation.error).toContain('Diagnostic code: EXECUTION_FAILED')
  })

  test('protocol failures have safe recovery guidance without changing the JSON result', async () => {
    const terminal: RootRunTerminal = {
      status: 'failed',
      code: 'PROTOCOL_ERROR',
      message: 'invalid root error: standard JSON-RPC errors cannot settle flow/run',
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const events: string[] = []
    const invocation = commandInvocation(fakeHost(fakeSession(events, { terminal }), events))
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
    expect(JSON.parse(invocation.output)).toEqual(terminal)
    expect(invocation.error).toContain('Diagnostic code: JIG_RUN_PROTOCOL_ERROR')
    expect(invocation.error).toContain('Check its SDK version')
    expect(invocation.error).toContain('stdout reserved for protocol messages')
    expect(invocation.error).toContain('Inspect the result and any effects')
    expect(invocation.error).not.toContain('No Flow was started')
  })

  test('cancellation status distinguishes the request from completed cleanup', async () => {
    const events: string[] = [],
      controller = new AbortController()
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { pendingObservations: Infinity }), events, async () => {
        controller.abort()
      }),
      { terminalOutput: true, signal: controller.signal },
    )
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(2)
    expect(invocation.error.indexOf('Cancellation requested')).toBeLessThan(
      invocation.error.indexOf('Cleanup complete'),
    )
    expect(invocation.error).toContain('JIG_COMMAND_INTERRUPTED')
    expect(invocation.output).toBe('')
    expect(events.at(-1)).toBe('close')
  })

  test('missing input identifies the operator-selected file without echoing data', async () => {
    const invocation = commandInvocation(unusedHost())
    expect(
      await main(['run', 'flow:flows/work', '--input', '@missing-input.json'], invocation.options),
    ).toBe(1)
    expect(invocation.error).toContain('File: "missing-input.json"')
    expect(invocation.error).toContain('No Flow was started')
    expect(invocation.error).not.toContain('/project')
  })

  test('occupied output suggests a new destination without replacing it or starting work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-cli-occupied-'))
    try {
      await writeFile(join(root, 'keep'), 'original')
      const invocation = commandInvocation(unusedHost())
      expect(await main(['run', 'flow:flows/work', '--out', root], invocation.options)).toBe(1)
      expect(invocation.error).toContain('JIG_OUTPUT_EXISTS')
      expect(invocation.error).toContain('Choose a new --out')
      expect(await readFile(join(root, 'keep'), 'utf8')).toBe('original')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('review plans a fixed update and closes one unchanged session', async () => {
    const events: string[] = []
    const host = fakeHost(fakeSession(events), events)
    const invocation = commandInvocation(host)

    expect(await main(['review'], invocation.options)).toBe(0)
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
    expect(invocation.output).toBe(
      'Project ready\n\n  The exact reviewed revision is approved. No Flow was started.\n  Next: jig run <target> (see jig run --help).\n',
    )
    expect(invocation.error).toBe('')
  })

  test('review applies its opaque proposal within the same session', async () => {
    const events: string[] = []
    const plan: ProjectPlanResult = {
      state: 'applicable',
      operation: 'admission',
      planDigest: digest,
      review: {
        mediaType: 'text/plain; charset=utf-8',
        authorityChanges: false,
        text: 'review project changes\n',
        details: 'complete review\n',
      },
    }
    const host = fakeHost(fakeSession(events, { plan }), events)
    const invocation = commandInvocation(host)

    expect(await main(['review', 'workspace', '--yes'], invocation.options)).toBe(0)
    expect(events).toEqual(['acquire:workspace', 'plan:update', `apply:${digest}`, 'close'])
    expect(invocation.output).toBe(
      'review project changes\nProject ready\n\n  The exact reviewed revision is approved. No Flow was started.\n  Next: jig run <target> (see jig run --help).\n',
    )
    expect(invocation.output).not.toContain(digest)
    expect(invocation.output).not.toContain('admission')
    expect(invocation.error).toBe('')
  })

  test('new grants require explicit authority approval without complicating ordinary review', async () => {
    for (const args of [
      ['review', '--yes'],
      ['review', '--yes', '--allow-authority-changes'],
      ['review'],
    ]) {
      const events: string[] = []
      const plan: ProjectPlanResult = {
        state: 'applicable',
        operation: 'admission',
        planDigest: digest,
        review: {
          mediaType: 'text/plain; charset=utf-8',
          text: 'Exact endpoint and recipient\n',
          details: 'details\n',
          authorityChanges: true,
        },
      }
      const base = fakeSession(events, { plan })
      let authority: boolean | undefined
      const session = {
        ...base,
        async apply(request: any) {
          authority = request.allowAuthorityChanges
          return base.apply(request)
        },
      }
      const invocation = commandInvocation(fakeHost(session, events), {
        interactive: true,
        confirm: async () => true,
      })
      const code = await main(args, invocation.options)
      if (args.length === 2) {
        expect(code).toBe(2)
        expect(events.some((event) => event.startsWith('apply:'))).toBe(false)
        expect(invocation.error).toContain('--allow-authority-changes')
      } else {
        expect(code).toBe(0)
        expect(authority).toBe(true)
      }
    }
  })

  test('review requires TTY confirmation unless --yes is explicit', async () => {
    const plan: ProjectPlanResult = {
      state: 'applicable',
      operation: 'lock-repair',
      planDigest: digest,
      review: {
        authorityChanges: false,
        mediaType: 'text/plain; charset=utf-8',
        text: 'review\n',
        details: 'details\n',
      },
    }
    const nonInteractiveEvents: string[] = []
    const nonInteractive = commandInvocation(
      fakeHost(fakeSession(nonInteractiveEvents, { plan }), nonInteractiveEvents),
    )
    expect(await main(['review'], nonInteractive.options)).toBe(2)
    expect(nonInteractiveEvents).toEqual(['acquire:/project', 'plan:update', 'close'])
    expect(nonInteractive.output).toBe('review\n')
    expect(nonInteractive.error).toBe(
      'Approval required\n\n  Review the displayed changes. To approve this exact revision without a prompt, rerun jig review --yes (with the same project and resolution options).\n\n  Diagnostic code: JIG_APPROVAL_REQUIRED\n',
    )

    const declinedEvents: string[] = []
    let prompt = ''
    const declined = commandInvocation(
      fakeHost(fakeSession(declinedEvents, { plan }), declinedEvents),
      {
        interactive: true,
        confirm: async (value) => {
          prompt = value
          return false
        },
      },
    )
    expect(await main(['review'], declined.options)).toBe(1)
    expect(prompt).toBe('Approve this exact revision for execution? [y/N] ')
    expect(declinedEvents).toEqual(['acquire:/project', 'plan:update', 'close'])
    expect(declined.error).toBe(
      'Review declined\n\n  The proposed changes were not approved. Your previous approval is unchanged. Dependency requests already made cannot be undone.\n\n  Diagnostic code: JIG_CHANGES_DECLINED\n',
    )
  })

  test.each([false, true])(
    'resolution permission is separate from execution approval (yes=%s)',
    async (yes) => {
      const events: string[] = []
      const plan: ProjectPlanResult = {
        state: 'applicable',
        operation: 'admission',
        planDigest: digest,
        review: {
          authorityChanges: false,
          mediaType: 'text/plain; charset=utf-8',
          text: 'review\n',
          details: 'details\n',
        },
      }
      let received: Parameters<PrivateCliCommandHost['acquire']>[1]
      const host: PrivateCliCommandHost = {
        acquire: async (_path, options) => {
          received = options
          options?.onResolution?.('flows/hello\u001b[31m')
          return fakeSession(events, { plan })
        },
      }
      const invocation = commandInvocation(host)
      expect(
        await main(
          ['review', '--allow-resolution-network', ...(yes ? ['--yes'] : [])],
          invocation.options,
        ),
      ).toBe(yes ? 0 : 2)
      expect(received?.allowResolutionNetwork).toBeTrue()
      expect(invocation.error).toContain('private-network services')
      expect(invocation.error).not.toContain('\u001b')
      expect(events.some((event) => event.startsWith('apply:'))).toBe(yes)
    },
  )

  test('acquisition reports completed verification stages before project recovery', async () => {
    const invocation = commandInvocation(
      {
        async acquire(_path, options) {
          options?.onStage?.('Verifying Agent configuration and runtime')
          options?.onStage?.('Opening project state and checking recovery')
          return fakeSession([], { plan: { state: 'unchanged' } })
        },
      },
      { interactive: true, terminalOutput: true },
    )
    expect(await main(['review'], invocation.options)).toBe(0)
    const stages = [
      'Verifying Jig runtime',
      'Verifying Agent configuration and runtime',
      'Opening project state and checking recovery',
    ]
    for (const stage of stages) expect(invocation.error).toContain(stage)
    expect(invocation.error.indexOf(stages[0]!)).toBeLessThan(invocation.error.indexOf(stages[1]!))
    expect(invocation.error.indexOf(stages[1]!)).toBeLessThan(invocation.error.indexOf(stages[2]!))
    expect(invocation.error).not.toContain('Checking project prerequisites')
  })

  test('yes alone does not grant resolution and a later invocation does not inherit it', async () => {
    const received: Parameters<PrivateCliCommandHost['acquire']>[1][] = []
    const host: PrivateCliCommandHost = {
      acquire: async (_path, options) => {
        received.push(options)
        return fakeSession([], { plan: { state: 'unchanged' } })
      },
    }
    for (const args of [
      ['review', '--allow-resolution-network', '--yes'],
      ['review', '--yes'],
    ]) {
      expect(await main(args, commandInvocation(host).options)).toBe(0)
    }
    expect(received[0]?.allowResolutionNetwork).toBeTrue()
    expect(received[1]?.allowResolutionNetwork).toBeUndefined()
  })

  test.each([
    ['run', 'flow:flows/a', '--allow-resolution-network'],
    ['review', '--allow-resolution-network', '--allow-resolution-network'],
  ])('rejects misplaced or duplicate resolution permission: %j', async (args) => {
    const invocation = commandInvocation(fakeHost(fakeSession([]), []))
    expect(await main(args, invocation.options)).toBe(2)
    expect(invocation.error).toContain('Usage:')
  })

  test('contract generation is explicit and does not grant resolution or execution approval', async () => {
    const received: Parameters<PrivateCliCommandHost['acquire']>[1][] = []
    const events: string[] = []
    const host: PrivateCliCommandHost = {
      acquire: async (_path, options) => {
        received.push(options)
        options?.onGeneration?.('flows/hello\u001b', ['FLOW.contract.json'])
        return fakeSession(events, {
          plan: {
            state: 'applicable',
            operation: 'admission',
            planDigest: digest,
            review: {
              mediaType: 'text/plain; charset=utf-8',
              authorityChanges: false,
              text: 'review\n',
              details: 'details\n',
            },
          },
        })
      },
    }
    const invocation = commandInvocation(host)
    expect(await main(['review', '--generate-contracts'], invocation.options)).toBe(2)
    expect(received[0]?.generateContracts).toBeTrue()
    expect(received[0]?.allowResolutionNetwork).toBeUndefined()
    expect(invocation.error).toContain('These writes do not approve execution')
    expect(invocation.error).not.toContain('\u001b')
    expect(events.some((event) => event.startsWith('apply:'))).toBeFalse()
    await main(['review', '--yes'], commandInvocation(host).options)
    expect(received[1]?.generateContracts).toBeUndefined()
  })

  test.each([
    ['review', '--generate'],
    ['review', '--generate-contracts', '--generate-contracts'],
    ['run', 'flow:flows/a', '--generate-contracts'],
  ])('rejects vague, duplicate or misplaced contract generation: %j', async (args) => {
    const events: string[] = []
    const invocation = commandInvocation(fakeHost(fakeSession(events), events))
    expect(await main(args, invocation.options)).toBe(2)
    expect(events).toEqual([])
  })

  test('run uses the current project, explicit Flow target, default input, and no planning', async () => {
    const events: string[] = []
    const terminal: RootRunTerminal = {
      status: 'succeeded',
      outcome: 'done',
      output: { ok: true },
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    let request: StartRootRunRequest | undefined
    let acquisition: { readonly runTimeoutMs?: number } | undefined
    const host = fakeHost(
      fakeSession(events, {
        terminal,
        captureRequest: (value) => {
          request = value
        },
        pendingObservations: 1,
      }),
      events,
      async () => {
        events.push('pause')
      },
      (value) => {
        acquisition = value
      },
    )
    const invocation = commandInvocation(host, { createSubmissionId: () => 'private-submission' })

    expect(await main(['run', 'flow:./flows/work'], invocation.options)).toBe(0)
    expect(acquisition).toMatchObject({ runTimeoutMs: 30_000, channelOutput: { receive: [] } })
    expect(request).toEqual({
      submissionId: 'private-submission',
      target: { kind: 'flow', path: 'flows/work' },
      input: {},
    })
    expect(events).toEqual(['acquire:/project', 'start', 'status', 'pause', 'status', 'close'])
    expect(events).not.toContain('plan:update')
    expect(JSON.parse(invocation.output)).toEqual(terminal)
    expect(invocation.output).not.toContain(digest)
    expect(invocation.output).not.toContain('private-submission')
    expect(invocation.error).toBe('')
  })

  test.each(['closed', 'failed'] as const)(
    'selected channels use distinct records and preserve the actual result after %s observation',
    async (endStatus) => {
      const events: string[] = []
      const session = fakeSession(events)
      const progress = [
        { type: 'begin', channel: 'updates', startSequence: 1 },
        {
          type: 'data',
          channel: 'updates',
          sequence: 1,
          value: { type: 'terminal', result: { status: 'succeeded' } },
        },
        endStatus === 'closed'
          ? { type: 'end', channel: 'updates', status: 'closed', lastSequence: 1 }
          : { type: 'end', channel: 'updates', status: 'failed', code: 'LAGGED' },
      ]
      const host: PrivateCliCommandHost = {
        async acquire(_path, options) {
          const output = options?.channelOutput
          if (output === undefined) throw new Error('missing channel output')
          expect(output.receive).toEqual(['updates'])
          return {
            ...session,
            rootAdministration: {
              ...session.rootAdministration,
              async runStatus(request) {
                for (const record of progress) await output.record(record)
                return session.rootAdministration.runStatus(request)
              },
            },
          }
        },
      }
      const invocation = commandInvocation(host)
      expect(await main(['run', 'binding:work', '--receive', 'updates'], invocation.options)).toBe(
        0,
      )
      const records = invocation.output
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(records.slice(0, 3)).toEqual(progress)
      expect(records[3]).toEqual({
        type: 'terminal',
        result: {
          status: 'succeeded',
          outcome: 'done',
          output: null,
          diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
        },
      })
      expect(records.filter((record) => record.type === 'terminal')).toHaveLength(1)
      expect(events.at(-1)).toBe('close')
      expect(invocation.error).toBe('')
    },
  )

  test('terminal channel output joins fragments; --json retains the exact NDJSON records', async () => {
    const records = [
      { type: 'begin', channel: 'progress', startSequence: 1 },
      { type: 'data', channel: 'progress', sequence: 1, value: 'One' },
      { type: 'data', channel: 'progress', sequence: 2, value: ' answer.' },
      { type: 'end', channel: 'progress', status: 'closed', lastSequence: 2 },
    ] as const
    const host: PrivateCliCommandHost = {
      async acquire(_path, options) {
        for (const record of records) await options!.channelOutput!.record(record)
        return fakeSession([])
      },
    }
    const human = commandInvocation(host, { terminalOutput: true })
    expect(await main(['run', 'binding:work', '--receive', 'progress'], human.options)).toBe(0)
    expect(human.output).toContain('One answer.\n')
    expect(human.output).toContain('Channel "progress": closed')
    expect(human.output).not.toContain('"sequence"')
    const machine = commandInvocation(host, { terminalOutput: true })
    expect(
      await main(['run', 'binding:work', '--json', '--receive', 'progress'], machine.options),
    ).toBe(0)
    expect(machine.output).toStartWith(
      records.map((record) => new TextDecoder().decode(canonicalJson(record)) + '\n').join(''),
    )
    expect(JSON.parse(machine.output.trimEnd().split('\n').at(-1)!)).toMatchObject({
      type: 'terminal',
      result: { status: 'succeeded' },
    })
  })

  test('live Flow diagnostics stay on stderr, escape controls, and retain fragmented UTF-8', async () => {
    const invocation = commandInvocation({
      async acquire(_path, options) {
        const output = options?.channelOutput
        if (output === undefined) throw new Error('missing diagnostic output')
        const euro = new TextEncoder().encode('€')
        output.diagnostic(euro.subarray(0, 1))
        output.diagnostic(euro.subarray(1))
        output.diagnostic(new Uint8Array([27, 91, 51, 49, 109, 13, 0, 9, 10]))
        return fakeSession([])
      },
    })
    expect(await main(['run', 'binding:work', '--receive', 'updates'], invocation.options)).toBe(0)
    expect(invocation.error).toBe('€\\u001b[31m\\u000d\\u0000\t\n')
    expect(JSON.parse(invocation.output)).toMatchObject({
      type: 'terminal',
      result: { status: 'succeeded' },
    })
    expect(invocation.output).not.toContain('€')
    expect(invocation.output).not.toContain('[31m')
  })

  test.each(
    [
      ['--receive'],
      ['--receive', 'updates', '--receive', 'updates'],
      ['--receive', '../updates'],
      ['--receive', 'Updates'],
      ['--receive', 'x'.repeat(65)],
      Array.from({ length: 17 }, (_, index) => ['--receive', `updates-${index}`]).flat(),
    ].map((selection) => [selection]),
  )('invalid channel selections fail before acquiring the project: %j', async (selection) => {
    let acquired = false
    const invocation = commandInvocation({
      async acquire() {
        acquired = true
        return fakeSession([])
      },
    })
    expect(await main(['run', 'binding:work', ...selection], invocation.options)).toBe(2)
    expect(acquired).toBeFalse()
    expect(invocation.output).toBe('')
    expect(invocation.error).toContain('--receive')
  })

  test('a rejected live record closes owned work and never fabricates a terminal record', async () => {
    const events: string[] = []
    const accepted: unknown[] = []
    const session = fakeSession(events)
    const invocation = commandInvocation(
      {
        async acquire(_path, options) {
          const output = options?.channelOutput
          if (output === undefined) throw new Error('missing channel output')
          return {
            ...session,
            rootAdministration: {
              ...session.rootAdministration,
              async runStatus(request) {
                await output.record({ type: 'begin', channel: 'updates', startSequence: 1 })
                await output.record({
                  type: 'data',
                  channel: 'updates',
                  sequence: 1,
                  value: 'work',
                })
                return session.rootAdministration.runStatus(request)
              },
            },
          }
        },
      },
      {
        async writeRecord(text) {
          const record = JSON.parse(text)
          if (record.type === 'data') throw new Error('private writer failure')
          accepted.push(record)
        },
      },
    )
    expect(await main(['run', 'binding:work', '--receive', 'updates'], invocation.options)).toBe(2)
    expect(accepted).toEqual([{ type: 'begin', channel: 'updates', startSequence: 1 }])
    expect(events).toEqual(['start', 'close'])
    expect(invocation.output).toBe('')
    expect(invocation.error).not.toContain('private writer failure')
  })

  test('run accepts timeout units and input in either option order', async () => {
    const cases = [
      { input: 'ms', timeoutMs: 1, options: ['--timeout', '1ms', '--input', '{"case":"ms"}'] },
      { input: 's', timeoutMs: 2_000, options: ['--input', '{"case":"s"}', '--timeout', '2s'] },
      { input: 'm', timeoutMs: 180_000, options: ['--timeout', '3m', '--input', '{"case":"m"}'] },
      {
        input: 'h',
        timeoutMs: 86_400_000,
        options: ['--input', '{"case":"h"}', '--timeout', '24h'],
      },
    ] as const

    for (const { input, timeoutMs, options } of cases) {
      const events: string[] = []
      let request: StartRootRunRequest | undefined
      let acquisition: { readonly runTimeoutMs?: number } | undefined
      const invocation = commandInvocation(
        fakeHost(
          fakeSession(events, {
            captureRequest: (value) => {
              request = value
            },
          }),
          events,
          undefined,
          (value) => {
            acquisition = value
          },
        ),
        {
          createSubmissionId: () => 'timeout-submission',
        },
      )

      expect(await main(['run', 'binding:review', ...options], invocation.options)).toBe(0)
      expect(acquisition).toMatchObject({ runTimeoutMs: timeoutMs, channelOutput: { receive: [] } })
      expect(request).toEqual({
        submissionId: 'timeout-submission',
        target: { kind: 'binding', id: 'review' },
        input: { case: input },
      })
      expect(invocation.error).toBe('')
    }
  })

  test('file input is acquired once after pure lifetime parsing, while quoted @ stays JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-cli-input-'))
    try {
      const file = join(root, 'issue.json')
      const alias = join(root, 'alias')
      await symlink(root, alias)
      const args = ['run', 'flow:flows/work', '--input', `@${join(alias, 'issue.json')}`]
      expect(privateCliCommandLifetimeMs(args)).toBe(330_000)
      await writeFile(file, '{"captured":true}')
      let request: StartRootRunRequest | undefined
      const events: string[] = []
      const invocation = commandInvocation(
        fakeHost(
          fakeSession(events, {
            captureRequest: (value) => {
              request = value
            },
          }),
          events,
        ),
      )
      expect(await main(args, invocation.options)).toBe(0)
      expect(request?.input).toEqual({ captured: true })
      expect(
        await main(['run', 'flow:flows/work', '--input', '"@not-a-path"'], invocation.options),
      ).toBe(0)
      expect(request?.input).toBe('@not-a-path')
      await symlink(file, join(root, 'link'))
      const rejected = commandInvocation(unusedHost())
      expect(
        await main(
          ['run', 'flow:flows/work', '--input', `@${join(root, 'link')}`],
          rejected.options,
        ),
      ).toBe(1)
      expect(rejected.output).toBe('')
      expect(rejected.error).toContain('--input file cannot be a symbolic link')
      const missing = commandInvocation(unusedHost())
      expect(
        await main(
          ['run', 'flow:flows/work', '--input', `@${join(root, 'missing.json')}`],
          missing.options,
        ),
      ).toBe(1)
      expect(missing.error).toContain('the selected --input file does not exist')
      await writeFile(join(root, 'malformed.json'), '{"missing":}')
      const malformed = commandInvocation(unusedHost())
      expect(
        await main(
          ['run', 'flow:flows/work', '--input', `@${join(root, 'malformed.json')}`],
          malformed.options,
        ),
      ).toBe(1)
      expect(malformed.error).toContain('the selected --input file is not FLOW JSON/1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('file option mistakes fail before project acquisition', async () => {
    for (const options of [
      ['--select', 'source=file'],
      ['--attach', 'source=.', '--attach', 'source=.'],
      ['--attach', 'source=.', '--select', 'source=../escape'],
      ['--attach', 'source=.', '--select', 'source=a', '--select', 'source=a'],
      ['--attach', 'bad--name=.'],
    ]) {
      const invocation = commandInvocation(unusedHost())
      expect(await main(['run', 'flow:flows/work', ...options], invocation.options)).toBe(1)
      expect(invocation.output).toBe('')
    }
  })

  test('file capture diagnostics distinguish unsupported storage and size limits without host paths', async () => {
    const unsupported = commandInvocation(unusedHost())
    expect(
      await main(['run', 'flow:flows/work', '--attach', 'source=/proc'], unsupported.options),
    ).toBe(1)
    expect(unsupported.error).toContain('ext4, XFS, Btrfs, or tmpfs')
    expect(unsupported.error).not.toContain('/proc')
    const root = await mkdtemp(join(tmpdir(), 'jig-cli-file-limit-'))
    try {
      await writeFile(join(root, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1))
      const bounded = commandInvocation(unusedHost())
      expect(
        await main(['run', 'flow:flows/work', '--attach', `source=${root}`], bounded.options),
      ).toBe(1)
      expect(bounded.error).toContain('remaining 8388608-byte input budget')
      expect(bounded.error).not.toContain(root)
      expect(bounded.output).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('missing admitted file mappings have actionable bounded diagnostics, not an internal failure', async () => {
    const events: string[] = []
    const invocation = commandInvocation(
      fakeHost(
        fakeSession(events, {
          captureRequest: () => {
            throw new RootAdministrationError('INVALID_REQUEST', 'private message', {
              code: 'RUN_ATTACHMENTS_INVALID',
            })
          },
        }),
        events,
      ),
    )
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(1)
    expect(invocation.output).toBe('')
    expect(invocation.error).toContain('supply exactly')
    expect(invocation.error).not.toContain('private message')
  })

  test.each(['ADMISSION_MISSING', 'STALE_PLAN'])(
    'run explains %s without private error text',
    async (code) => {
      const events: string[] = []
      const invocation = commandInvocation(
        fakeHost(
          fakeSession(events, {
            captureRequest: () => {
              throw new RootAdministrationError('UNAVAILABLE', 'secret /private/path', { code })
            },
          }),
          events,
        ),
      )
      expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(2)
      expect(invocation.output).toBe('')
      expect(invocation.error).toBe(
        `Error: Command could not finish\n\n  the project has no usable reviewed revision; complete jig review before running\n\n  Diagnostic code: ${code}\n`,
      )
    },
  )

  test('a late Session cleanup failure preserves its already known execution terminal', async () => {
    const events: string[] = []
    const session = fakeSession(events)
    const invocation = commandInvocation(
      fakeHost(
        {
          ...session,
          async close() {
            throw new Error('private close failure')
          },
        },
        events,
      ),
    )
    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(2)
    expect(JSON.parse(invocation.output)).toMatchObject({
      status: 'succeeded',
      outcome: 'done',
      cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' },
    })
    expect(invocation.error).not.toContain('private close failure')
  })

  test('file report limits do not discard an already settled large terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-cli-large-result-'))
    try {
      for (let i = 0; i < 16; i++) await writeFile(join(root, `file-${i}`), '')
      const terminal: RootRunTerminal = {
        status: 'succeeded',
        outcome: 'done',
        output: ['x'.repeat(8 * 1024 * 1024), 'y'.repeat(8 * 1024 * 1024 - 1024)],
        diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
      }
      expect(canonicalJson(terminal).length).toBeLessThan(JSON_1_LIMITS.bytes)
      const events: string[] = []
      const invocation = commandInvocation({
        ...fakeHost(fakeSession(events, { terminal }), events),
        delivery: {
          async prepare() {},
          async publish(record) {
            canonicalJson(record)
            throw new Error('expanded record unexpectedly fit')
          },
        },
      })
      expect(
        await main(
          ['run', 'flow:flows/work', '--attach', `source=${root}`, '--out', `${root}-review`],
          invocation.options,
        ),
      ).toBe(2)
      expect(JSON.parse(invocation.output).output).toEqual(terminal.output)
      expect(JSON.parse(invocation.output).status).toBe('succeeded')
      expect(invocation.error).toContain('JIG_REPORT_LIMIT')
      expect(events.filter((event) => event === 'start')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('run rejects malformed, zero, overflowing, and over-limit timeouts before acquisition', async () => {
    for (const duration of [
      '',
      '0ms',
      '01ms',
      '+1s',
      '1.5s',
      '1',
      '1d',
      '24h1m',
      '25h',
      '86400001ms',
      '9007199254740992ms',
    ]) {
      const invocation = commandInvocation(unusedHost())
      expect(
        await main(['run', 'flow:flows/work', '--timeout', duration], invocation.options),
        duration,
      ).toBe(1)
      expect(invocation.error).toBe(
        'Error: Command could not finish\n\n  --timeout must be a positive integer followed by ms, s, m, or h, up to 24h\n\n  Diagnostic code: JIG_RUN_TIMEOUT_INVALID\n',
      )
    }

    const duplicate = commandInvocation(unusedHost())
    expect(
      await main(
        ['run', 'flow:flows/work', '--timeout', '1s', '--timeout', '2s'],
        duplicate.options,
      ),
    ).toBe(2)
    expect(duplicate.error).toContain('Usage:')
  })

  test('installed command lifetime encloses Run cleanup without extending invalid commands', () => {
    expect(privateCliCommandLifetimeMs(['run', 'flow:flows/work'])).toBe(330_000)
    expect(
      privateCliCommandLifetimeMs(['run', 'flow:flows/work', '--input', '{}', '--timeout', '24h']),
    ).toBe(86_700_000)
    expect(privateCliCommandLifetimeMs(['run', 'flow:flows/work', '--timeout', 'invalid'])).toBe(
      300_000,
    )
    expect(privateCliCommandLifetimeMs(['review'])).toBe(300_000)
  })

  test('run parses bounded JSON/1 and maps failure and loss to stable exits', async () => {
    const cases: readonly [RootRunTerminal, number][] = [
      [
        {
          status: 'failed',
          code: 'INVALID_RESULT',
          message: 'result rejected',
          details: { field: 'output' },
          diagnostics: { stderr: 'bad', stderrBytes: 3, stderrTruncated: false },
        },
        1,
      ],
      [{ status: 'lost', code: 'COORDINATOR_LOST', message: 'owner lost' }, 2],
    ]
    for (const [terminal, expectedExit] of cases) {
      const events: string[] = []
      let request: StartRootRunRequest | undefined
      const invocation = commandInvocation(
        fakeHost(
          fakeSession(events, {
            terminal,
            captureRequest: (value) => {
              request = value
            },
          }),
          events,
        ),
      )
      expect(
        await main(
          ['run', 'binding:review', '--input', '{"task":"build","count":2}'],
          invocation.options,
        ),
      ).toBe(expectedExit)
      expect(request?.target).toEqual({ kind: 'binding', id: 'review' })
      expect(request?.input).toEqual({ task: 'build', count: 2 })
      expect(JSON.parse(invocation.output)).toEqual(terminal)
      expect(Object.keys(JSON.parse(invocation.output))).not.toContain('runId')
      if (terminal.status === 'succeeded') expect(invocation.error).toBe('')
      else {
        expect(invocation.error).toContain(`Diagnostic code: ${terminal.code}`)
        expect(invocation.error).toContain(
          terminal.status === 'lost' ? 'Effects may be uncertain' : 'Inspect any effects',
        )
      }
    }
  })

  test('run rejects invalid target and JSON/1 before acquiring a project', async () => {
    const target = commandInvocation(unusedHost())
    expect(await main(['run', 'work'], target.options)).toBe(1)
    expect(target.error).toBe(
      'Error: Run target is invalid\n\n  use flow:<path>, npm:<package> or binding:<id>, for example flow:flows/hello. Run jig review after adding a target.\n\n  Diagnostic code: JIG_RUN_TARGET_INVALID\n',
    )

    const input = commandInvocation(unusedHost())
    expect(await main(['run', 'flow:flows/work', '--input', '{"x":1,"x":2}'], input.options)).toBe(
      1,
    )
    expect(input.error).toBe(
      'Error: Run input is invalid\n\n  --input must be valid JSON; quote inline JSON or use --input @file.json. No Flow was started.\n\n  Diagnostic code: JIG_RUN_INPUT_INVALID\n',
    )

    const usage = commandInvocation(unusedHost())
    expect(await main(['review', '--yes', 'project', 'extra'], usage.options)).toBe(2)
    expect(usage.error).toContain('Usage:')
  })

  test('interrupting a pending Run closes the session and reports no private state', async () => {
    const events: string[] = []
    const controller = new AbortController()
    const host = fakeHost(
      fakeSession(events, {
        terminal: { status: 'lost', code: 'COORDINATOR_LOST', message: 'unused' },
        pendingObservations: Number.POSITIVE_INFINITY,
      }),
      events,
      async () => {
        events.push('pause')
        controller.abort()
      },
    )
    const invocation = commandInvocation(host, { signal: controller.signal })

    expect(await main(['run', 'flow:flows/work'], invocation.options)).toBe(2)
    expect(events).toEqual(['acquire:/project', 'start', 'status', 'pause', 'close'])
    expect(invocation.output).toBe('')
    expect(invocation.error).toBe(
      'Command interrupted\n\n  The command was interrupted. Inspect any result and completed steps before starting new work; cancellation does not undo completed effects.\n\n  Diagnostic code: JIG_COMMAND_INTERRUPTED\n',
    )
  })

  test.each([{ args: ['review'] }, { args: ['review', '--allow-resolution-network'] }])(
    'unreadable state explains recovery without exposing stored data: %j',
    async ({ args }) => {
      const invocation = commandInvocation({
        async acquire() {
          throw new ProjectAdministrationError(
            'PROJECT_STATE_INVALID',
            'private stored candidate detail',
          )
        },
      })
      expect(await main(args, invocation.options)).toBe(1)
      expect(invocation.output).toBe('')
      expect(invocation.error).toBe(
        'Error: Command could not finish\n\n  the retained .jig state is incompatible with this Jig build or damaged; preserve .jig and jig.lock for recovery. Once prior work is confirmed stopped and cleaned up, move them outside the project and run jig review again\n\n  Diagnostic code: PROJECT_STATE_INVALID\n',
      )
      expect(invocation.error).not.toContain('private stored candidate')
    },
  )

  test('unexpected failures are closed without leaking their messages', async () => {
    const invocation = commandInvocation({
      async acquire() {
        throw new Error('ENOENT /private/project/.jig/store.sqlite')
      },
    })
    expect(await main(['review', 'project', '--yes'], invocation.options)).toBe(2)
    expect(invocation.error).toBe(
      'Error: Command could not finish\n\n  The cause could not be determined. Inspect the result and any effects before starting new work. Check https://jig.md/guide/results and include this diagnostic code when reporting the failure.\n\n  Diagnostic code: JIG_COMMAND_UNAVAILABLE\n',
    )
  })

  test('renders invalid project diagnostics with terminal-safe relative locations', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError(
      'INVALID_CANDIDATE',
      'project candidate is invalid',
      {
        code: 'PROJECT_BINDING_SETTINGS_INVALID',
        path: 'bindings/review-\u202e.ts',
        pointer: '/settings/prefix\n',
        typeMismatch: { expected: ['string'], received: 'integer' },
      },
    )
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )

    expect(await main(['review', '--yes'], invocation.options)).toBe(1)
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
    expect(invocation.output).toBe('')
    expect(invocation.error).toBe(
      'Review could not finish\n\n  Location: "bindings/review-\\u202e.ts"\n  Value: "/settings/prefix\\u000a"\n  Expected string; received integer.\n\n  Next step\n    Binding settings do not match the Flow settings schema; correct the indicated value\n\n  Diagnostic code: PROJECT_BINDING_SETTINGS_INVALID\n  Category: INVALID_CANDIDATE\n',
    )
    expect(invocation.error).not.toContain('\u202e')
  })

  test('channel declaration failures identify the public contract and source location', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError('INVALID_CANDIDATE', 'private parser detail', {
      code: 'CHANNEL_FIELD',
      path: 'flows/worker/FLOW.contract.json',
    })
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review', '--yes'], invocation.options)).toBe(1)
    expect(invocation.error).toBe(
      'Review could not finish\n\n  Location: "flows/worker/FLOW.contract.json"\n\n  Next step\n    check channel declarations and descriptors against FLOW Channel Contract/1\n\n  Diagnostic code: CHANNEL_FIELD\n  Category: INVALID_CANDIDATE\n',
    )
    expect(invocation.error).not.toContain('private parser detail')
  })

  test('author evaluation guidance includes the allowed project fields without echoing an exception', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError('INVALID_CANDIDATE', 'secret /private/file', {
      code: 'PROJECT_EVALUATION_FAILED',
      path: 'jig.ts',
    })
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review', '--yes'], invocation.options)).toBe(1)
    expect(invocation.error).toContain('unknown fields, invalid values')
    expect(invocation.error).toContain(
      'defineJig accepts only flows, bindings, grants and defaultProviders',
    )
    expect(invocation.error).toContain('Location: "jig.ts"')
    expect(invocation.error).toContain('Diagnostic code: PROJECT_EVALUATION_FAILED')
    expect(invocation.error).not.toContain('secret')
    expect(invocation.error).not.toContain('/private/file')
  })

  test('evaluation limits explain bounded authoring and host pressure without relaxing execution', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError(
      'INVALID_CANDIDATE',
      'private evaluator detail',
      {
        code: 'PROJECT_EVALUATION_LIMIT',
        path: 'jig.ts',
      },
    )
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review', '--yes'], invocation.options)).toBe(1)
    expect(invocation.error).toContain('exceeded its resource or time limit')
    expect(invocation.error).toContain('check host load before retrying review')
    expect(invocation.error).toContain('No Flow was started')
    expect(invocation.error).not.toContain('private evaluator detail')
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
  })

  test('renders a bounded package unavailability without exposing its private message', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError(
      'UNAVAILABLE',
      'private preparation message and /private/path',
      {
        code: 'PACKAGE_BUN_SOURCE_UNSUPPORTED',
        path: 'flows/dependent/bun.lock',
      },
    )
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )

    expect(await main(['review', '--yes'], invocation.options)).toBe(2)
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
    expect(invocation.output).toBe('')
    expect(invocation.error).toBe(
      'Review could not finish\n\n  Location: "flows/dependent/bun.lock"\n\n  Next step\n    use default npm registry dependencies or declared workspace members; patches require workspace-root declarations and captured .patch files; overrides and other dependency sources are unsupported\n\n  Diagnostic code: PACKAGE_BUN_SOURCE_UNSUPPORTED\n  Category: UNAVAILABLE\n',
    )
    expect(invocation.error).not.toContain('private preparation message')
    expect(invocation.error).not.toContain('/private/path')
  })

  test.each([
    [
      'PACKAGE_BUN_NODE_MODULES',
      'flows/drafter/node_modules',
      'move generated node_modules outside the Flow package; jig review prepares its locked production dependencies',
    ],
    [
      'PACKAGE_BUN_PREPARATION_FAILED',
      'flows/drafter/package.json',
      'locked dependencies could not be prepared; check registry access and package availability',
    ],
    [
      'PACKAGE_BUN_RESOLUTION_VERSION_UNAVAILABLE',
      'flows/chat/package.json',
      'a requested dependency version or tag is unavailable in the registry; check package.json against published versions or use a declared local workspace dependency',
    ],
  ])('renders actionable %s without private error text', async (code, path, guidance) => {
    const events: string[] = []
    const failure = new ProjectAdministrationError('UNAVAILABLE', 'secret-token /private/host', {
      code,
      path,
    })
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review'], invocation.options)).toBe(2)
    expect(invocation.error).toBe(
      `Review could not finish\n\n  Location: "${path}"\n\n  Next step\n    ${guidance}\n\n  Diagnostic code: ${code}\n  Category: UNAVAILABLE\n`,
    )
    expect(invocation.error).not.toContain('secret-token')
    expect(invocation.error).not.toContain('/private/host')
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
  })

  test('ACP grant failure explains its selected runtime', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError('UNAVAILABLE', 'secret-token /private/runtime', {
      code: 'PROJECT_ACP_UNAVAILABLE',
      path: 'flows/agent/FLOW.ts',
    })
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review'], invocation.options)).toBe(2)
    expect(invocation.error).toContain('native client named in the affected ACP grant')
    expect(invocation.error).toContain('operator executable, model and authentication')
    expect(invocation.error).toContain('retry jig review')
    expect(invocation.error).toContain('PROJECT_ACP_UNAVAILABLE')
    expect(invocation.error).not.toContain('secret-token')
    expect(invocation.error).not.toContain('/private/runtime')
    expect(events).toEqual(['acquire:/project', 'plan:update', 'close'])
  })

  test('a missing selected Binding has an actionable configuration error', async () => {
    const events: string[] = []
    const failure = new ProjectAdministrationError(
      'INVALID_CANDIDATE',
      'project candidate is invalid',
      {
        code: 'PROJECT_DEFAULT_MISSING',
        path: 'jig.ts',
        pointer: '/defaultProviders',
      },
    )
    const invocation = commandInvocation(
      fakeHost(fakeSession(events, { planFailure: failure }), events),
    )
    expect(await main(['review'], invocation.options)).toBe(1)
    expect(invocation.error).toContain('PROJECT_DEFAULT_MISSING')
    expect(invocation.error).toContain('missing Flow or Binding')
    expect(invocation.error).toContain('Provider selection does not create Bindings')
    expect(invocation.error).not.toContain('INTERNAL')
  })

  interface FakeSessionOptions {
    readonly plan?: ProjectPlanResult
    readonly planFailure?: unknown
    readonly terminal?: RootRunTerminal
    readonly captureRequest?: (request: StartRootRunRequest) => void
    readonly pendingObservations?: number
  }

  function fakeSession(events: string[], options: FakeSessionOptions = {}): ProjectSession {
    let observations = 0
    let closure: Promise<void> | undefined
    const terminal = options.terminal ?? {
      status: 'succeeded' as const,
      outcome: 'done',
      output: null,
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
    }
    const rootAdministration: RootAdministration = {
      async startRun(request) {
        events.push('start')
        options.captureRequest?.(request)
        return { runId: digest }
      },
      async runStatus(): Promise<RootRunStatus> {
        events.push('status')
        observations += 1
        const common = {
          runId: digest,
          submissionId: 'private-submission',
          target: { kind: 'flow' as const, path: 'flows/work' },
        }
        return observations <= (options.pendingObservations ?? 0)
          ? { ...common, state: 'pending' }
          : { ...common, state: 'terminal', terminal }
      },
    }
    return {
      rootAdministration,
      async plan(request) {
        events.push(`plan:${request.lockMode}`)
        if (options.planFailure !== undefined) throw options.planFailure
        return options.plan ?? { state: 'unchanged' }
      },
      async apply(request) {
        events.push(`apply:${request.planDigest}`)
        return { operation: 'admission', planDigest: request.planDigest }
      },
      close() {
        closure ??= Promise.resolve().then(() => {
          events.push('close')
        })
        return closure
      },
    }
  }

  function fakeHost(
    session: ProjectSession,
    events: string[],
    pause?: (milliseconds: number) => Promise<void>,
    captureAcquisition?: (options: { readonly runTimeoutMs?: number } | undefined) => void,
  ): PrivateCliCommandHost {
    return {
      async acquire(project, options) {
        events.push(`acquire:${project}`)
        captureAcquisition?.(options)
        return session
      },
      ...(pause === undefined ? {} : { pause }),
    }
  }

  function unusedHost(): PrivateCliCommandHost {
    return {
      async acquire(): Promise<ProjectSession> {
        throw new Error('project acquisition was not expected')
      },
    }
  }

  function commandInvocation(
    host: PrivateCliCommandHost,
    extra: Omit<PrivateCliOptions, 'host' | 'currentDirectory' | 'writeOutput' | 'writeError'> = {},
  ): {
    readonly options: PrivateCliOptions
    readonly output: string
    readonly error: string
  } {
    const capture = { output: '', error: '' }
    const options: PrivateCliOptions = {
      host,
      currentDirectory: '/project',
      interactive: false,
      ...extra,
      writeOutput: (text) => {
        capture.output += text
      },
      writeError: (text) => {
        capture.error += text
      },
    }
    return {
      options,
      get output() {
        return capture.output
      },
      get error() {
        return capture.error
      },
    }
  }
})
