import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { CliDiagnostic } from './cli-usage.js'
import { parseRun } from './run-arguments.js'

/** Select a name once, before command-owner reexecution. This creates no file authority. */
export function expandPrivateCliFreshOutput(
  arguments_: readonly string[],
  currentDirectory: string,
): readonly string[] {
  if (arguments_[0] !== 'run') return arguments_
  const parsed = parseRun(arguments_)
  if (parsed.outputPrefix === undefined) return arguments_
  const prefix = parsed.outputPrefix
  const destination = `${resolve(currentDirectory, prefix)}-${randomBytes(16).toString('hex')}`
  if (Buffer.byteLength(destination) > 4096)
    throw new CliDiagnostic(
      'JIG_RUN_FILES_INVALID',
      '--out-new produces an overlong destination. Choose a shorter prefix. No Flow was started.',
      1,
    )
  const index = arguments_.indexOf('--out-new')
  const effective = [...arguments_]
  effective.splice(index, 2, '--out', destination)
  return effective
}
