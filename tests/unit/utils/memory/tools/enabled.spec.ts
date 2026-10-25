import { describe, expect, it } from 'vitest'
import {
  isChatSearchToolEnabled,
  isMemoryToolsEnabled,
} from '~~/server/utils/memory/tools/enabled'

describe('isChatSearchToolEnabled', () => {
  it('follows the chatSearchEnabled setting', () => {
    expect(isChatSearchToolEnabled({ chatSearchEnabled: true })).toBe(true)
    expect(isChatSearchToolEnabled({ chatSearchEnabled: false })).toBe(false)
  })
})

describe('isMemoryToolsEnabled', () => {
  it('follows the memoryEnabled setting', () => {
    expect(isMemoryToolsEnabled({ memoryEnabled: true })).toBe(true)
    expect(isMemoryToolsEnabled({ memoryEnabled: false })).toBe(false)
  })

  it('ignores the chat search setting', () => {
    expect(isMemoryToolsEnabled({
      memoryEnabled: false,
      chatSearchEnabled: true,
    } as { memoryEnabled: boolean })).toBe(false)
  })
})
