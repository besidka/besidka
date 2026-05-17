import { auditOnly } from 'evlog'
import { createAxiomDrain } from 'evlog/axiom'
import type { DrainFn, WideEvent } from 'evlog'

interface CachedDrains {
  main: DrainFn | null
  audit: DrainFn | null
}

let cached: CachedDrains | undefined

/**
 * Build (and cache) the Axiom drain functions from runtime config.
 *
 * Why this exists:
 *   `evlog`'s Nitro plugin uses `_deferDrain: true` for the parent request
 *   logger and routes drains via `nitroApp.hooks.callHook('evlog:drain')`.
 *   Standalone `createRequestLogger().emit()` (which we use for the
 *   `operation: 'ai-stream'` child event) goes through the global drain
 *   pipeline (`globalDrain` / `globalPluginRunner.runDrain`), which is empty
 *   because the Nitro adapter doesn't wire framework drains into the global
 *   state. To make Axiom receive standalone-emitted events we have to call
 *   the same drain functions directly.
 *
 * Both `server/plugins/evlog-drain.ts` (the Nitro hook) and any code that
 * emits a standalone wide event should source their drains from here so we
 * don't duplicate Axiom credentials handling.
 */
export function getAxiomDrains(): CachedDrains {
  if (cached) {
    return cached
  }

  const config = useRuntimeConfig()
  const result: CachedDrains = { main: null, audit: null }

  if (config.axiomToken && config.axiomDataset) {
    result.main = createAxiomDrain({
      apiKey: config.axiomToken,
      dataset: config.axiomDataset,
    })
  }

  if (config.axiomAuditToken && config.axiomAuditDataset) {
    result.audit = auditOnly(createAxiomDrain({
      apiKey: config.axiomAuditToken,
      dataset: config.axiomAuditDataset,
    }))
  }

  cached = result

  return cached
}

/**
 * Ship a single wide event to all configured Axiom drains in parallel.
 * Returns the combined promise so the caller can hand it to
 * `ExecutionContext.waitUntil()` on Cloudflare Workers.
 */
export function shipWideEventToAxiom(wideEvent: WideEvent): Promise<unknown> {
  const { main, audit } = getAxiomDrains()
  const tasks: Promise<unknown>[] = []

  if (main) {
    tasks.push(
      Promise.resolve(main({ event: wideEvent })).catch((exception) => {
        // eslint-disable-next-line no-console
        console.error('[evlog] axiom main drain failed:', exception)
      }),
    )
  }

  if (audit) {
    tasks.push(
      Promise.resolve(audit({ event: wideEvent })).catch((exception) => {
        // eslint-disable-next-line no-console
        console.error('[evlog] axiom audit drain failed:', exception)
      }),
    )
  }

  return Promise.all(tasks)
}
