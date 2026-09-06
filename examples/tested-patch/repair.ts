import { constants } from 'node:fs'
import { type FileHandle, mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { sha256 } from './flows/repair/policy.ts'
import { type Acceptance, inspect } from './packet.ts'
import { capture } from './snapshot.ts'

const HELP = `Obtain a tested patch without modifying the original repository.

bun repair.ts --repo DIRECTORY --edit src/utility.ts --issue TEXT --out NEW_DIRECTORY
              [--file PATH ...] [--jig EXECUTABLE]

Run from your reviewed copy of this application. --edit selects the only editable
file; --file adds read-only context. No other repository files are read or run.
Output must be a new directory outside the repository, in an existing parent.
The selected text is sent to your configured Agent (at most two calls, five minutes).
Ctrl-C requests cancellation and waits for Jig. Nothing is applied or retried.
Exit: 0 review-ready patch; 1 unsuccessful; 2 input/execution/evidence error; 130 interrupted.`

export async function main(args: string[], signal: AbortSignal): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      edit: { type: 'string' },
      issue: { type: 'string' },
      out: { type: 'string' },
      file: { type: 'string', multiple: true },
      jig: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  if (values.help) {
    console.log(HELP)
    return 0
  }
  if (!values.repo || !values.edit || !values.issue || !values.out) throw new Error(HELP)
  signal.throwIfAborted()
  const { repository, input } = await capture(
    values.repo,
    values.edit,
    values.file ?? [],
    values.issue,
  )
  const jig = Bun.which(values.jig ?? 'jig')
  if (!jig)
    throw new Error(
      'Jig executable not found. Install the supported candidate or supply --jig /absolute/path/to/jig.',
    )
  const application = import.meta.dir
  const casesText = await Bun.file(`${application}/flows/repair/checks.json`).text()
  const acceptance: Acceptance = {
    checkerSha256: sha256(await Bun.file(`${application}/flows/repair/check.ts`).text()),
    casesSha256: sha256(casesText),
    cases: JSON.parse(casesText).cases,
  }
  const requested = resolve(values.out)
  const parent = await realpath(dirname(requested))
  const output = resolve(parent, basename(requested))
  const within = relative(repository, output)
  if (within === '' || (within !== '..' && !within.startsWith(`..${sep}`)))
    throw new Error('Output must be outside the original repository.')
  signal.throwIfAborted()
  // Exclusive, private output; never reuse an earlier packet or follow an output symlink.
  const parentHandle = await open(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  let directory: FileHandle
  try {
    const anchored = `/proc/self/fd/${parentHandle.fd}/${basename(output)}`
    await mkdir(anchored, { mode: 0o700 })
    directory = await open(
      anchored,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
  } finally {
    await parentHandle.close()
  }
  const save = async (name: string, contents: string | Uint8Array) => {
    const file = await open(`/proc/self/fd/${directory.fd}/${name}`, 'wx', 0o600)
    try {
      await file.writeFile(contents)
    } finally {
      await file.close()
    }
  }
  try {
    await save('input.json', `${JSON.stringify(input, null, 2)}\n`)
    await save('acceptance.json', `${JSON.stringify(acceptance, null, 2)}\n`)
    signal.throwIfAborted()
    console.error(`Running reviewed binding:repair; evidence directory: ${JSON.stringify(output)}`)
    // Only Jig receives the trusted operator environment. Repository bytes are argv data.
    const child = Bun.spawn(
      [jig, 'run', 'binding:repair', '--input', JSON.stringify(input), '--timeout', '5m'],
      {
        cwd: application,
        env: process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    let outputLimit = false
    const cancel = () => {
      if (child.exitCode === null) child.kill('SIGINT')
    }
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      const chunks: Uint8Array[] = []
      let bytes = 0
      for await (const value of stream) {
        const available = Math.max(0, 1048576 - bytes)
        if (available) chunks.push(value.subarray(0, available))
        bytes += value.byteLength
        if (bytes > 1048576 && !outputLimit) {
          outputLimit = true
          cancel()
        }
      }
      return { contents: Buffer.concat(chunks), bytes }
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    let stdout: Awaited<ReturnType<typeof collect>>
    let stderr: Awaited<ReturnType<typeof collect>>
    try {
      ;[stdout, stderr] = await Promise.all([
        collect(child.stdout),
        collect(child.stderr),
        child.exited,
      ])
    } finally {
      // Never abandon possibly dispatched work because a reader or the caller failed.
      if (child.exitCode === null) cancel()
      await child.exited
      signal.removeEventListener('abort', cancel)
    }
    await save('stdout.txt', stdout.contents)
    await save('stderr.txt', stderr.contents)
    await save(
      'execution.json',
      `${JSON.stringify(
        {
          exitCode: child.exitCode,
          signal: child.signalCode ?? null,
          interrupted: signal.aborted,
          outputLimit,
          stdoutBytes: stdout.bytes,
          stderrBytes: stderr.bytes,
        },
        null,
        2,
      )}\n`,
    )
    let inspected: ReturnType<typeof inspect> | undefined
    let reason =
      'No complete terminal was returned. Inspect execution.json and stderr.txt; do not assume work was undispatched.'
    if (!outputLimit) {
      try {
        const terminal = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(stdout.contents),
        )
        await save('terminal.json', stdout.contents)
        inspected = inspect(terminal, input, acceptance)
        reason = inspected.reason
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error
      }
    }
    const ready =
      !signal.aborted &&
      !outputLimit &&
      child.exitCode === 0 &&
      child.signalCode == null &&
      inspected?.status === 'review-ready'
    const status = signal.aborted
      ? 'interrupted'
      : outputLimit
        ? 'output-limit'
        : ready
          ? 'review-ready'
          : inspected !== undefined && (child.exitCode !== 0 || child.signalCode != null)
            ? 'execution-failed'
            : (inspected?.status ?? 'missing-terminal')
    const { proposals = [], ...checks } = inspected ?? {}
    for (const [index, patch] of proposals.entries())
      await save(`proposal-${index + 1}.patch`, patch)
    if (ready) await save('review.patch', proposals.at(-1)!)
    await save('summary.json', `${JSON.stringify({ ...checks, status, reason }, null, 2)}\n`)
    const summary =
      [
        ready
          ? 'Review-ready patch: review.patch (not applied).'
          : `No review-ready patch: ${status}.`,
        `Reason: ${JSON.stringify(reason)}`,
        ...(inspected?.baseline
          ? [`Original: ${inspected.baseline.passed}/${inspected.baseline.total} checks passed.`]
          : []),
        ...(inspected?.attempts.map(
          (attempt) =>
            `Proposal ${attempt.number}: ${attempt.checks ? `${attempt.checks.passed}/${attempt.checks.total} checks passed (checker exit ${attempt.checks.exitCode}).` : 'No completed checker verdict.'}`,
        ) ?? []),
        'The original repository was not modified. Passing these cases is not proof of general correctness.',
        'Raw evidence: stdout.txt, stderr.txt, execution.json; terminal.json when received.',
      ].join('\n') + '\n'
    await save('summary.txt', summary)
    console.log(summary)
    return signal.aborted ? 130 : ready ? 0 : status === 'unsuccessful' ? 1 : 2
  } catch (error) {
    // A failed launch or disk write may leave a partial packet, never a fabricated terminal.
    try {
      await save('error.txt', `${error instanceof Error ? error.message : 'Application error.'}\n`)
    } catch {}
    throw error
  } finally {
    await directory.close()
  }
}

if (import.meta.main) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  try {
    process.exitCode = await main(process.argv.slice(2), controller.signal)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Repair command failed.')
    process.exitCode = controller.signal.aborted ? 130 : 2
  } finally {
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
  }
}
