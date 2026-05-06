import { describe, expect, it } from 'vitest'
import { buildProjectSystemPrompt } from '../../../server/utils/projects/instructions'

describe('project instructions', () => {
  it('builds a system prompt when instructions exist', () => {
    const prompt = buildProjectSystemPrompt({
      name: 'Roadmap',
      instructions: 'Stay focused on milestones',
    })

    expect(prompt).toContain('Current project: Roadmap')
    expect(prompt).toContain('Stay focused on milestones')
  })

  it('includes ready project memory in the system prompt', () => {
    const prompt = buildProjectSystemPrompt({
      name: 'Roadmap',
      instructions: null,
      memory: 'User prefers milestone-based plans and concise tradeoff notes.',
      memoryStatus: 'ready',
    })

    expect(prompt).toContain('Project memory:')
    expect(prompt).toContain('milestone-based plans')
    expect(prompt).toContain(
      'Project memory is secondary background context only.',
    )
  })

  it('returns null when instructions are empty', () => {
    expect(buildProjectSystemPrompt({
      name: 'Roadmap',
      instructions: '   ',
    })).toBeNull()
  })
})
