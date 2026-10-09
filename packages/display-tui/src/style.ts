import type { TuiTheme } from './types.js'

export function heading(
  text: string,
  tone: 'info' | 'success' | 'warning' | 'error',
  color: boolean,
): string {
  if (!color) return text
  const code = { info: '1', success: '1;32', warning: '1;33', error: '1;31' }[tone]
  return `\u001b[${code}m${text}\u001b[0m`
}
export function secondary(text: string, color: boolean): string {
  return color ? `\u001b[90m${text}\u001b[39m` : text
}
type SyntaxRole = 'key' | 'string' | 'number' | 'literal'
const syntaxThemes = {
  'one-dark': { key: 'e06c75', string: '98c379', number: 'd19a66', literal: 'c678dd' },
  'one-light': { key: 'e45649', string: '50a14f', number: '986801', literal: 'a626a4' },
  macchiato: { key: '8aadf4', string: 'a6da95', number: 'f5a97f', literal: 'c6a0f6' },
} as const
export function syntaxHex(role: SyntaxRole, theme: TuiTheme = 'one-dark'): string {
  return syntaxThemes[theme][role]
}
/** Focus is navigation, never an application verdict. */
export function selection(text: string, color: boolean, theme: TuiTheme = 'one-dark'): string {
  const hex = syntaxHex('literal', theme)
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  return color ? `\u001b[1;38;2;${rgb.join(';')}m${text}\u001b[0m` : text
}
