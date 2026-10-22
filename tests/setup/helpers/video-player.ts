import { expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import VideoShell from '../../../app/components/Video/Shell.vue'

export interface MediaState {
  duration: number
  readyState: number
  ended: boolean
}

interface VideoPlayerEnvironment {
  createObjectURL: ReturnType<typeof vi.fn>
  revokeObjectURL: ReturnType<typeof vi.fn>
  readBlobUrl: (url: string) => Promise<string>
  media: MediaState
}

const MEDIA_STATE_PROPERTIES: Array<keyof MediaState> = [
  'duration',
  'readyState',
  'ended',
]

const READY_TIMEOUT_MS = 8000
const HAVE_METADATA = 1

export function installVideoPlayerEnvironment(): VideoPlayerEnvironment {
  const blobs = new Map<string, Blob>()
  let blobCounter = 0

  const createObjectURL = vi.fn((blob: Blob) => {
    blobCounter += 1

    const url = `blob:video-test-${blobCounter}`

    blobs.set(url, blob)

    return url
  })
  const revokeObjectURL = vi.fn()

  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL

  Object.defineProperty(HTMLMediaElement, 'HAVE_METADATA', {
    configurable: true,
    value: HAVE_METADATA,
  })

  const remotePlayback = document.createElement('video').remote

  if (remotePlayback) {
    Object.getPrototypeOf(remotePlayback).cancelWatchAvailability
      = async () => {
        return undefined
      }
  }

  const media: MediaState = { duration: NaN, readyState: 0, ended: false }

  for (const property of MEDIA_STATE_PROPERTIES) {
    Object.defineProperty(HTMLMediaElement.prototype, property, {
      configurable: true,
      get: () => {
        return media[property]
      },
    })
  }

  async function readBlobUrl(url: string): Promise<string> {
    const blob = blobs.get(url)

    if (!blob) {
      throw new Error(`No blob registered for ${url}`)
    }

    return await blob.text()
  }

  return { createObjectURL, revokeObjectURL, readBlobUrl, media }
}

export async function waitForPlayerReady(wrapper: VueWrapper) {
  await vi.waitFor(() => {
    const nestedShell = wrapper.findComponent(VideoShell)
    const shell = nestedShell.exists() ? nestedShell : wrapper

    expect(shell.emitted('ready')).toBeTruthy()
  }, { timeout: READY_TIMEOUT_MS })

  await flushPromises()
}

export function createStorageStub(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    clear: () => {
      entries.clear()
    },
    getItem: (key: string) => {
      return entries.get(key) ?? null
    },
    key: (index: number) => {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
  }
}
