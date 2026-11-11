import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, RpcError } from '@besidka/artifacts-protocol'
import type { ArtifactBridgeInfo } from '#shared/utils/artifacts'
import { ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS } from '#shared/utils/artifacts'
import type { ArtifactPanelSource } from '../../../app/composables/artifacts'
import { ARTIFACT_SHARE_HEADER } from '../../../app/composables/artifact-storage'
import {
  resolveArtifactBridgeEnabled,
  toBridgeRpcError,
  useArtifactBridge,
} from '../../../app/composables/artifact-bridge'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

interface Deferred<Value> {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (reason: unknown) => void
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const BRIDGE_URL = '/api/v1/artifacts/art_1/bridge'
const COMPLETE_URL = '/api/v1/artifacts/art_1/complete'

const INFO: ArtifactBridgeInfo = {
  models: [
    {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      providerId: 'openai',
      providerName: 'OpenAI',
      inputPricePerMillion: 0.1,
      outputPricePerMillion: 0.5,
    },
    {
      id: 'claude-haiku-5-5',
      name: 'Claude Haiku 5.5',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      inputPricePerMillion: 0.1,
      outputPricePerMillion: 0.5,
    },
  ],
  defaultModelId: 'gpt-6-luna',
  remaining: { hour: 30, day: 200 },
  limits: { hour: 30, day: 200 },
}

function completion(text: string = 'Hello') {
  return {
    text,
    modelId: 'gpt-6-luna',
    usage: { inputTokens: 10, outputTokens: 5 },
    costUsd: 0.000003,
    remaining: { hour: 29, day: 199 },
  }
}

function fetchError(
  status: number,
  reason?: string,
  message: string = `HTTP ${status}`,
) {
  return Object.assign(new Error(message), {
    statusCode: status,
    data: reason ? { data: { reason } } : {},
  })
}

function completeCalls() {
  return fetchMock.mock.calls.filter(([url]) => {
    return url === COMPLETE_URL
  })
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception
  }

  return null
}

interface BridgeSetup {
  artifactId?: string | null
  source?: ArtifactPanelSource
  shareToken?: string | null
}

function createBridge(setup: BridgeSetup = {}) {
  const artifactId = setup.artifactId === undefined
    ? 'art_1'
    : setup.artifactId

  return useArtifactBridge({
    artifactId: () => artifactId,
    title: () => 'Photosynthesis quiz',
    source: () => setup.source ?? 'owner',
    shareToken: () => setup.shareToken,
  })
}

