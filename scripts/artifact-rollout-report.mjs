#!/usr/bin/env node

/**
 * Prints `artifacts*` rollout exposures from Cloudflare Workers Analytics
 * Engine: one row per flag, variant and reason. Exposure is written only for
 * hash-based rollout decisions (blobs: event, flag, variant, reason; no user
 * id, see docs/feature-flags.md), so grants and roles never appear here.
 * Read it next to the Axiom dashboard "besidka-artifacts" during each rollout
 * step (docs/artifacts.md "Rollout").
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ANALYTICS_TOKEN=... \
 *     node scripts/artifact-rollout-report.mjs [--days=7] \
 *       [--dataset=besidka_cms_events] [--prefix=artifacts]
 *
 * The token needs only "Account Analytics: Read". CLOUDFLARE_API_TOKEN is
 * used when CLOUDFLARE_ANALYTICS_TOKEN is not set.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_DATASET = 'besidka_cms_events'
export const DEFAULT_DAYS = 7
export const DEFAULT_PREFIX = 'artifacts'
export const MAX_DAYS = 90
const NAME_PATTERN = /^[a-z0-9_]+$/i
const PREFIX_PATTERN = /^[a-z0-9.-]+$/

export function parseReportArguments(argumentList) {
  const options = {
    days: DEFAULT_DAYS,
    dataset: DEFAULT_DATASET,
    prefix: DEFAULT_PREFIX,
  }

  for (const argument of argumentList) {
    const [flag, value] = argument.split('=')

    if (flag === '--days') {
      options.days = Number(value)
    } else if (flag === '--dataset') {
      options.dataset = value
    } else if (flag === '--prefix') {
      options.prefix = value
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!Number.isInteger(options.days)
    || options.days < 1
    || options.days > MAX_DAYS) {
    throw new Error(`--days must be a whole number from 1 to ${MAX_DAYS}.`)
  }

  if (!NAME_PATTERN.test(options.dataset ?? '')) {
    throw new Error('--dataset may only contain letters, digits and _.')
  }

  if (!PREFIX_PATTERN.test(options.prefix ?? '')) {
    throw new Error('--prefix may only contain a-z, 0-9, . and -.')
  }

  return options
}

/**
 * The prefix and dataset are validated against strict patterns before they
 * reach the SQL text, which Analytics Engine takes without bind parameters.
 */
export function buildExposureQuery({ dataset, days, prefix }) {
  return `
SELECT
  blob2 AS flag,
  blob3 AS variant,
  blob4 AS reason,
  toDate(timestamp) AS day,
  SUM(_sample_interval) AS exposures
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
  AND blob1 = 'feature_exposure'
  AND (blob2 = '${prefix}' OR startsWith(blob2, '${prefix}.'))
GROUP BY flag, variant, reason, day
ORDER BY flag, day
FORMAT JSON`.trim()
}

export function summariseExposures(rows) {
  const totals = new Map()

  for (const row of rows) {
    const key = [row.flag, row.variant || '-', row.reason].join('|')

    totals.set(key, (totals.get(key) ?? 0) + Math.round(Number(row.exposures)))
  }

  return [...totals].map(([key, exposures]) => {
    const [flag, variant, reason] = key.split('|')

    return { flag, variant, reason, exposures }
  }).sort((left, right) => {
    return left.flag.localeCompare(right.flag)
  })
}

async function runQuery(query, accountId, apiToken) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}`
    + '/analytics_engine/sql',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: query,
    },
  )
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Analytics Engine returned ${response.status}: ${text}`)
  }

  return JSON.parse(text).data ?? []
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_ANALYTICS_TOKEN
    || process.env.CLOUDFLARE_API_TOKEN

  if (!accountId || !apiToken) {
    console.error('Missing env: set CLOUDFLARE_ACCOUNT_ID and '
      + 'CLOUDFLARE_ANALYTICS_TOKEN (needs "Account Analytics: Read").')
    process.exit(1)
  }

  try {
    const options = parseReportArguments(process.argv.slice(2))
    const query = buildExposureQuery(options)
    const rows = await runQuery(query, accountId, apiToken)

    console.log(`Dataset ${options.dataset}, last ${options.days} day(s), `
      + `flags ${options.prefix}*`)
    console.table(summariseExposures(rows))
  } catch (exception) {
    console.error(exception instanceof Error ? exception.message : exception)
    process.exit(1)
  }
}

const isEntryPoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
  await main()
}
