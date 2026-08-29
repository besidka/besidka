import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const mocks = vi.hoisted(() => ({
  getOwnedGeneratedImageFilesByStorageKeys: vi.fn(),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  getOwnedGeneratedImageFilesByStorageKeys:
    mocks.getOwnedGeneratedImageFilesByStorageKeys,
}))

const { reconstructGeneratedImageParts } = await import(
  '../../../server/utils/files/reconstruct-generated-image-parts'
)

function createFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    storageKey: 'generated.png',
    name: 'sunset.png',
    size: 4760,
    type: 'image/png',
    originProvider: 'openai',
    originModel: 'gpt-image-2',
    ...overrides,
  }
}

function buildMessage(url: string): { parts: UIMessage['parts'] } {
  return {
    parts: [{
      type: 'file',
      mediaType: 'image/png',
      filename: 'sunset.png',
      url,
    }] as UIMessage['parts'],
  }
}

describe('reconstructGeneratedImageParts', () => {
  afterEach(() => {
    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockReset()
  })

  it('rewrites a direct-provider (openai/google) origin file into a '
    + 'tool-generate_image part', async () => {
    const file = createFileRow()

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map([[file.storageKey, file]]),
    )

    const messages = [buildMessage(`/files/${file.storageKey}`)]
    const result = await reconstructGeneratedImageParts(messages, 1)

    expect(result[0]?.parts[0]).toMatchObject({
      type: 'tool-generate_image',
      state: 'output-available',
      output: expect.objectContaining({
        status: 'ready',
        provider: 'openai',
        model: 'gpt-image-2',
      }),
    })
  })

  it('never reconstructs a file from a non-allowlisted origin provider, '
    + 'leaving the plain file part untouched so it keeps rendering through '
    + 'the generic file-part path', async () => {
    const file = createFileRow({
      originProvider: 'anthropic',
      originModel: 'claude-opus-5',
    })

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map([[file.storageKey, file]]),
    )

    const messages = [buildMessage(`/files/${file.storageKey}`)]
    const result = await reconstructGeneratedImageParts(messages, 1)

    expect(result[0]?.parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'sunset.png',
      url: `/files/${file.storageKey}`,
    })
  })

  it('never reconstructs a file from an unrecognized origin provider '
    + 'either', async () => {
    const file = createFileRow({
      originProvider: 'some-unrecognized-provider',
      originModel: 'unrecognized-model',
    })

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map([[file.storageKey, file]]),
    )

    const messages = [buildMessage(`/files/${file.storageKey}`)]
    const result = await reconstructGeneratedImageParts(messages, 1)

    expect(result[0]?.parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'sunset.png',
      url: `/files/${file.storageKey}`,
    })
  })

  it('leaves a file untouched when origin metadata is entirely absent',
    async () => {
      const file = createFileRow({
        originProvider: null,
        originModel: null,
      })

      mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
        new Map([[file.storageKey, file]]),
      )

      const messages = [buildMessage(`/files/${file.storageKey}`)]
      const result = await reconstructGeneratedImageParts(messages, 1)

      expect(result[0]?.parts[0]).toEqual({
        type: 'file',
        mediaType: 'image/png',
        filename: 'sunset.png',
        url: `/files/${file.storageKey}`,
      })
    })

  it('returns messages unchanged when no generated files match', async () => {
    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map(),
    )

    const messages = [buildMessage('/files/unrelated.png')]
    const result = await reconstructGeneratedImageParts(messages, 1)

    expect(result).toBe(messages)
  })
})
