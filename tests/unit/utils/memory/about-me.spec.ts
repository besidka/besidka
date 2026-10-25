import { describe, expect, it } from 'vitest'
import { buildAboutMeInstruction } from '~~/server/utils/memory/about-me'

describe('buildAboutMeInstruction', () => {
  it('returns null for missing or blank text', () => {
    expect(buildAboutMeInstruction(null)).toBeNull()
    expect(buildAboutMeInstruction(undefined)).toBeNull()
    expect(buildAboutMeInstruction('')).toBeNull()
    expect(buildAboutMeInstruction('  \n\t ')).toBeNull()
  })

  it('puts a one-line header before the text, kept verbatim', () => {
    const aboutMe = 'I am a backend developer.\n\nUse <b>tags</b> & "quotes".'
    const instruction = buildAboutMeInstruction(aboutMe)
    const [header, ...rest] = (instruction ?? '').split('\n')

    expect(header).toContain('wrote the following about themselves')
    expect(header).toContain('standing instructions')
    expect(rest.join('\n')).toBe(aboutMe)
  })

  it('trims only the outer whitespace', () => {
    expect(buildAboutMeInstruction('  Keep   inner   spaces.  '))
      .toMatch(/\nKeep {3}inner {3}spaces\.$/)
  })

  it('keeps Ukrainian text untouched', () => {
    expect(buildAboutMeInstruction('Я розробник. Відповідай стисло.'))
      .toMatch(/\nЯ розробник\. Відповідай стисло\.$/)
  })
})
