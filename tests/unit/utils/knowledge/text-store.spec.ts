import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  deleteKnowledgeItemText,
  deleteKnowledgeItemTexts,
  getKnowledgeItemText,
  putKnowledgeItemText,
} from '~~/server/utils/knowledge/text-store'

function createFakeBucket() {
  const objects = new Map<string, string>()
  const putCalls: Array<{ key: string, options: unknown }> = []
  const deleteCalls: Array<string | string[]> = []

  return {
    objects,
    putCalls,
    deleteCalls,
    put: vi.fn(async (key: string, value: string, options?: unknown) => {
      objects.set(key, value)
      putCalls.push({ key, options })
    }),
    get: vi.fn(async (key: string) => {
      const value = objects.get(key)

      if (value === undefined) {
        return null
      }

      return {
        size: new TextEncoder().encode(value).length,
        text: async () => value,
      }
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      deleteCalls.push(keys)

      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key)
      }
    }),
  }
}

describe('knowledge text store', () => {
  let bucket: ReturnType<typeof createFakeBucket>

  beforeEach(() => {
    bucket = createFakeBucket()
    vi.stubGlobal('useFileStorage', () => bucket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the text under the server-derived key', async () => {
    await putKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 5,
      text: 'Привіт, world',
    })

    expect([...bucket.objects.keys()]).toEqual([
      'knowledge/u3/p4/items/5.md',
    ])
    expect(bucket.putCalls[0]!.options).toEqual({
      httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    })
  })

  it('reads back exactly what was written', async () => {
    const text = '# Заголовок\n\nTab\tand "quotes" and emoji 🙂\n'

    await putKnowledgeItemText({ userId: 3, projectId: 4, itemId: 5, text })

    expect(await getKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 5,
    })).toBe(text)
  })

  it('returns null for a missing object', async () => {
    expect(await getKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 99,
    })).toBeNull()
  })

  it('returns null for an object above the per-item cap', async () => {
    bucket.objects.set(
      'knowledge/u3/p4/items/5.md',
      'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes + 1),
    )

    expect(await getKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 5,
    })).toBeNull()
  })

  it('rejects text above the per-item cap before touching R2', async () => {
    await expect(putKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 5,
      text: 'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes + 1),
    })).rejects.toMatchObject({ status: 422 })
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('counts the cap in UTF-8 bytes, not characters', async () => {
    const characterCount = KNOWLEDGE_LIMITS.maxItemTextBytes / 2 + 1

    await expect(putKnowledgeItemText({
      userId: 3,
      projectId: 4,
      itemId: 5,
      text: 'ї'.repeat(characterCount),
    })).rejects.toMatchObject({ status: 422 })
  })

  it('deletes one object by key', async () => {
    await putKnowledgeItemText({ userId: 3, projectId: 4, itemId: 5, text: 'x' })
    await deleteKnowledgeItemText({ userId: 3, projectId: 4, itemId: 5 })

    expect(bucket.objects.size).toBe(0)
    expect(bucket.deleteCalls).toEqual(['knowledge/u3/p4/items/5.md'])
  })

  it('deletes many objects with one batch call per 1,000 keys', async () => {
    const itemIds = Array.from({ length: 2_500 }, (_value, index) => {
      return index + 1
    })

    await deleteKnowledgeItemTexts({ userId: 3, projectId: 4, itemIds })

    expect(bucket.deleteCalls.map((keys) => {
      return (keys as string[]).length
    })).toEqual([1_000, 1_000, 500])
  })

  it('does not call R2 for an empty batch delete', async () => {
    await deleteKnowledgeItemTexts({ userId: 3, projectId: 4, itemIds: [] })

    expect(bucket.delete).not.toHaveBeenCalled()
  })

  describe('key safety', () => {
    const badIds = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]

    it.each(badIds)('refuses item id %s on every call', async (badId) => {
      await expect(putKnowledgeItemText({
        userId: 3,
        projectId: 4,
        itemId: badId,
        text: 'x',
      })).rejects.toMatchObject({ status: 500 })
      await expect(getKnowledgeItemText({
        userId: 3,
        projectId: 4,
        itemId: badId,
      })).rejects.toMatchObject({ status: 500 })
      await expect(deleteKnowledgeItemText({
        userId: 3,
        projectId: 4,
        itemId: badId,
      })).rejects.toMatchObject({ status: 500 })
      await expect(deleteKnowledgeItemTexts({
        userId: 3,
        projectId: 4,
        itemIds: [1, badId],
      })).rejects.toMatchObject({ status: 500 })
      expect(bucket.put).not.toHaveBeenCalled()
      expect(bucket.get).not.toHaveBeenCalled()
      expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('refuses a public id passed as an internal id', async () => {
      await expect(putKnowledgeItemText({
        userId: 3,
        projectId: 4,
        itemId: 'aB3xY' as unknown as number,
        text: 'x',
      })).rejects.toMatchObject({ status: 500 })
    })

    it('refuses a bad user or project id', async () => {
      await expect(putKnowledgeItemText({
        userId: 0,
        projectId: 4,
        itemId: 1,
        text: 'x',
      })).rejects.toMatchObject({ status: 500 })
      await expect(getKnowledgeItemText({
        userId: 3,
        projectId: -2,
        itemId: 1,
      })).rejects.toMatchObject({ status: 500 })
    })
  })
})
