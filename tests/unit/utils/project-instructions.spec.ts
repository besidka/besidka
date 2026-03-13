import { describe, expect, it } from 'vitest'
import { buildProjectInstructionsMessage } from '../../../server/utils/projects/instructions'

describe('project instructions', () => {
  it('builds a system message when instructions exist', () => {
    const message = buildProjectInstructionsMessage({
      name: 'Roadmap',
      instructions: 'Stay focused on milestones',
    })

    expect(message).toMatchObject({
      role: 'system',
      parts: [
        {
          type: 'text',
        },
      ],
    })
    expect(message?.parts[0]).toMatchObject({
      text: expect.stringContaining('Current project: Roadmap'),
    })
    expect(message?.parts[0]).toMatchObject({
      text: expect.stringContaining('Stay focused on milestones'),
    })
  })

  it('includes ready project memory in the system message', () => {
    const message = buildProjectInstructionsMessage({
      name: 'Roadmap',
      instructions: null,
      memory: 'User prefers milestone-based plans and concise tradeoff notes.',
      memoryStatus: 'ready',
    })

    expect(message?.parts[0]).toMatchObject({
      text: expect.stringContaining('Project memory:'),
    })
    expect(message?.parts[0]).toMatchObject({
      text: expect.stringContaining('milestone-based plans'),
    })
  })

  it('returns null when instructions are empty', () => {
    expect(buildProjectInstructionsMessage({
      name: 'Roadmap',
      instructions: '   ',
    })).toBeNull()
  })
})
