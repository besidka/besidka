import { describe, expect, it } from 'vitest'
import { memorySensitiveCategories } from '#shared/utils/memory-policy'
import { MEMORY_IMPORT_PROMPT } from '#shared/utils/memory-import-prompt'

describe('MEMORY_IMPORT_PROMPT', () => {
  it('asks for topics with bullet details of concrete facts', () => {
    expect(MEMORY_IMPORT_PROMPT).toContain('organised by topic')
    expect(MEMORY_IMPORT_PROMPT).toContain('bullet list')
    expect(MEMORY_IMPORT_PROMPT).toContain('names, dates, numbers')
  })

  it('asks for the language the user usually writes in', () => {
    expect(MEMORY_IMPORT_PROMPT).toContain('language I usually use')
  })

  it('asks to skip sensitive topics and never-store data', () => {
    expect(MEMORY_IMPORT_PROMPT).toContain('Skip health, religion')
    expect(MEMORY_IMPORT_PROMPT).toContain('political opinions')
    expect(MEMORY_IMPORT_PROMPT).toContain('passwords, API keys')
    expect(memorySensitiveCategories.length).toBeGreaterThan(0)
  })

  it('asks for plain text without commentary', () => {
    expect(MEMORY_IMPORT_PROMPT).toContain('plain text')
    expect(MEMORY_IMPORT_PROMPT).toContain('No introduction, no commentary')
  })

  it('is a single plain string that fits comfortably in a chat box', () => {
    expect(typeof MEMORY_IMPORT_PROMPT).toBe('string')
    expect(MEMORY_IMPORT_PROMPT.length).toBeLessThan(2500)
  })
})
