#!/usr/bin/env node

/**
 * Prints the campaign funnel (visits, sign-ups, first key, first chat) from
 * Cloudflare Workers Analytics Engine. See docs/analytics-utm.md for the blob
 * layout, the sampling rules and the Cloudflare token to use.
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ANALYTICS_TOKEN=... \
 *     node scripts/utm-report.mjs [--days=7|30] [--dataset=besidka_cms_events]
 *
 * The token needs only "Account Analytics: Read". CLOUDFLARE_API_TOKEN is
 * used when CLOUDFLARE_ANALYTICS_TOKEN is not set.
 */

const DEFAULT_DATASET = 'besidka_cms_events'
const DEFAULT_DAYS = 7
const MAX_DAYS = 90
const DATASET_PATTERN = /^[a-z0-9_]+$/i
const PRE_UTM_LABEL = '(before utm)'

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken
  = process.env.CLOUDFLARE_ANALYTICS_TOKEN || process.env.CLOUDFLARE_API_TOKEN

if (!accountId || !apiToken) {
  console.error(
    'Missing env: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_TOKEN '
    + '(or CLOUDFLARE_API_TOKEN). The token needs "Account Analytics: Read".',
  )
  process.exit(1)
}

const { days, dataset } = parseArguments(process.argv.slice(2))
const rows = await runFunnelQuery(buildFunnelQuery(dataset, days))

printReport(rows, dataset, days)

function parseArguments(argumentList) {
  const options = { days: DEFAULT_DAYS, dataset: DEFAULT_DATASET }

  for (const argument of argumentList) {
    const [flag, value] = argument.split('=')

    if (flag === '--days') {
      options.days = Number(value)
    } else if (flag === '--dataset') {
      options.dataset = value
    } else {
      fail(`Unknown argument: ${argument}`)
    }
  }

  if (!Number.isInteger(options.days)
    || options.days < 1
    || options.days > MAX_DAYS) {
    fail(`--days must be a whole number from 1 to ${MAX_DAYS}.`)
  }

  if (!options.dataset || !DATASET_PATTERN.test(options.dataset)) {
    fail('--dataset may only contain letters, digits and underscores.')
  }

  return options
}

function buildFunnelQuery(datasetName, dayCount) {
  return `
SELECT
  if(blob1 = 'landing_page_view', blob6, blob2) AS campaign,
  sumIf(_sample_interval, blob1 = 'landing_page_view') AS visits,
  sumIf(_sample_interval, blob1 = 'signup_completed') AS signups,
  sumIf(_sample_interval, blob1 = 'first_provider_key_added') AS first_key,
  sumIf(_sample_interval, blob1 = 'first_chat_message') AS first_chat
FROM ${datasetName}
WHERE timestamp > NOW() - INTERVAL '${dayCount}' DAY
  AND blob1 IN (
    'landing_page_view',
    'signup_completed',
    'first_provider_key_added',
    'first_chat_message'
  )
GROUP BY campaign
ORDER BY sumIf(_sample_interval, blob1 = 'landing_page_view') DESC
FORMAT JSON`.trim()
}

async function runFunnelQuery(query) {
  const url
    = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
      + '/analytics_engine/sql'
  let response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: query,
    })
  } catch (exception) {
    fail(`Request failed: ${exception.message}`)
  }

  const text = await response.text()

  if (!response.ok) {
    fail(`Analytics Engine returned ${response.status}: ${text}`)
  }

  try {
    return JSON.parse(text).data ?? []
  } catch (exception) {
    return fail(
      `Unexpected response (${exception.message}): ${text.slice(0, 300)}`,
    )
  }
}

function printReport(rows, datasetName, dayCount) {
  const table = rows.map((row) => {
    return {
      campaign: row.campaign === '' ? PRE_UTM_LABEL : row.campaign,
      visits: Math.round(Number(row.visits)),
      signups: Math.round(Number(row.signups)),
      firstKey: Math.round(Number(row.first_key)),
      firstChat: Math.round(Number(row.first_chat)),
    }
  })

  const total = table.reduce((sum, row) => {
    return {
      campaign: 'TOTAL',
      visits: sum.visits + row.visits,
      signups: sum.signups + row.signups,
      firstKey: sum.firstKey + row.firstKey,
      firstChat: sum.firstChat + row.firstChat,
    }
  }, { campaign: 'TOTAL', visits: 0, signups: 0, firstKey: 0, firstChat: 0 })

  const lines = [...table, total].map((row) => {
    return [
      row.campaign,
      String(row.visits),
      String(row.signups),
      String(row.firstKey),
      String(row.firstChat),
      formatConversion(row.signups, row.visits),
    ]
  })

  const header = [
    'campaign',
    'visits',
    'signups',
    'first_key',
    'first_chat',
    'conversion %',
  ]
  const widths = header.map((title, columnIndex) => {
    return Math.max(
      title.length,
      ...lines.map(line => line[columnIndex].length),
    )
  })

  console.log(`Dataset ${datasetName}, last ${dayCount} day(s)`)
  console.log(formatLine(header, widths))
  console.log(widths.map(width => '-'.repeat(width)).join('  '))

  for (const line of lines) {
    console.log(formatLine(line, widths))
  }
}

function formatLine(cells, widths) {
  return cells
    .map((cell, columnIndex) => {
      return columnIndex === 0
        ? cell.padEnd(widths[columnIndex])
        : cell.padStart(widths[columnIndex])
    })
    .join('  ')
}

function formatConversion(signups, visits) {
  if (visits === 0) {
    return '-'
  }

  return ((signups / visits) * 100).toFixed(1)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
