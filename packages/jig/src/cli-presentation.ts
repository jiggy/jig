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

/** Style only trusted, complete human lines; never interpret arbitrary terminal escapes. */
export function privateCliHumanText(text: string, color: boolean, columns?: number): string {
  if (columns !== undefined && columns >= 20) {
    text = text
      .split('\n')
      .map((line) => {
        // Exact quoted policy/paths, shell examples and cursor updates retain their bytes.
        if (
          line.includes('"') ||
          line.includes('\u001b') ||
          line.includes('\r') ||
          /^\s*(?:jig |cd |[{}])/.test(line)
        )
          return line
        const indent = /^ */.exec(line)?.[0] ?? ''
        const words = line.slice(indent.length).split(' ')
        const lines: string[] = []
        let current = indent
        for (const word of words) {
          if (current.length > indent.length && current.length + word.length + 1 > columns) {
            lines.push(current)
            current = indent + word
          } else current += (current.length > indent.length ? ' ' : '') + word
        }
        lines.push(current)
        return lines.join('\n')
      })
      .join('\n')
  }
  if (!color) return text
  return text
    .split('\n')
    .map((line) => {
      if (/^(Error:|Review could not finish|Run failed|Execution lost)/.test(line))
        return privateCliHeading(line, 'error', true)
      if (
        /^(Warning:|Approval required|Review declined|Command interrupted|Run cancelled)/.test(line)
      )
        return privateCliHeading(line, 'warning', true)
      if (/^(Project ready|Created |Execution completed)/.test(line))
        return privateCliHeading(line, 'success', true)
      if (
        /^[A-Z][^{}]*:$/.test(line) ||
        /^(Usage:|Review changes|Jig project|Reviewing |Running )/.test(line)
      )
        return privateCliHeading(line, 'info', true)
      return line
    })
    .join('\n')
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
