import { describe, expect, it } from 'vitest'
import {
  connectorMentionTerms,
  findMentionedConnector,
  textMentionsTerm,
} from '../../../app/utils/connector-mention'

const notion = { id: 'c1', title: 'Notion', host: 'mcp.notion.com' }
const doop = { id: 'c2', title: 'Doop', host: 'mcp.doop.design' }
const short = { id: 'c3', title: 'X', host: 'mcp.x.ai' }

function find(text: string, overrides: Partial<{
  selectedIds: string[]
  dismissedIds: Set<string>
}> = {}) {
  return findMentionedConnector({
    text,
    candidates: [notion, doop, short],
    selectedIds: overrides.selectedIds ?? [],
    dismissedIds: overrides.dismissedIds ?? new Set(),
  })
}

describe('connectorMentionTerms', () => {
  it('uses the title, the host and its main label', () => {
    expect(connectorMentionTerms(notion)).toEqual([
      'notion',
      'mcp.notion.com',
    ])
    expect(connectorMentionTerms({
      id: 'c4',
      title: 'Work wiki',
      host: 'mcp.atlassian.com',
    })).toEqual(['work wiki', 'mcp.atlassian.com', 'atlassian'])
  })

  it('skips a title shorter than three characters and a short host label',
    () => {
      expect(connectorMentionTerms(short)).toEqual(['mcp.x.ai'])
    })
})

describe('textMentionsTerm', () => {
  it('matches whole words only, in any case and script', () => {
    expect(textMentionsTerm('What is in my Notion notes?', 'notion'))
      .toBe(true)
    expect(textMentionsTerm('notionally speaking', 'notion')).toBe(false)
    expect(textMentionsTerm('мій Notion-простір', 'notion')).toBe(true)
    expect(textMentionsTerm('Що в моєму notion?', 'notion')).toBe(true)
  })
})

describe('findMentionedConnector', () => {
  it('suggests a connector the user names that is off in the chat', () => {
    expect(find('what do I have in Doop?')).toEqual(doop)
    expect(find('search mcp.notion.com for the plan')).toEqual(notion)
  })

  it('never suggests a connector already on, or one dismissed', () => {
    expect(find('what do I have in Doop?', { selectedIds: ['c2'] }))
      .toBeNull()
    expect(find('what do I have in Doop?', {
      dismissedIds: new Set(['c2']),
    })).toBeNull()
  })

  it('needs a whole-word mention and some text', () => {
    expect(find('the doopler effect')).toBeNull()
    expect(find('x marks the spot')).toBeNull()
    expect(find('   ')).toBeNull()
  })
})
