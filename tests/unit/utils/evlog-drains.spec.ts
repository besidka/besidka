import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from 'evlog'

const mocks = vi.hoisted(() => ({
  drainsByDataset: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('evlog/axiom', () => ({
  createAxiomDrain: (options: { dataset: string }) => {
    const spy = vi.fn()

    mocks.drainsByDataset[options.dataset] = spy

    return spy
  },
}))

mockNuxtImport('useRuntimeConfig', (original) => {
  return () => ({
    ...original(),
    axiomToken: 'main-token',
    axiomDataset: 'main-dataset',
    axiomAuditToken: 'audit-token',
    axiomAuditDataset: 'audit-dataset',
    axiomConsentToken: 'consent-token',
    axiomConsentDataset: 'consent-dataset',
  })
})

function createServerEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-10-24T10:00:00.000Z',
    level: 'info',
    service: 'besidka',
    environment: 'test',
    ...overrides,
  } as WideEvent
}

function createClientEvent(overrides: Record<string, unknown> = {}) {
  return createServerEvent({
    source: 'client',
    audit: {
      action: 'consent.receipt',
      actor: { id: 'dummy', type: 'user' },
    },
    consent: { id: 'dummy', decision: 'all', granted: ['arbitrary text'] },
    ...overrides,
  })
}

async function loadDrains() {
  vi.resetModules()
  mocks.drainsByDataset = {}

  const module = await import('../../../server/utils/evlog-drains')

  return { ...module, spies: mocks.drainsByDataset }
}

describe('getAxiomDrains', () => {
  beforeEach(() => {
    mocks.drainsByDataset = {}
  })

  it('does not forward client-sourced events to the audit drain', async () => {
    const { getAxiomDrains, spies } = await loadDrains()

    await getAxiomDrains().audit?.({ event: createClientEvent() })

    expect(spies['audit-dataset']).not.toHaveBeenCalled()
  })

  it('does not forward client-sourced events to the consent drain', async () => {
    const { getAxiomDrains, spies } = await loadDrains()

    await getAxiomDrains().consent?.({ event: createClientEvent() })

    expect(spies['consent-dataset']).not.toHaveBeenCalled()
  })

  it('still forwards client-sourced events to the main drain', async () => {
    const { getAxiomDrains, spies } = await loadDrains()
    const event = createClientEvent()

    await getAxiomDrains().main?.({ event })

    expect(spies['main-dataset']).toHaveBeenCalledWith({ event })
  })

  it('forwards server-sourced audit events to the audit drain', async () => {
    const { getAxiomDrains, spies } = await loadDrains()
    const event = createServerEvent({
      audit: { action: 'consent.receipt', actor: { id: 'u', type: 'user' } },
    })

    await getAxiomDrains().audit?.({ event })

    expect(spies['audit-dataset']).toHaveBeenCalledTimes(1)
  })

  it('forwards server-sourced consent events to the consent drain', async () => {
    const { getAxiomDrains, spies } = await loadDrains()
    const event = createServerEvent({ consent: { id: 'receipt' } })

    await getAxiomDrains().consent?.({ event })

    expect(spies['consent-dataset']).toHaveBeenCalledWith({ event })
  })

  it('skips the consent drain for events without a consent object', async () => {
    const { getAxiomDrains, spies } = await loadDrains()

    await getAxiomDrains().consent?.({ event: createServerEvent() })

    expect(spies['consent-dataset']).not.toHaveBeenCalled()
  })
})

describe('shipWideEventToAxiom', () => {
  it('keeps client-sourced events out of audit and consent datasets', async () => {
    const { shipWideEventToAxiom, spies } = await loadDrains()

    await shipWideEventToAxiom(createClientEvent())

    expect(spies['main-dataset']).toHaveBeenCalledTimes(1)
    expect(spies['audit-dataset']).not.toHaveBeenCalled()
    expect(spies['consent-dataset']).not.toHaveBeenCalled()
  })
})

describe('confineClientIngestEvent', () => {
  it('leaves server-sourced events untouched', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createServerEvent({ audit: { action: 'x' }, extra: 1 })
    const snapshot = structuredClone(event)

    confineClientIngestEvent(event)

    expect(event).toEqual(snapshot)
  })

  it('strips audit and consent from client-sourced events', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent()

    confineClientIngestEvent(event)

    expect(event).not.toHaveProperty('audit')
    expect(event).not.toHaveProperty('consent')
    expect(event.attributes).toBeUndefined()
  })

  it('moves unknown top-level keys under attributes.client', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({
      userId: '42',
      field_a: { nested: true },
    })

    confineClientIngestEvent(event)

    expect(event).not.toHaveProperty('userId')
    expect(event).not.toHaveProperty('field_a')
    expect(event.attributes).toEqual({
      client: {
        userId: '42',
        field_a: { nested: true },
      },
    })
  })

  it('keeps a short scalar action at the top level', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({ action: 'client-error-boundary' })

    confineClientIngestEvent(event)

    expect(event).toHaveProperty('action', 'client-error-boundary')
    expect(event.attributes).toBeUndefined()
  })

  it('moves an oversized action under attributes.client', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const longAction = 'a'.repeat(129)
    const event = createClientEvent({ action: longAction })

    confineClientIngestEvent(event)

    expect(event).not.toHaveProperty('action')
    expect(event.attributes).toEqual({ client: { action: longAction } })
  })

  it('moves a non-string action under attributes.client', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({ action: { nested: true } })

    confineClientIngestEvent(event)

    expect(event).not.toHaveProperty('action')
    expect(event.attributes).toEqual({
      client: { action: { nested: true } },
    })
  })

  it('keeps reserved envelope fields at the top level', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({
      message: 'hello',
      requestId: 'request-1',
      version: '1.0.0',
    })

    confineClientIngestEvent(event)

    expect(event).toMatchObject({
      timestamp: '2026-10-24T10:00:00.000Z',
      level: 'info',
      service: 'besidka',
      environment: 'test',
      source: 'client',
      message: 'hello',
      requestId: 'request-1',
      version: '1.0.0',
    })
  })

  it('moves reserved keys carrying non-scalar values under attributes.client', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({
      message: { a: 1, b: 2 },
      region: ['x'],
    })

    confineClientIngestEvent(event)

    expect(event).not.toHaveProperty('message')
    expect(event).not.toHaveProperty('region')
    expect(event.attributes).toEqual({
      client: { message: { a: 1, b: 2 }, region: ['x'] },
    })
  })

  it('keeps the app.vue error-boundary payload addressable', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const clientError = {
      name: 'TypeError',
      message: 'boom',
      stack: 'TypeError: boom',
      route: '/chats/abc',
    }
    const event = createClientEvent({
      action: 'client-error-boundary',
      attributes: { clientError },
    })

    confineClientIngestEvent(event)

    expect(event).toHaveProperty('action', 'client-error-boundary')
    expect(event.attributes).toEqual({ clientError })
  })

  it('merges client attributes as-is next to the client bucket', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({
      attributes: { clientError: { name: 'TypeError' } },
      userId: '42',
    })

    confineClientIngestEvent(event)

    expect(event.attributes).toEqual({
      clientError: { name: 'TypeError' },
      client: { userId: '42' },
    })
  })

  it('merges unknown keys into a client-sent attributes.client object', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({
      attributes: { client: { kept: 1 } },
      userId: '42',
    })

    confineClientIngestEvent(event)

    expect(event.attributes).toEqual({ client: { kept: 1, userId: '42' } })
  })

  it('leaves audit and consent nested in attributes inert for every drain', async () => {
    const { confineClientIngestEvent, shipWideEventToAxiom, spies }
      = await loadDrains()
    const event = createClientEvent({
      attributes: {
        audit: { action: 'consent.receipt' },
        consent: { id: 'forged' },
      },
    })

    confineClientIngestEvent(event)
    await shipWideEventToAxiom(event)

    expect(event).not.toHaveProperty('audit')
    expect(event).not.toHaveProperty('consent')
    expect(spies['main-dataset']).toHaveBeenCalledTimes(1)
    expect(spies['audit-dataset']).not.toHaveBeenCalled()
    expect(spies['consent-dataset']).not.toHaveBeenCalled()
  })

  it('keeps a non-object attributes value as an ordinary client key', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const event = createClientEvent({ attributes: 'text' })

    confineClientIngestEvent(event)

    expect(event.attributes).toEqual({ client: { attributes: 'text' } })
  })

  it('confines hundreds of attacker-named keys to a single map field', async () => {
    const { confineClientIngestEvent } = await loadDrains()
    const attackerKeys = Object.fromEntries(
      Array.from({ length: 300 }, (_value, index) => [`f${index}`, index]),
    )
    const event = createClientEvent(attackerKeys)

    confineClientIngestEvent(event)

    expect(Object.keys(event).sort()).toEqual([
      'attributes',
      'environment',
      'level',
      'service',
      'source',
      'timestamp',
    ])
    expect(Object.keys(event.attributes as object)).toEqual(['client'])
  })
})
