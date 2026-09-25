export class CliDiagnostic extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message)
    this.name = 'CliDiagnostic'
  }
}

export function usage(command: string, message: string): never {
  throw new CliDiagnostic('JIG_USAGE', `${message}\n\nHelp: jig ${command} --help`, 2)
}

/** Suggestions are spelling assistance, never alternate dispatch authority. */
export function spellingHint(value: string, choices: readonly string[]): string {
  if (value.length > 64) return ''
  const distance = (other: string): number => {
    let row = Array.from({ length: other.length + 1 }, (_, index) => index)
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1]
      for (let j = 0; j < other.length; j++)
        next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + Number(value[i] !== other[j])))
      row = next
    }
    return row[other.length]!
  }
  const matches = choices
    .map((choice) => ({ choice, distance: distance(choice) }))
    .filter((item) => item.distance <= (value.length > 5 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance)
  return matches[0] && matches[0].distance !== matches[1]?.distance
    ? `\nDid you mean ${matches[0].choice}?`
    : ''
}

export function asciiJsonString(value: string): string {
  let output = '"'
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!
    if (scalar === '"' || scalar === '\\') output += `\\${scalar}`
    else if (code >= 0x20 && code <= 0x7e) output += scalar
    else if (code <= 0xffff) output += `\\u${code.toString(16).padStart(4, '0')}`
    else {
      const adjusted = code - 0x10000
      output += `\\u${(0xd800 + (adjusted >> 10)).toString(16)}\\u${(0xdc00 + (adjusted & 0x3ff)).toString(16)}`
    }
  }
  return `${output}"`
}
