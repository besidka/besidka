import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readPageSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8')
}

describe('project memory is never refreshed automatically', () => {
  it(
    'does not call the chat project-context refresh route from the chat page',
    () => {
      const source = readPageSource('app/pages/chats/[slug].vue')

      expect(source).not.toContain('project-context/refresh')
    },
  )

  it(
    'only refreshes project memory from the explicit Refresh button',
    () => {
      const source = readPageSource('app/pages/chats/projects/[id].vue')

      expect(source).toContain('@refresh="refreshProjectMemory"')
      expect(source.match(/refreshProjectMemory\b/g)).toHaveLength(2)
    },
  )
})
