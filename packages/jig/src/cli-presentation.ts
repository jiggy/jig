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

/** Style only trusted human text; machine records and live diagnostics bypass this. */
export function privateCliHumanText(text: string, color: boolean, columns?: number): string {
  return text
    .split('\n')
    .map((line) => {
      const section =
        /^(Selected Agent:|Host Agent selected|Packages \(|Bindings \(|Run targets \(|Targets after approval:|Review changes|Jig project|Warning:|Error:|Review could not finish|Run failed|Execution lost|Project ready|Created |Execution completed|Approval required|Review declined|Command interrupted|Run cancelled|Waiting for your approval)/.test(
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
        if (/^(Error:|Review could not finish|Run failed|Execution lost)/.test(line))
          rendered = privateCliHeading(wrapped, 'error', true)
        else if (
          /^(Warning:|Approval required|Review declined|Command interrupted|Run cancelled)/.test(
            line,
          )
        )
          rendered = privateCliHeading(wrapped, 'warning', true)
        else if (/^(Project ready|Created |Execution completed)/.test(line))
          rendered = privateCliHeading(wrapped, 'success', true)
        else if (
          /^\s*(?:Diagnostic code:|Category:|"digest": "sha256:)/.test(line) ||
          /^Unchanged policy is omitted/.test(line)
        )
          rendered = privateCliSecondary(wrapped, true)
        else if (
          section ||
          /^[A-Z][^{}]*:$/.test(line) ||
          /^(Usage:|Reviewing |Running |Added:|Changed:|Removed:)/.test(line)
        )
          rendered = privateCliHeading(wrapped, 'info', true)
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
