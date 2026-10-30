const FORMAT_CHARACTER_PATTERN = /\p{Cf}/u
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u

export function hasFormatCharacters(value: string): boolean {
  return FORMAT_CHARACTER_PATTERN.test(value)
}

export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(value)
}
