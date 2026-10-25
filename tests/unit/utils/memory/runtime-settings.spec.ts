import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMemoryRuntimeSettings } from '~~/server/utils/memory/runtime-settings'
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from '../../../setup/helpers/memory-db'

describe('loadMemoryRuntimeSettings', () => {
  let testDb: MemoryTestDb

  beforeEach(() => {
    testDb = createMemoryTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  function load(userId = 1) {
    return loadMemoryRuntimeSettings({ db: testDb.db, userId })
  }

  it('returns the defaults when the user has no settings row', async () => {
    expect(await load()).toEqual({
      memoryEnabled: false,
      chatSearchEnabled: true,
      memoryIncludeSensitive: false,
      aboutMe: null,
    })
  })

  it('returns the defaults for null columns on an existing row', async () => {
    testDb.insertUserSettings({ userId: 1 })

    expect(await load()).toEqual({
      memoryEnabled: false,
      chatSearchEnabled: true,
      memoryIncludeSensitive: false,
      aboutMe: null,
    })
  })

  it('returns stored values over the defaults', async () => {
    testDb.insertUserSettings({
      userId: 1,
      memoryEnabled: true,
      chatSearchEnabled: false,
      memoryIncludeSensitive: true,
      aboutMe: 'Backend developer',
    })

    expect(await load()).toEqual({
      memoryEnabled: true,
      chatSearchEnabled: false,
      memoryIncludeSensitive: true,
      aboutMe: 'Backend developer',
    })
  })

  it('keeps explicit false over a true default', async () => {
    testDb.insertUserSettings({ userId: 1, chatSearchEnabled: false })

    expect((await load()).chatSearchEnabled).toBe(false)
  })

  it('trims aboutMe', async () => {
    testDb.insertUserSettings({ userId: 1, aboutMe: '  \n Short bio \n ' })

    expect((await load()).aboutMe).toBe('Short bio')
  })

  it('maps an empty or whitespace-only aboutMe to null', async () => {
    testDb.insertUserSettings({ userId: 1, aboutMe: '   \n ' })
    testDb.insertUserSettings({ userId: 2, aboutMe: '' })

    expect((await load(1)).aboutMe).toBeNull()
    expect((await load(2)).aboutMe).toBeNull()
  })

  it('does not read another user settings', async () => {
    testDb.insertUserSettings({
      userId: 2,
      memoryEnabled: true,
      aboutMe: 'Someone else',
    })

    expect(await load(1)).toEqual({
      memoryEnabled: false,
      chatSearchEnabled: true,
      memoryIncludeSensitive: false,
      aboutMe: null,
    })
  })
})
