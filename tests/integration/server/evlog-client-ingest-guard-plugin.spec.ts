import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from 'evlog'

type EnrichContext = { event: WideEvent }
type EnrichHook = (context: EnrichContext) => void

async function registerGuard() {
  const hooks: Record<string, EnrichHook> = {}
  const nitroApp = {
    hooks: {
      hook: vi.fn((name: string, handler: EnrichHook) => {
        hooks[name] = handler
      }),
    },
  }
  const { default: plugin } = await import(
    '../../../server/plugins/00.evlog-client-ingest-guard'
  )

  await (plugin as (app: unknown) => unknown)(nitroApp)

  return { hooks, nitroApp }
}

describe('evlog client ingest guard plugin', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  it('registers an evlog:enrich hook', async () => {
    const { nitroApp } = await registerGuard()

    expect(nitroApp.hooks.hook).toHaveBeenCalledWith(
      'evlog:enrich',
      expect.any(Function),
    )
  })

  it('strips audit and consent and confines unknown keys for client events', async () => {
    const { hooks } = await registerGuard()
    const event = {
      timestamp: '2026-10-24T10:00:00.000Z',
      level: 'info',
      service: 'besidka',
      environment: 'test',
      source: 'client',
      audit: { action: 'consent.receipt' },
      consent: { id: 'forged' },
      forged_field: 'value',
    } as unknown as WideEvent

    hooks['evlog:enrich']!({ event })

    expect(event).not.toHaveProperty('audit')
    expect(event).not.toHaveProperty('consent')
    expect(event).not.toHaveProperty('forged_field')
    expect(event.attributes).toEqual({ client: { forged_field: 'value' } })
  })

  it('keeps the app.vue error-boundary payload addressable', async () => {
    const { hooks } = await registerGuard()
    const clientError = { name: 'TypeError', route: '/chats/abc' }
    const event = {
      timestamp: '2026-10-24T10:00:00.000Z',
      level: 'info',
      service: 'besidka',
      environment: 'test',
      source: 'client',
      action: 'client-error-boundary',
      attributes: { clientError },
    } as unknown as WideEvent

    hooks['evlog:enrich']!({ event })

    expect(event).toHaveProperty('action', 'client-error-boundary')
    expect(event.attributes).toEqual({ clientError })
  })

  it('does not touch server-sourced events', async () => {
    const { hooks } = await registerGuard()
    const event = {
      timestamp: '2026-10-24T10:00:00.000Z',
      level: 'info',
      service: 'besidka',
      environment: 'test',
      audit: { action: 'chat.delete' },
      requestMeta: { cfRay: 'abc' },
    } as unknown as WideEvent
    const snapshot = structuredClone(event)

    hooks['evlog:enrich']!({ event })

    expect(event).toEqual(snapshot)
  })
})
