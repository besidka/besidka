import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  appendSkillActivationParts,
  redactSkillToolPartsForPersistence,
} from '~~/server/utils/skills/runtime/persist'

function activatePart(
  overrides: Record<string, unknown> = {},
): UIMessage['parts'][number] {
  return {
    type: 'tool-activate_skill',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { name: 'writing-style' },
    output: {
      status: 'activated',
      skillId: 'skl1',
      name: 'writing-style',
      version: 3,
      content: '<skill_content>SECRET BODY</skill_content>',
    },
    ...overrides,
  } as unknown as UIMessage['parts'][number]
}

describe('skill part persistence', () => {
  it('keeps the skill text out of the persisted tool output', () => {
    const [redacted] = redactSkillToolPartsForPersistence([activatePart()])

    expect(JSON.stringify(redacted)).not.toContain('SECRET BODY')
    expect(redacted).toMatchObject({
      type: 'tool-activate_skill',
      state: 'output-available',
      output: {
        status: 'activated',
        skillId: 'skl1',
        name: 'writing-style',
        version: 3,
      },
    })
  })

  it('redacts a skill file read down to its path', () => {
    const [redacted] = redactSkillToolPartsForPersistence([{
      type: 'tool-read_skill_file',
      toolCallId: 'call-2',
      state: 'output-available',
      input: { skill: 'writing-style', path: 'references/style-guide.md' },
      output: {
        skillId: 'skl1',
        name: 'writing-style',
        version: 3,
        path: 'references/style-guide.md',
        truncated: false,
        content: 'GUIDE TEXT',
      },
    } as unknown as UIMessage['parts'][number]])

    expect(JSON.stringify(redacted)).not.toContain('GUIDE TEXT')
    expect(redacted).toMatchObject({
      output: { path: 'references/style-guide.md', truncated: false },
    })
  })

  it('leaves every other part and an errored skill part untouched', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      activatePart({ state: 'output-error', output: undefined, errorText: 'no' }),
    ] as unknown as UIMessage['parts']

    expect(redactSkillToolPartsForPersistence(parts)).toEqual(parts)
  })

  it('derives one activation data part per activated skill', () => {
    const parts = appendSkillActivationParts([
      activatePart(),
      activatePart({ toolCallId: 'call-2' }),
      { type: 'text', text: 'done' },
    ] as unknown as UIMessage['parts'], '2026-11-14T00:00:00.000Z')
    const activations = parts.filter((part) => {
      return part.type === 'data-skill-activation'
    })

    expect(activations).toEqual([{
      type: 'data-skill-activation',
      data: {
        skillId: 'skl1',
        name: 'writing-style',
        version: 3,
        activatedAt: '2026-11-14T00:00:00.000Z',
      },
    }])
  })

  it('does not add an activation that the message already carries', () => {
    const existing = {
      type: 'data-skill-activation',
      data: { skillId: 'skl1', name: 'writing-style', version: 3 },
    }
    const parts = appendSkillActivationParts([
      existing,
      activatePart(),
    ] as unknown as UIMessage['parts'])

    expect(parts).toHaveLength(2)
  })

  it('adds nothing for a failed activation', () => {
    const parts = [
      activatePart({ state: 'output-error', output: undefined }),
    ] as unknown as UIMessage['parts']

    expect(appendSkillActivationParts(parts)).toBe(parts)
  })
})
