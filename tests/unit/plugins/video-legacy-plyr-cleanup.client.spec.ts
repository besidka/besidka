import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import plugin from '../../../app/plugins/video-legacy-plyr-cleanup.client'
import { createStorageStub } from '../../setup/helpers/video-player'

describe('video-legacy-plyr-cleanup plugin', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function runPlugin() {
    const run = plugin as unknown as () => void

    run()
  }

  it('removes the legacy plyr key regardless of the route', () => {
    storage.setItem('plyr', JSON.stringify({ volume: 1 }))

    runPlugin()

    expect(storage.getItem('plyr')).toBeNull()
  })

  it('keeps the current video-player preferences', () => {
    storage.setItem('video-player', '{"volume":1}')
    storage.setItem('plyr', '{}')

    runPlugin()

    expect(storage.getItem('video-player')).toBe('{"volume":1}')
  })

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('storage blocked')
      },
    })

    expect(runPlugin).not.toThrow()
  })
})
