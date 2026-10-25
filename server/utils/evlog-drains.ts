import { auditOnly } from 'evlog'
import { createAxiomDrain } from 'evlog/axiom'
import type { DrainContext, DrainFn, WideEvent } from 'evlog'

interface CachedDrains {
  main: DrainFn | null
  audit: DrainFn | null
  consent: DrainFn | null
}

const CLIENT_EVENT_SOURCE = 'client'

const CLIENT_ENVELOPE_KEYS = new Set([
  'timestamp',
  'level',
  'service',
  'environment',
  'version',
  'commitHash',
  'region',
  'source',
  'requestId',
  'message',
])

const CLIENT_ACTION_KEY = 'action'

const CLIENT_ACTION_MAX_LENGTH = 128

const CLIENT_BUCKET_KEY = 'client'

const CLIENT_FORBIDDEN_KEYS = new Set(['audit', 'consent'])

let cached: CachedDrains | undefined

function isClientSourcedEvent(event: WideEvent): boolean {
  return event.source === CLIENT_EVENT_SOURCE
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isEnvelopeValue(key: string, value: unknown): boolean {
  if (CLIENT_ENVELOPE_KEYS.has(key)) {
    return isScalar(value)
  }

  return key === CLIENT_ACTION_KEY
    && typeof value === 'string'
    && value.length <= CLIENT_ACTION_MAX_LENGTH
}

/**
 * Confine an event ingested from the unauthenticated evlog client route.
 * Compliance markers (`audit`, `consent`) are dropped, a client-sent
 * `attributes` object and a short scalar `action` stay addressable as-is, and
 * every other non-envelope key moves under `attributes.client`. `attributes`
 * is the Axiom map field, so client-chosen key names inside it never become
 * dataset schema fields. Drains read `audit` and `consent` at the top level
 * only, so nothing nested under `attributes` can act as a compliance marker.
 */
export function confineClientIngestEvent(event: WideEvent): void {
  if (!isClientSourcedEvent(event)) {
    return
  }

  const record = event as Record<string, unknown>
  const clientAttributes: [string, unknown][] = []
  const confinedEntries: [string, unknown][] = []

  for (const [key, value] of Object.entries(record)) {
    if (isEnvelopeValue(key, value)) {
      continue
    }

    Reflect.deleteProperty(record, key)

    if (CLIENT_FORBIDDEN_KEYS.has(key)) {
      continue
    }

    if (key === 'attributes' && isPlainRecord(value)) {
      clientAttributes.push(...Object.entries(value))

      continue
    }

    confinedEntries.push([key, value])
  }

  if (clientAttributes.length === 0 && confinedEntries.length === 0) {
    return
  }

  const attributes = Object.fromEntries(clientAttributes)

  if (confinedEntries.length > 0) {
    const existingBucket = attributes[CLIENT_BUCKET_KEY]

    attributes[CLIENT_BUCKET_KEY] = {
      ...(isPlainRecord(existingBucket) ? existingBucket : {}),
      ...Object.fromEntries(confinedEntries),
    }
  }

  record.attributes = attributes
}

/**
 * Wrap a drain so it never receives events ingested from the client route.
 */
function skipClientSourced(drain: DrainFn): DrainFn {
  return (ctx: DrainContext) => {
    if (isClientSourcedEvent(ctx.event)) {
      return
    }

    return drain(ctx)
  }
}

/**
 * Wrap a drain so it only receives wide events that carry a non-empty
 * `consent` field. Used to route consent receipts to a dedicated Axiom
 * dataset without affecting the main or audit drain pipelines.
 */
function consentOnly(drain: DrainFn): DrainFn {
  return skipClientSourced((ctx: DrainContext) => {
    const consent = (ctx.event as WideEvent & { consent?: unknown }).consent

    if (!consent || typeof consent !== 'object') {
      return
    }

    return drain(ctx)
  })
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
    result.audit = skipClientSourced(auditOnly(createAxiomDrain({
      apiKey: config.axiomAuditToken,
      dataset: config.axiomAuditDataset,
    })))
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
