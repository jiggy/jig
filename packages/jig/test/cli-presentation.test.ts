import { describe, expect, test } from 'bun:test'
import { ProjectAdministrationError, type ProjectSession } from '../src/administration/project.js'
import { main } from '../src/cli.js'
import {
  privateCliDiagnostic,
  privateCliHumanText,
  privateCliStyleEnabled,
} from '../src/cli-presentation.js'
import { PrivateCliProgress } from '../src/cli-progress.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: Interpret actual SGR sequences in terminal acceptance output.
const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

// The cursor operations our display emits, interpreted as a terminal would.
function screen(text: string): string {
  let output = ''
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Interpret the active-line erase sequence.
  for (const part of strip(text).split(/(\r\u001b\[2K)/)) {
    if (part === '\r\u001b[2K') output = output.slice(0, output.lastIndexOf('\n') + 1)
    else output += part
  }
  return output
}

describe('CLI experience contract', () => {
  test('color is optional, meaning is identical, and only terminal streams are styled', () => {
    const plain = privateCliDiagnostic(
      'JIG_RUN_INPUT_INVALID',
      'Supply valid JSON with --input. No Flow was started.',
    )
    const colored = privateCliHumanText(plain, true)
    expect(colored).toContain('\u001b[1;31m')
    expect(strip(colored)).toBe(plain)
    expect(plain).toBe(
      'Error: Run input is invalid\n\n  Supply valid JSON with --input. No Flow was started.\n\n  Diagnostic code: JIG_RUN_INPUT_INVALID\n',
    )
    expect(privateCliStyleEnabled(false, { TERM: 'xterm-256color', FORCE_COLOR: '1' })).toBe(false)
    expect(privateCliStyleEnabled(true, { TERM: 'dumb' })).toBe(false)
    expect(privateCliStyleEnabled(true, { TERM: 'xterm', NO_COLOR: '' })).toBe(false)
    expect(privateCliStyleEnabled(true, { TERM: 'xterm', NO_COLOR: '1' })).toBe(false)
    // Use the terminal's palette, not hardcoded backgrounds or theme detection.
    for (const COLORFGBG of ['15;0', '0;15']) {
      expect(privateCliStyleEnabled(true, { TERM: 'xterm-256color', COLORFGBG })).toBe(true)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject background color sequences.
      expect(colored).not.toMatch(/\u001b\[(?:4[0-9]|48)[;m]/)
    }
  })

  test('long waits update one narrow active line and retain only confirmed completion', async () => {
    let transcript = ''
    const progress = new PrivateCliProgress(
      true,
      (text) => {
        transcript += text
      },
      undefined,
      true,
      () => 40,
    )
    try {
      progress.stage('Checking prerequisites')
      progress.complete()
      progress.stage('Preparing dependencies for a particularly long package path')
      await new Promise((resolve) => setTimeout(resolve, 1_050))
      const visible = screen(transcript)
      expect(visible).toStartWith('  ✓ Checking prerequisites\n')
      expect(visible.split('\n')).toHaveLength(2)
      expect(visible.split('\n')[1]!.length).toBeLessThanOrEqual(40)
      expect(visible).toContain('... 1s')
      progress.close()
      const finished = screen(transcript)
      expect(finished).toContain(
        '  - Preparing dependencies for a particularly long package path\n',
      )
      expect(finished).not.toContain('✓ Preparing')
      expect(finished).not.toContain('...')
    } finally {
      progress.close()
    }
  })

  test('authority notices preserve the active wait and plain text wraps without dropping words', async () => {
    let text = ''
    const progress = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
      },
      undefined,
      true,
      () => 40,
    )
    try {
      progress.stage('Preparing dependencies')
      progress.notice('Warning: Network access allowed\n')
      await new Promise((resolve) => setTimeout(resolve, 1_050))
      const visible = screen(text)
      expect(visible).toStartWith('Warning: Network access allowed\n')
      expect(visible).toContain('Preparing dependencies 1s')
      expect(visible.split('Preparing dependencies')).toHaveLength(2)
    } finally {
      progress.close()
    }
    const sentence =
      '  Requests may reach public or private-network services before graph validation.'
    const wrapped = privateCliHumanText(sentence, false, 40)
    expect(wrapped.split('\n').every((line) => line.length <= 40)).toBe(true)
    expect(wrapped.replace(/\s+/g, ' ').trim()).toBe(sentence.trim())
    expect(privateCliHumanText('  "path": "a path with spaces"', false, 20)).toBe(
      '  "path": "a path with spaces"',
    )
  })

  test('plain progress has no escapes, repeats, or invented completion', async () => {
    let text = ''
    const progress = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
      },
      undefined,
      false,
    )
    progress.stage('Preparing dependencies')
    progress.stage('Preparing dependencies')
    await new Promise((resolve) => setTimeout(resolve, 1_050))
    progress.close()
    expect(text).toBe('  - Preparing dependencies\n')
  })

  test('cancellation, notices, and cleanup do not overwrite one another', () => {
    let text = ''
    const controller = new AbortController()
    const progress = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
      },
      controller.signal,
      true,
    )
    progress.stage('Waiting for the Flow result')
    controller.abort()
    progress.pause()
    text += privateCliDiagnostic(
      'JIG_CLEANUP_FAILED',
      'Cleanup could not be confirmed. Inspect existing work before starting another command.',
    )
    progress.close()
    expect(screen(text)).toContain(
      'Cancellation requested; waiting for work to stop and clean up\nError: Cleanup could not be confirmed',
    )
    expect(screen(text)).not.toContain('✓')
  })

  test('review never announces success until cleanup completes', async () => {
    let output = '',
      error = ''
    let finish!: () => void
    const closing = new Promise<void>((resolve) => {
      finish = resolve
    })
    let reachedClose!: () => void
    const reached = new Promise<void>((resolve) => {
      reachedClose = resolve
    })
    const session = {
      async plan() {
        return { state: 'unchanged' }
      },
      async close() {
        reachedClose()
        await closing
      },
    } as unknown as ProjectSession
    const pending = main(['review'], {
      host: {
        async acquire() {
          return session
        },
      },
      terminalOutput: false,
      writeOutput: (text) => {
        output += text
      },
      writeError: (text) => {
        error += text
      },
    })
    await reached
    expect(output).toBe('')
    finish()
    expect(await pending).toBe(0)
    expect(output).toStartWith('Project ready\n')
    expect(output).toContain('No Flow was started')
    expect(error).toBe('')
  })

  test('a cancellation arriving with an unchanged plan cannot announce review success', async () => {
    const stop = new AbortController()
    let output = '',
      error = ''
    const session = {
      async plan() {
        stop.abort()
        return { state: 'unchanged' }
      },
      async close() {},
    } as unknown as ProjectSession
    expect(
      await main(['review'], {
        signal: stop.signal,
        terminalOutput: false,
        host: {
          async acquire() {
            return session
          },
        },
        writeOutput: (text) => {
          output += text
        },
        writeError: (text) => {
          error += text
        },
      }),
    ).toBe(2)
    expect(output).toBe('')
    expect(error).toContain('Command interrupted')
    expect(error).toContain('does not undo completed effects')
  })

  test('a failed review and uncertain cleanup preserve both causes without exposing internals', async () => {
    let output = '',
      error = ''
    const session = {
      async plan() {
        throw new ProjectAdministrationError('INVALID_CANDIDATE', 'secret source', {
          code: 'METADATA_DESCRIPTION',
          path: 'flows/chat/FLOW.md',
        })
      },
      async close() {
        throw new Error('secret host path')
      },
    } as unknown as ProjectSession
    expect(
      await main(['review'], {
        host: {
          async acquire() {
            return session
          },
        },
        terminalOutput: false,
        writeOutput: (text) => {
          output += text
        },
        writeError: (text) => {
          error += text
        },
      }),
    ).toBe(2)
    expect(output).toBe('')
    expect(error).toContain('JIG_CLEANUP_FAILED')
    expect(error).toContain('METADATA_DESCRIPTION')
    expect(error).toContain('Location: "flows/chat/FLOW.md"')
    expect(error).toContain('provide a nonempty text description')
    expect(error).not.toContain('secret')
    expect(error).not.toContain('\u001b')
  })
})
