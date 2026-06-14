import { auditOnly } from 'evlog'
import { createAxiomDrain } from 'evlog/axiom'
import type { DrainContext, DrainFn, WideEvent } from 'evlog'

interface CachedDrains {
  main: DrainFn | null
  audit: DrainFn | null
  consent: DrainFn | null
}

let cached: CachedDrains | undefined

/**
 * Wrap a drain so it only receives wide events that carry a non-empty
 * `consent` field. Used to route consent receipts to a dedicated Axiom
 * dataset without affecting the main or audit drain pipelines.
 */
function consentOnly(drain: DrainFn): DrainFn {
  return (ctx: DrainContext) => {
    const consent = (ctx.event as WideEvent & { consent?: unknown }).consent

    if (!consent || typeof consent !== 'object') {
      return
    }

    return drain(ctx)
  }
}

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
  const result: CachedDrains = { main: null, audit: null, consent: null }

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

  if (config.axiomConsentToken && config.axiomConsentDataset) {
    result.consent = consentOnly(createAxiomDrain({
      apiKey: config.axiomConsentToken,
      dataset: config.axiomConsentDataset,
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
  const { main, audit, consent } = getAxiomDrains()
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

  if (consent) {
    tasks.push(
      Promise.resolve(consent({ event: wideEvent })).catch((exception) => {
        // eslint-disable-next-line no-console
        console.error('[evlog] axiom consent drain failed:', exception)
      }),
    )
  }

  return Promise.all(tasks)
}