function routeFetch(handlers: {
  bridge?: () => unknown
  complete?: (options: { body: Record<string, unknown> }) => unknown
} = {}) {
  fetchMock.mockImplementation(async (url: string, options: any) => {
    if (url === BRIDGE_URL) {
      return handlers.bridge ? handlers.bridge() : INFO
    }

    if (url === COMPLETE_URL) {
      return handlers.complete ? handlers.complete(options) : completion()
    }

    throw new Error(`Unexpected request ${url}`)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  routeFetch()
})

describe('resolveArtifactBridgeEnabled', () => {
  const allowed = {
    loggedIn: true,
    featureActive: true,
    source: 'owner' as ArtifactPanelSource,
    artifactId: 'art_1',
  }

  it('is on for a signed-in owner with the flag and an artifact id', () => {
    expect(resolveArtifactBridgeEnabled(allowed)).toBe(true)
  })

  it('is off for a signed-out viewer', () => {
    expect(resolveArtifactBridgeEnabled({ ...allowed, loggedIn: false }))
      .toBe(false)
  })

  it('is off when the flag is not active', () => {
    expect(resolveArtifactBridgeEnabled({ ...allowed, featureActive: false }))
      .toBe(false)
  })

  it('is off for an artifact from a shared chat', () => {
    expect(resolveArtifactBridgeEnabled({ ...allowed, source: 'shared' }))
      .toBe(false)
  })

  it.each([null, undefined, ''])('is off for the artifact id %j', (id) => {
    expect(resolveArtifactBridgeEnabled({ ...allowed, artifactId: id }))
      .toBe(false)
  })
})

describe('toBridgeRpcError', () => {
  it('maps 429 to rate limited', () => {
    expect(toBridgeRpcError(fetchError(429, 'bridge-rate-limit')))
      .toMatchObject({ code: ERROR_CODES.rateLimited })
  })

  it.each(['legal-consent', 'transfer-consent'])(
    'maps a 403 with the %s reason to consent required',
    (reason) => {
      expect(toBridgeRpcError(fetchError(403, reason)))
        .toMatchObject({ code: ERROR_CODES.consentRequired })
    },
  )

  it('maps a 403 with another reason to not allowed', () => {
    expect(toBridgeRpcError(fetchError(403, 'other')))
      .toMatchObject({ code: ERROR_CODES.notAllowed })
    expect(toBridgeRpcError(fetchError(403)))
      .toMatchObject({ code: ERROR_CODES.notAllowed })
  })

  it.each([400, 404, 413, 451])('maps %s to not allowed', (status) => {
    expect(toBridgeRpcError(fetchError(status, 'bridge_no_key')))
      .toMatchObject({ code: ERROR_CODES.notAllowed })
  })

  it.each([500, 502, 503])('maps %s to an internal error', (status) => {
    expect(toBridgeRpcError(fetchError(status)))
      .toMatchObject({ code: ERROR_CODES.internalError })
  })

  it('maps an error without a status to an internal error', () => {
    expect(toBridgeRpcError(new Error('Failed to fetch')))
      .toMatchObject({ code: ERROR_CODES.internalError })
    expect(toBridgeRpcError(undefined))
      .toMatchObject({ code: ERROR_CODES.internalError })
    expect(toBridgeRpcError(null))
      .toMatchObject({ code: ERROR_CODES.internalError })
  })

  it('reads the status property when there is no statusCode', () => {
    expect(toBridgeRpcError(Object.assign(new Error('x'), { status: 429 })))
      .toMatchObject({ code: ERROR_CODES.rateLimited })
  })

  it('returns an RpcError with fixed text, never the server text', () => {
    const error = toBridgeRpcError(
      fetchError(502, undefined, 'Secret server detail'),
    )

    expect(error).toBeInstanceOf(RpcError)
    expect(error.message).toBe('AI request failed')
    expect(error.message).not.toContain('Secret')
  })
})

describe('useArtifactBridge', () => {
  describe('asking the viewer', () => {
    it('opens a pending request with the prompt, system text and title',
      async () => {
        const bridge = createBridge()
        const promise = bridge.complete({
          prompt: 'Explain',
          system: 'Be brief',
          maxOutputTokens: 300,
        })

        expect(bridge.pending.value).toMatchObject({
          artifactId: 'art_1',
          title: 'Photosynthesis quiz',
          prompt: 'Explain',
          system: 'Be brief',
          maxOutputTokens: 300,
          allowRemember: true,
          info: null,
          isLoadingInfo: true,
          isRunning: false,
          error: null,
        })

        bridge.cancel()
        await rejectionOf(promise)
      })

    it('defaults the shown token budget to 1000', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      expect(bridge.pending.value?.maxOutputTokens)
        .toBe(ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS)
      expect(bridge.pending.value?.system).toBeUndefined()

      bridge.cancel()
      await rejectionOf(promise)
    })

    it('loads the models and the remaining calls for the modal', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith(BRIDGE_URL, { headers: {} })
      expect(bridge.pending.value).toMatchObject({
        info: INFO,
        infoError: null,
        isLoadingInfo: false,
      })

      bridge.cancel()
      await rejectionOf(promise)
    })

    it('does not call the model until the viewer allows', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()

      expect(completeCalls()).toHaveLength(0)

      bridge.cancel()
      await rejectionOf(promise)
    })

    it('encodes the artifact id in both URLs', async () => {
      const bridge = createBridge({ artifactId: 'art/1 x' })
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()

      expect(fetchMock.mock.calls[0]![0])
        .toBe('/api/v1/artifacts/art%2F1%20x/bridge')

      bridge.cancel()
      await rejectionOf(promise)
    })

    it('sends the share token header when there is a token', async () => {
      const bridge = createBridge({ shareToken: 'tok_1' })
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      await promise

      expect(fetchMock).toHaveBeenCalledWith(BRIDGE_URL, {
        headers: { [ARTIFACT_SHARE_HEADER]: 'tok_1' },
      })
      expect(fetchMock).toHaveBeenCalledWith(
        COMPLETE_URL,
        expect.objectContaining({
          headers: { [ARTIFACT_SHARE_HEADER]: 'tok_1' },
        }),
      )
    })

    it('refuses as not allowed when the artifact has no saved id',
      async () => {
        const bridge = createBridge({ artifactId: null })

        await expect(bridge.complete({ prompt: 'Explain' }))
          .rejects.toMatchObject({ code: ERROR_CODES.notAllowed })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(bridge.pending.value).toBeNull()
      })

    it('keeps the modal open with an error when the models fail to load',
      async () => {
        routeFetch({
          bridge: () => {
            throw fetchError(500, undefined, 'Models unavailable')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()

        expect(bridge.pending.value).toMatchObject({
          info: null,
          isLoadingInfo: false,
        })
        expect(bridge.pending.value?.infoError?.message).toBeTruthy()

        bridge.cancel()
        await rejectionOf(promise)
      })

    it('words a no-key refusal while loading as a provider key problem',
      async () => {
        routeFetch({
          bridge: () => {
            throw fetchError(400, 'bridge_no_key')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()

        expect(bridge.pending.value?.infoError?.message)
          .toBe('This needs a direct provider key')

        bridge.cancel()
        await rejectionOf(promise)
      })
  })

  describe('allowing', () => {
    it('sends the prompt to the chosen model and resolves with the text',
      async () => {
        routeFetch({ complete: () => completion('Plants make sugar') })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        bridge.allow('claude-haiku-5-5', false)

        await expect(promise).resolves.toEqual({ text: 'Plants make sugar' })
        expect(completeCalls()).toHaveLength(1)
        expect(completeCalls()[0]![1]).toMatchObject({
          method: 'POST',
          body: {
            prompt: 'Explain',
            modelId: 'claude-haiku-5-5',
            maxOutputTokens: ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
          },
        })
        expect(bridge.pending.value).toBeNull()
      })

    it('includes the system text and the token budget when given',
      async () => {
        const bridge = createBridge()
        const promise = bridge.complete({
          prompt: 'Explain',
          system: 'Be brief',
          maxOutputTokens: 250,
        })

        await flushPromises()
        bridge.allow('gpt-6-luna', false)
        await promise

        expect(completeCalls()[0]![1].body).toEqual({
          prompt: 'Explain',
          system: 'Be brief',
          modelId: 'gpt-6-luna',
          maxOutputTokens: 250,
        })
      })

    it('leaves the system key out when the artifact gave none', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain', system: '' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      await promise

      expect(completeCalls()[0]![1].body).not.toHaveProperty('system')
    })

    it('returns only the text, never the cost or usage', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)

      expect(Object.keys(await promise)).toEqual(['text'])
    })

    it('marks the request as running while the call is in flight',
      async () => {
        const reply = createDeferred<ReturnType<typeof completion>>()

        routeFetch({ complete: () => reply.promise })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        bridge.allow('gpt-6-luna', false)

        expect(bridge.pending.value?.isRunning).toBe(true)

        reply.resolve(completion())
        await promise

        expect(bridge.pending.value).toBeNull()
      })

    it('ignores a second allow while the call is running', async () => {
      const reply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => reply.promise })

      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      bridge.allow('gpt-6-luna', false)
      await flushPromises()

      expect(completeCalls()).toHaveLength(1)

      reply.resolve(completion())
      await promise
    })

    it('does nothing when there is no open request', async () => {
      const bridge = createBridge()

      await bridge.allow('gpt-6-luna', false)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps the modal open with an error when the call fails',
      async () => {
        routeFetch({
          complete: () => {
            throw fetchError(502, undefined, 'The model request failed')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        await bridge.allow('gpt-6-luna', false)

        expect(bridge.pending.value).toMatchObject({
          isRunning: false,
          error: { message: expect.any(String) },
          lastFailure: { code: ERROR_CODES.internalError },
        })

        bridge.cancel()
        await rejectionOf(promise)
      })

    it('lets the viewer try again after a failure', async () => {
      let attempts = 0

      routeFetch({
        complete: () => {
          attempts += 1

          if (attempts === 1) {
            throw fetchError(502)
          }

          return completion('Second time')
        },
      })

      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      await bridge.allow('gpt-6-luna', false)
      await bridge.allow('gpt-6-luna', false)

      await expect(promise).resolves.toEqual({ text: 'Second time' })
      expect(bridge.pending.value).toBeNull()
    })

    it('clears the previous error when the viewer tries again', async () => {
      const reply = createDeferred<ReturnType<typeof completion>>()
      let attempts = 0

      routeFetch({
        complete: () => {
          attempts += 1

          if (attempts === 1) {
            throw fetchError(502)
          }

          return reply.promise
        },
      })

      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      await bridge.allow('gpt-6-luna', false)

      expect(bridge.pending.value?.error).not.toBeNull()

      bridge.allow('gpt-6-luna', false)

      expect(bridge.pending.value?.error).toBeNull()
      expect(bridge.pending.value?.isRunning).toBe(true)

      reply.resolve(completion())
      await promise
    })
  })

  describe('cancelling', () => {
    it('rejects with declined by the viewer', async () => {
      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      bridge.cancel()

      await expect(promise).rejects.toMatchObject({
        code: ERROR_CODES.declinedByViewer,
      })
      expect(bridge.pending.value).toBeNull()
      expect(completeCalls()).toHaveLength(0)
    })

    it('rejects with the last failure code after a failed attempt',
      async () => {
        routeFetch({
          complete: () => {
            throw fetchError(429, 'bridge-rate-limit')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        await bridge.allow('gpt-6-luna', false)
        bridge.cancel()

        await expect(promise).rejects.toMatchObject({
          code: ERROR_CODES.rateLimited,
        })
      })

    it('maps a consent failure to consent required on cancel', async () => {
      routeFetch({
        complete: () => {
          throw fetchError(403, 'transfer-consent')
        },
      })

      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      await bridge.allow('gpt-6-luna', false)
      bridge.cancel()

      await expect(promise).rejects.toMatchObject({
        code: ERROR_CODES.consentRequired,
      })
    })

    it('rejects with the mapped code when loading the models failed',
      async () => {
        routeFetch({
          bridge: () => {
            throw fetchError(403, 'legal-consent')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()

        expect(bridge.pending.value?.lastFailure).toMatchObject({
          code: ERROR_CODES.consentRequired,
        })

        bridge.cancel()

        await expect(promise).rejects.toMatchObject({
          code: ERROR_CODES.consentRequired,
        })
      })

    it('maps a failed models request to a rate limit on cancel',
      async () => {
        routeFetch({
          bridge: () => {
            throw fetchError(429, 'bridge-rate-limit')
          },
        })

        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        bridge.cancel()

        await expect(promise).rejects.toMatchObject({
          code: ERROR_CODES.rateLimited,
        })
      })

    it('does not cancel while the call is running', async () => {
      const reply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => reply.promise })

      const bridge = createBridge()
      const promise = bridge.complete({ prompt: 'Explain' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      bridge.cancel()

      expect(bridge.pending.value).not.toBeNull()

      reply.resolve(completion('Done'))

      await expect(promise).resolves.toEqual({ text: 'Done' })
    })

    it('does nothing without an open request', () => {
      const bridge = createBridge()

      expect(() => bridge.cancel()).not.toThrow()
    })

    it('accepts a new request after a cancel', async () => {
      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.cancel()
      await rejectionOf(first)

      const second = bridge.complete({ prompt: 'Second' })

      await flushPromises()

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.allow('gpt-6-luna', false)

      await expect(second).resolves.toEqual({ text: 'Hello' })
    })
  })

  describe('one request at a time', () => {
    it('refuses a second call while the modal is open', async () => {
      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await expect(bridge.complete({ prompt: 'Second' })).rejects
        .toMatchObject({ code: ERROR_CODES.rateLimited })
      expect(bridge.pending.value?.prompt).toBe('First')

      bridge.cancel()
      await rejectionOf(first)
    })

    it('still lets the first call finish after refusing the second',
      async () => {
        const bridge = createBridge()
        const first = bridge.complete({ prompt: 'First' })

        await rejectionOf(bridge.complete({ prompt: 'Second' }))
        await flushPromises()
        bridge.allow('gpt-6-luna', false)

        await expect(first).resolves.toEqual({ text: 'Hello' })
      })

    it('refuses a second call while the first one runs', async () => {
      const reply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => reply.promise })

      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)

      await expect(bridge.complete({ prompt: 'Second' })).rejects
        .toMatchObject({ code: ERROR_CODES.rateLimited })

      reply.resolve(completion())
      await first
    })

    it('accepts the next call after the first resolved', async () => {
      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      await first

      const second = bridge.complete({ prompt: 'Second' })

      await flushPromises()

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.cancel()
      await rejectionOf(second)
    })
  })

  describe('remembering the choice', () => {
    async function allowAndRemember(bridge: ReturnType<typeof createBridge>) {
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('claude-haiku-5-5', true)
      await first
      fetchMock.mockClear()
    }

    it('skips the modal on the next call and reuses the model', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)

      await expect(bridge.complete({ prompt: 'Second' }))
        .resolves.toEqual({ text: 'Hello' })

      expect(bridge.pending.value).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(completeCalls()[0]![1].body).toMatchObject({
        prompt: 'Second',
        modelId: 'claude-haiku-5-5',
      })
    })

    it('still sends the system text and token budget on a remembered call',
      async () => {
        const bridge = createBridge()

        await allowAndRemember(bridge)
        await bridge.complete({
          prompt: 'Second',
          system: 'Be brief',
          maxOutputTokens: 120,
        })

        expect(completeCalls()[0]![1].body).toEqual({
          prompt: 'Second',
          system: 'Be brief',
          modelId: 'claude-haiku-5-5',
          maxOutputTokens: 120,
        })
      })

    it('does not remember when the viewer did not tick the box', async () => {
      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      await first

      const second = bridge.complete({ prompt: 'Second' })

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.cancel()
      await rejectionOf(second)
    })

    it('does not offer or keep the choice for a shared chat', async () => {
      const bridge = createBridge({ source: 'shared' })
      const first = bridge.complete({ prompt: 'First' })

      expect(bridge.pending.value?.allowRemember).toBe(false)

      await flushPromises()
      bridge.allow('gpt-6-luna', true)
      await first

      const second = bridge.complete({ prompt: 'Second' })

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.cancel()
      await rejectionOf(second)
    })

    it('maps a failed remembered call to an RPC error', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)
      routeFetch({
        complete: () => {
          throw fetchError(429, 'bridge-rate-limit')
        },
      })

      await expect(bridge.complete({ prompt: 'Second' }))
        .rejects.toMatchObject({ code: ERROR_CODES.rateLimited })
      expect(bridge.pending.value).toBeNull()
    })

    it('asks again after a failed remembered call', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)
      routeFetch({
        complete: () => {
          throw fetchError(502)
        },
      })
      await rejectionOf(bridge.complete({ prompt: 'Second' }))
      routeFetch()

      const third = bridge.complete({ prompt: 'Third' })

      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(bridge.pending.value?.prompt).toBe('Third')

      bridge.cancel()

      await expect(third)
        .rejects.toMatchObject({ code: ERROR_CODES.declinedByViewer })
    })

    it('refuses a concurrent call while a remembered one runs', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)

      const reply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => reply.promise })

      const second = bridge.complete({ prompt: 'Second' })

      await expect(bridge.complete({ prompt: 'Third' }))
        .rejects.toMatchObject({ code: ERROR_CODES.rateLimited })

      reply.resolve(completion())
      await second
    })

    it('keeps the new session busy when a disposed remembered call '
      + 'settles late', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)

      const lateReply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => lateReply.promise })

      const stale = bridge.complete({ prompt: 'Stale' })

      bridge.dispose()
      routeFetch()

      const fresh = bridge.complete({ prompt: 'Fresh' })

      await flushPromises()
      expect(bridge.pending.value?.prompt).toBe('Fresh')

      lateReply.resolve(completion('Late'))
      await stale
      await flushPromises()

      await expect(bridge.complete({ prompt: 'Third' }))
        .rejects.toMatchObject({ code: ERROR_CODES.rateLimited })
      expect(bridge.pending.value?.prompt).toBe('Fresh')

      bridge.cancel()
      await rejectionOf(fresh)
    })

    it('keeps the new session choice when a disposed remembered call '
      + 'fails late', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)

      const lateReply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => lateReply.promise })

      const stale = bridge.complete({ prompt: 'Stale' })

      bridge.dispose()
      routeFetch()

      const fresh = bridge.complete({ prompt: 'Fresh' })

      await flushPromises()
      bridge.allow('claude-haiku-5-5', true)
      await fresh
      fetchMock.mockClear()

      lateReply.reject(fetchError(502))
      await rejectionOf(stale)

      await expect(bridge.complete({ prompt: 'Next' }))
        .resolves.toEqual({ text: 'Hello' })
      expect(bridge.pending.value).toBeNull()
      expect(completeCalls()).toHaveLength(1)
    })

    it('forgets the choice when the frame is disposed', async () => {
      const bridge = createBridge()

      await allowAndRemember(bridge)
      bridge.dispose()

      const second = bridge.complete({ prompt: 'Second' })

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.cancel()
      await rejectionOf(second)
    })
  })

  describe('closing the frame', () => {
    it('rejects the open request as declined and clears the modal',
      async () => {
        const bridge = createBridge()
        const promise = bridge.complete({ prompt: 'Explain' })

        await flushPromises()
        bridge.dispose()

        await expect(promise).rejects.toMatchObject({
          code: ERROR_CODES.declinedByViewer,
        })
        expect(bridge.pending.value).toBeNull()
      })

    it('does nothing when no request is open', () => {
      const bridge = createBridge()

      expect(() => bridge.dispose()).not.toThrow()
      expect(bridge.pending.value).toBeNull()
    })

    it('frees the bridge for the next frame session', async () => {
      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.dispose()
      await rejectionOf(first)

      const second = bridge.complete({ prompt: 'Second' })

      await flushPromises()

      expect(bridge.pending.value?.prompt).toBe('Second')

      bridge.cancel()
      await rejectionOf(second)
    })

    it('ignores a late answer for a request that was disposed', async () => {
      const lateReply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => lateReply.promise })

      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('gpt-6-luna', true)
      bridge.dispose()
      await rejectionOf(first)

      routeFetch()

      const second = bridge.complete({ prompt: 'Second' })

      await flushPromises()
      lateReply.resolve(completion('Stale answer'))
      await flushPromises()

      expect(bridge.pending.value?.prompt).toBe('Second')
      expect(bridge.pending.value?.isRunning).toBe(false)

      bridge.cancel()
      await rejectionOf(second)

      const third = bridge.complete({ prompt: 'Third' })

      expect(bridge.pending.value?.prompt).toBe('Third')

      bridge.cancel()
      await rejectionOf(third)
    })

    it('ignores a late failure for a request that was disposed', async () => {
      const lateReply = createDeferred<ReturnType<typeof completion>>()

      routeFetch({ complete: () => lateReply.promise })

      const bridge = createBridge()
      const first = bridge.complete({ prompt: 'First' })

      await flushPromises()
      bridge.allow('gpt-6-luna', false)
      bridge.dispose()
      await rejectionOf(first)

      routeFetch()

      const second = bridge.complete({ prompt: 'Second' })

      await flushPromises()
      lateReply.reject(fetchError(502))
      await flushPromises()

      expect(bridge.pending.value?.error).toBeNull()
      expect(bridge.pending.value?.lastFailure).toBeNull()

      bridge.cancel()
      await rejectionOf(second)
    })
  })
})
