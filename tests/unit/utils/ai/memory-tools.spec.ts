import { describe, expect, it } from 'vitest'
import {
  CHAT_SEARCH_TOOL_NAMES,
  isChatSearchToolName,
} from '~~/server/utils/ai/chat-search-tools'
import {
  MEMORY_TOOL_NAMES,
  isMemoryToolName,
} from '~~/server/utils/ai/memory-tools'
import {
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_LIST_TOOL_NAME,
  MEMORY_READ_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
} from '~~/server/utils/memory/tools/memory-constants'

describe('isMemoryToolName', () => {
  it('recognises the four memory tools', () => {
    expect(MEMORY_TOOL_NAMES).toEqual([
      MEMORY_LIST_TOOL_NAME,
      MEMORY_READ_TOOL_NAME,
      MEMORY_WRITE_TOOL_NAME,
      MEMORY_FORGET_TOOL_NAME,
    ])

    for (const toolName of MEMORY_TOOL_NAMES) {
      expect(isMemoryToolName(toolName)).toBe(true)
    }
  })

  it('rejects chat-search, web-search and unknown names', () => {
    for (const toolName of [
      'search_chats',
      'read_chat',
      'web_search',
      'web_search_brave',
      'memory',
      '',
    ]) {
      expect(isMemoryToolName(toolName)).toBe(false)
    }
  })

  it('keeps memory tools out of the chat-search name set', () => {
    for (const toolName of MEMORY_TOOL_NAMES) {
      expect(CHAT_SEARCH_TOOL_NAMES).not.toContain(toolName)
      expect(isChatSearchToolName(toolName)).toBe(false)
    }
  })
})
