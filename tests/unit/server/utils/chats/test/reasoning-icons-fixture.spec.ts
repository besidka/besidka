import { describe, expect, it } from 'vitest'
import { buildTestReasoningIconsMessages } from '~~/server/utils/chats/test/reasoning-icons-fixture'
import { chatTestScenarios } from '#shared/utils/chat-test-errors'

describe('reasoning-icons test chat', () => {
  it('is a registered scenario', () => {
    expect(chatTestScenarios).toContain('reasoning-icons')
  })

  it('covers every kind of step icon in one assistant reply', () => {
    const [user, assistant] = buildTestReasoningIconsMessages('reasoning-icons')
    const types = assistant!.parts.map((part) => {
      return 'toolName' in part ? String(part.toolName) : part.type
    })

    expect(user!.role).toBe('user')
    expect(assistant!.role).toBe('assistant')
    expect(types).toEqual(expect.arrayContaining([
      'tool-web_search_brave',
      'tool-web_search_exa',
      'tool-web_search_preview',
      'tool-activate_skill',
      'tool-memory_list',
      'tool-create_document',
      'mcp__sentry__search_issues',
      'mcp__vercel__list_projects',
      'mcp__linear__create_issue',
    ]))
    expect(assistant!.usage.searchProvider).toBe('anthropic')
  })
})
