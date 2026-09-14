/** Shared human presentation. Machine records never pass through this module. */
export function privateCliStyleEnabled(terminal: boolean, env = process.env): boolean {
  return terminal && env.TERM !== 'dumb' && env.NO_COLOR === undefined
}

export function privateCliHeading(
  text: string,
  tone: 'info' | 'success' | 'warning' | 'error',
  color: boolean,
): string {
  if (!color) return text
  const code = { info: '1', success: '1;32', warning: '1;33', error: '1;31' }[tone]
  return `\u001b[${code}m${text}\u001b[0m`
}

/** Secondary metadata stays readable using the terminal's configurable gray. */
export function privateCliSecondary(text: string, color: boolean): string {
  return color ? `\u001b[90m${text}\u001b[39m` : text
}

type SyntaxRole = 'key' | 'string' | 'number' | 'literal'

// Foreground accents from Atom One and Catppuccin Macchiato; no background changes.
const syntaxThemes = {
  'one-dark': { key: 'e06c75', string: '98c379', number: 'd19a66', literal: 'c678dd' },
  'one-light': { key: 'e45649', string: '50a14f', number: '986801', literal: 'a626a4' },
  macchiato: { key: '8aadf4', string: 'a6da95', number: 'f5a97f', literal: 'c6a0f6' },
} as const

function syntaxColor(role: SyntaxRole, env: NodeJS.ProcessEnv): string {
  const theme = env.JIG_THEME
  const palette =
    theme === 'one-light' || theme === 'macchiato' ? syntaxThemes[theme] : syntaxThemes['one-dark']
  const hex = palette[role]
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return `38;2;${rgb.join(';')}`
  if (env.TERM?.includes('256color')) {
    const levels = [0, 95, 135, 175, 215, 255]
    const cube = rgb.map((value) =>
      levels.reduce(
        (best, level, index) =>
          Math.abs(value - level) < Math.abs(value - (levels[best] ?? 0)) ? index : best,
        0,
      ),
    )
    return `38;5;${16 + 36 * (cube[0] ?? 0) + 6 * (cube[1] ?? 0) + (cube[2] ?? 0)}`
  }
  return { key: '36', string: '32', number: '33', literal: '35' }[role]
}

/** Color tokens in the existing escaped representation, never parse/reserialize policy. */
function highlightPolicy(line: string, env: NodeJS.ProcessEnv): string {
  if (
    line.includes('\u001b') ||
    !/^\s*(?:- )?(?:"(?:[^"\\]|\\.)*"\s*(?::|,?$)|(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,?$|[{}[\]])/.test(
      line,
    )
  )
    return line
  return line.replace(
    /"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (token, offset: number) => {
      const role: SyntaxRole = token.startsWith('"')
        ? /^\s*:/.test(line.slice(offset + token.length))
          ? 'key'
          : 'string'
        : /^(true|false|null)$/.test(token)
          ? 'literal'
          : 'number'
      return `\u001b[${syntaxColor(role, env)}m${token}\u001b[39m`
    },
  )
}

