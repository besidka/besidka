import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8')
}

describe('project memory is never refreshed automatically', () => {
  it(
    'does not call the chat project-context refresh route from the chat page',
    () => {
      const source = readSource('app/pages/chats/[slug].vue')

      expect(source).not.toContain('project-context/refresh')
    },
  )

  it(
    'only refreshes project memory from the explicit Refresh button',
    () => {
      const source = readSource('app/pages/chats/projects/[id].vue')

      expect(source).toContain('@refresh="refreshProjectMemory"')
      expect(source.match(/refreshProjectMemory\b/g)).toHaveLength(2)
    },
  )

  it.each([
    'server/api/v1/chats/[slug]/project.patch.ts',
    'server/api/v1/chats/history/project/bulk.post.ts',
  ])(
    'only marks project memory stale when chats move in %s',
    (relativePath) => {
      const source = readSource(relativePath)

      expect(source).toContain('markProjectsMemoryStale')
      expect(source).not.toContain('refreshProjectMemory')
    },
  )
})
