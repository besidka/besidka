import { describe, expect, it } from 'vitest'
import {
  MCP_CHAT_GOOGLE_DATA_WITHHELD_TEXT,
  mergeChatSearchResults,
  withheldForGoogleData,
} from '~~/server/utils/mcp/private/chats'
import type { McpChatTranscript } from '~~/server/utils/mcp/private/chats'

function transcript(): McpChatTranscript {
  return {
    messages: [
      {
        id: 'message-1',
        role: 'user',
        createdAt: '2026-11-20T10:00:00.000Z',
        text: 'Read my plan from Google Drive',
      },
      {
        id: 'message-2',
        role: 'assistant',
        model: 'gpt-5',
        createdAt: '2026-11-20T10:00:05.000Z',
        text: 'The plan says the launch moves to March.',
        truncated: true,
      },
    ],
    omittedMessages: 0,
    truncated: true,
  }
}

function chatRow(googleDataAt: Date | null) {
  return {
    id: googleDataAt ? 'chat-google' : 'chat-plain',
    slug: googleDataAt ? 'slug-google' : 'slug-plain',
    title: 'Plan',
    projectId: null,
    projectName: null,
    pinnedAt: null,
    shared: false,
    memoryExcluded: null,
    googleDataAt,
    createdAt: new Date(1_000),
    activityAt: new Date(2_000),
  }
}

describe('withheldForGoogleData', () => {
  it('keeps the transcript of a chat without Google data', () => {
    const original = transcript()

    expect(withheldForGoogleData(original, false)).toBe(original)
  })

  it('withholds every message text of a chat that holds Google data', () => {
    const withheld = withheldForGoogleData(transcript(), true)

    expect(withheld.truncated).toBe(false)
    expect(withheld.messages).toEqual([
      {
        id: 'message-1',
        role: 'user',
        createdAt: '2026-11-20T10:00:00.000Z',
        text: MCP_CHAT_GOOGLE_DATA_WITHHELD_TEXT,
      },
      {
        id: 'message-2',
        role: 'assistant',
        model: 'gpt-5',
        createdAt: '2026-11-20T10:00:05.000Z',
        text: MCP_CHAT_GOOGLE_DATA_WITHHELD_TEXT,
      },
    ])
    expect(JSON.stringify(withheld)).not.toContain('March')
  })
})

describe('mergeChatSearchResults', () => {
  it('drops the content snippet of a chat that holds Google data', () => {
    const flagged = chatRow(new Date(1_500))
    const plain = chatRow(null)
    const merged = mergeChatSearchResults(
      [],
      [
        { chatId: flagged.id, snippet: 'launch moves to March' },
        { chatId: plain.id, snippet: 'launch party' },
      ] as Parameters<typeof mergeChatSearchResults>[1],
      new Map([[flagged.id, flagged], [plain.id, plain]]),
    )

    expect(merged.find(chat => chat.slug === 'slug-google'))
      .toMatchObject({ matchedIn: 'content' })
    expect(merged.find(chat => chat.slug === 'slug-google'))
      .not.toHaveProperty('snippet')
    expect(merged.find(chat => chat.slug === 'slug-plain'))
      .toMatchObject({ snippet: 'launch party' })
  })

  it('drops the snippet of a title match in such a chat too', () => {
    const flagged = chatRow(new Date(1_500))
    const merged = mergeChatSearchResults(
      [flagged],
      [{ chatId: flagged.id, snippet: 'launch moves to March' }] as Parameters<
        typeof mergeChatSearchResults
      >[1],
      new Map(),
    )

    expect(merged[0]).toMatchObject({ matchedIn: 'both' })
    expect(merged[0]).not.toHaveProperty('snippet')
  })
})