/** Style only trusted human text; machine records and live diagnostics bypass this. */
export function privateCliHumanText(
  text: string,
  color: boolean,
  columns?: number,
  env = process.env,
): string {
  let literal: { indent: number; prefix: string } | undefined
  return text
    .split('\n')
    .map((line, index, lines) => {
      const prefix = /^[+-] /.test(line) ? line.slice(0, 2) : ''
      const body = line.slice(prefix.length)
      const indent = /^ */.exec(body)![0].length
      if (literal && prefix === literal.prefix && (body.trim() === '' || indent > literal.indent)) {
        // Block scalars are data: no wrapping, heading recognition, or blank-line removal.
        return color && body.trim() !== ''
          ? `${prefix ? `\u001b[${prefix[0] === '+' ? '32' : '31'}m${prefix[0]}\u001b[39m ` : ''}\u001b[${syntaxColor('string', env)}m${body}\u001b[39m`
          : line
      }
      literal = undefined
      if (/^\s+(?:- )?(?:"(?:[^"\\]|\\.)*": )?\|[1-9]?[+-]?$/.test(body))
        literal = {
          indent: /^ +\|/.test(body) ? indent - 1 : /^ +- "/.test(body) ? indent + 2 : indent,
          prefix,
        }
      const section =
        /^(Choose an Agent|Run output:|Approval environment matches|Approval validity not checked|No approved revision|Selected Agent:|Host Agent selected|Packages \(|Bindings \(|Run targets \(|Targets after approval:|Review changes|Jig project|Warning:|Error:|Review could not finish|Run failed|Execution lost|Project ready|Created |Execution completed|Approval required|Review required|Review declined|Command interrupted|Run cancelled|Waiting for your approval)/.test(
          line,
        )
      const wrapped = wrapHumanLine(line, columns)
      let rendered = wrapped
      const counts = /^((?:Packages|Bindings|Run targets) \(.*\)): (.*)$/.exec(line)
      if (counts) {
        rendered =
          privateCliHeading(wrapHumanLine(counts[1] ?? '', columns), 'info', color) +
          (columns === undefined ? '' : '\n') +
          privateCliSecondary(
            wrapHumanLine(`${columns === undefined ? ': ' : '  '}${counts[2]}`, columns),
            color,
          )
      } else if (color) {
        if (/^ {2}Unavailable:/.test(line) && /^ {4}\S/.test(lines[index + 1] ?? ''))
          rendered = privateCliHeading(wrapped, 'warning', true)
        else if (/^(Error:|Review could not finish|Run failed|Execution lost)/.test(line))
          rendered = privateCliHeading(wrapped, 'error', true)
        else if (
          /^(Changed:|Warning:|Approval validity not checked|Approval required|Review required|Review declined|Command interrupted|Run cancelled)/.test(
            line,
          )
        )
          rendered = privateCliHeading(wrapped, 'warning', true)
        else if (/^(Project ready|Created |Execution completed)/.test(line))
          rendered = privateCliHeading(wrapped, 'success', true)
        else if (
          /^\s*(?:Diagnostic code:|Category:|Executable:|Diagnostics:|"digest": "sha256:|Unavailable:|Flows needing live updates|Flow source, prepared dependencies, settings and permissions are unchanged\.)/.test(
            line,
          ) ||
          /^(Unchanged policy is omitted|Remembered locally\.)/.test(line)
        )
          rendered = privateCliSecondary(wrapped, true)
        else if (/^ {2}\d+\. .* — /.test(line)) {
          rendered = wrapped
            .replace(/^ {2}\d+\. [^—\n]*\S(?= —|\n|$)/, (label) =>
              privateCliHeading(label, 'info', true),
            )
            .replace('—', privateCliSecondary('—', true))
        } else if (
          section ||
          /^[A-Z][^{}]*:$/.test(line) ||
          /^(Usage:|Reviewing |Running |Added:|Removed:)/.test(line)
        )
          rendered = privateCliHeading(wrapped, 'info', true)
        else if (/^[+-] /.test(line)) {
          const sign = line.slice(0, 1)
          const body = line.slice(2)
          rendered = `\u001b[${sign === '+' ? '32' : '31'}m${sign}\u001b[39m ${
            /^\s*"digest": "sha256:/.test(body)
              ? privateCliSecondary(body, true)
              : highlightPolicy(body, env)
          }`
        } else rendered = highlightPolicy(wrapped, env)
      }
      // Width is supplied only for a terminal. Plain terminal mode keeps the same
      // spatial hierarchy; redirected text retains its compact, complete transcript.
      if (section && columns !== undefined) {
        const rule = '-'.repeat(Math.max(1, Math.min(60, columns - 1)))
        return `\n${privateCliSecondary(rule, color)}\n${rendered}\n`
      }
      return rendered
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function wrapHumanLine(line: string, columns?: number): string {
  if (
    columns === undefined ||
    columns < 20 ||
    line.includes('"') ||
    line.includes('\u001b') ||
    line.includes('\r') ||
    /^\s*(?:jig |cd |[{}])/.test(line)
  )
    return line
  const indent = /^ */.exec(line)?.[0] ?? ''
  const lines: string[] = []
  let current = indent
  for (const word of line.slice(indent.length).split(' ')) {
    if (current.length > indent.length && current.length + word.length + 1 > columns) {
      lines.push(current)
      current = indent + word
    } else current += (current.length > indent.length ? ' ' : '') + word
  }
  lines.push(current)
  return lines.join('\n')
}

export function privateCliDiagnostic(
  code: string,
  message: string,
  title = 'Error: Command could not finish',
): string {
  const titles: Record<string, string> = {
    JIG_CHANGES_DECLINED: 'Review declined',
    JIG_APPROVAL_REQUIRED: 'Approval required',
    JIG_COMMAND_INTERRUPTED: 'Command interrupted',
    JIG_CLEANUP_FAILED: 'Error: Cleanup could not be confirmed',
    JIG_DELIVERY_FAILED: 'Error: Result delivery could not finish',
    JIG_REPORT_LIMIT: 'Error: Result report is too large',
    JIG_RUN_PROTOCOL_ERROR: 'Error: Flow communication failed',
    JIG_RUN_TARGET_NOT_FOUND: 'Error: Target is not approved',
    JIG_TARGET_NOT_FOUND: 'Error: Target is not approved',
    JIG_INSPECTION_UNAVAILABLE: 'Error: Approved snapshot is unavailable',
    JIG_RUN_INPUT_INVALID: 'Error: Run input is invalid',
    JIG_RUN_TARGET_INVALID: 'Error: Run target is invalid',
    JIG_INIT_DESTINATION_EXISTS: 'Error: Project destination already exists',
    JIG_INIT_UNAVAILABLE: 'Error: Project could not be created',
    JIG_INIT_CLEANUP_FAILED: 'Error: Incomplete project could not be removed',
    JIG_CHECKPOINT_UNAVAILABLE: 'Error: Retained result could not be recovered',
    JIG_DELIVERY_CLEANUP_FAILED: 'Error: Delivery cleanup could not finish',
    SANDBOX_UNAVAILABLE: 'Error: Required sandbox is unavailable',
  }
  return `${titles[code] ?? title}\n\n${message
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n\n  Diagnostic code: ${code}\n`
}

/** Launcher/owner paths without an active command renderer still share presentation. */
export function privateCliStderrDiagnostic(code: string, message: string): string {
  return privateCliHumanText(
    privateCliDiagnostic(code, message),
    privateCliStyleEnabled(process.stderr.isTTY === true),
    process.stderr.isTTY === true ? process.stderr.columns || 80 : undefined,
  )
}
