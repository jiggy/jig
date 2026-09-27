import {
  CANONICAL_CLASS_15_1 as classes,
  CANONICAL_DECOMPOSITION_15_1 as decompositions,
  CANONICAL_COMPOSITION_15_1 as compositions,
} from './normalization-data-15.1.js'

/** UAX #15 canonical decomposition, ordering and composition, pinned to 15.1. */
export function normalizeNfc15_1(value: string): string {
  const ordered: number[] = []
  function emit(code: number): void {
    const decomposition = decompositions.get(code)
    if (decomposition) {
      for (const part of decomposition) emit(part)
      return
    }
    const syllable = code - 0xac00
    if (syllable >= 0 && syllable < 11172) {
      emit(0x1100 + Math.floor(syllable / 588))
      emit(0x1161 + Math.floor((syllable % 588) / 28))
      if (syllable % 28) emit(0x11a7 + syllable % 28)
      return
    }
    ordered.push(code)
    const rank = classes.get(code) ?? 0
    if (rank === 0) return
    let position = ordered.length - 1
    while (position > 0 && (classes.get(ordered[position - 1]!) ?? 0) > rank) {
      ordered[position] = ordered[position - 1]!
      position--
    }
    ordered[position] = code
  }
  for (const scalar of value) emit(scalar.codePointAt(0)!)
  const result: number[] = []
  let starter = -1, lastClass = 0
  for (const code of ordered) {
    const rank = classes.get(code) ?? 0
    const combined = starter < 0 ? undefined : compose(result[starter]!, code)
    if (combined !== undefined && (lastClass === 0 || lastClass < rank)) {
      result[starter] = combined
    } else {
      if (rank === 0) starter = result.length
      result.push(code)
      lastClass = rank
    }
  }
  return result.map((code) => String.fromCodePoint(code)).join('')
}

function compose(first: number, second: number): number | undefined {
  const leading = first - 0x1100, vowel = second - 0x1161
  if (leading >= 0 && leading < 19 && vowel >= 0 && vowel < 21)
    return 0xac00 + (leading * 21 + vowel) * 28
  const syllable = first - 0xac00, trailing = second - 0x11a7
  if (syllable >= 0 && syllable < 11172 && syllable % 28 === 0 && trailing > 0 && trailing < 28)
    return first + trailing
  return compositions.get(first * 0x110000 + second)
}
