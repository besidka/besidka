import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WideEvent } from 'evlog'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'

const wideEvent = {
  timestamp: '2026-10-31T00:00:00.000Z',
  level: 'info',
  method: 'CRON',
  path: '/internal/jobs/example',
  status: 200,
} as WideEvent

describe('emitScheduledJobEvent', () => {
  it('emits with the status and ships the returned wide event', async () => {
    const emit = vi.fn().mockReturnValue(wideEvent)
    const shipWideEvent = vi.fn().mockResolvedValue([])

    await emitScheduledJobEvent({ emit }, 200, shipWideEvent)

    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(shipWideEvent).toHaveBeenCalledTimes(1)
    expect(shipWideEvent).toHaveBeenCalledWith(wideEvent)
  })

  it('awaits the ship before resolving', async () => {
    const emit = vi.fn().mockReturnValue(wideEvent)
    let isShipped = false
    const shipWideEvent = vi.fn(async () => {
      await Promise.resolve()
      isShipped = true
    })

    await emitScheduledJobEvent({ emit }, 500, shipWideEvent)

    expect(isShipped).toBe(true)
  })

  it('does not ship when the logger returns no event', async () => {
    const emit = vi.fn().mockReturnValue(null)
    const shipWideEvent = vi.fn()

    await emitScheduledJobEvent({ emit }, 200, shipWideEvent)

    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(shipWideEvent).not.toHaveBeenCalled()
  })

  it('never throws into the job when the ship fails', async () => {
    const emit = vi.fn().mockReturnValue(wideEvent)
    const shipWideEvent = vi.fn().mockRejectedValue(new Error('axiom down'))
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(
      emitScheduledJobEvent({ emit }, 200, shipWideEvent),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})

const pluginsDirectory = resolve(import.meta.dirname, '../../../server/plugins')

const scheduledPlugins = readdirSync(pluginsDirectory)
  .filter(fileName => fileName.endsWith('.ts'))
  .map((fileName) => {
    return {
      fileName,
      source: readFileSync(resolve(pluginsDirectory, fileName), 'utf-8'),
    }
  })
  .filter(({ source }) => source.includes('\'cloudflare:scheduled\''))

describe('scheduled plugins', () => {
  it('finds at least ten scheduled plugins', () => {
    expect(scheduledPlugins.length).toBeGreaterThanOrEqual(10)
  })

  it('ships every wide event through emitScheduledJobEvent', () => {
    const offenders = scheduledPlugins
      .filter(({ source }) => !source.includes('emitScheduledJobEvent('))
      .map(({ fileName }) => fileName)

    expect(
      offenders,
      `Missing emitScheduledJobEvent( in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('never calls a bare logger emit', () => {
    const offenders = scheduledPlugins
      .filter(({ source }) => source.includes('.emit('))
      .map(({ fileName }) => fileName)

    expect(
      offenders,
      `Direct .emit( call in: ${offenders.join(', ')}`,
    ).toEqual([])
  })
})
