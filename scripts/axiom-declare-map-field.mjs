#!/usr/bin/env node

/**
 * Declares the `attributes` field as a map field on our Axiom datasets, via
 * Axiom's Management API. See docs/axiom-map-fields.md for the full context
 * — read that before running this.
 *
 * MUST run this BEFORE (or atomically with) deploying the app code that
 * starts nesting fields under `attributes` — see the doc's deploy-ordering
 * warning. Declaring the field is prospective only: it does not shrink the
 * dataset's existing field count, only stops new fields from accruing under
 * this name going forward.
 *
 * Requires a management-scoped Axiom API token (Settings -> API tokens ->
 * a token with `datasets:update` — NOT the ingest-only token already used by
 * NUXT_AXIOM_TOKEN in this app). Axiom has no per-request scoping for this
 * call, so never store this token as a Worker secret; run this from a local
 * shell and discard it.
 *
 * Usage:
 *   AXIOM_API_TOKEN=xapt-... node scripts/axiom-declare-map-field.mjs
 *   AXIOM_API_TOKEN=xapt-... node scripts/axiom-declare-map-field.mjs \
 *     besidka-prod
 */

const FIELD_NAME = 'attributes'
const DEFAULT_DATASETS = [
  'besidka-prod',
  'besidka-audit-prod',
  'besidka-consent-prod',
]

const apiToken = process.env.AXIOM_API_TOKEN

if (!apiToken) {
  console.error('Missing AXIOM_API_TOKEN env var (management-scoped token).')
  process.exit(1)
}

const datasets = process.argv.slice(2)
const targetDatasets = datasets.length > 0 ? datasets : DEFAULT_DATASETS

for (const dataset of targetDatasets) {
  await declareMapField(dataset)
}

async function declareMapField(dataset) {
  const existingMapFields = await listMapFields(dataset)

  if (existingMapFields.includes(FIELD_NAME)) {
    console.log(`${dataset}: "${FIELD_NAME}" is already a map field, skipping.`)

    return
  }

  const response = await fetch(
    `https://api.axiom.co/v2/datasets/${encodeURIComponent(dataset)}/mapfields`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ name: FIELD_NAME }),
    },
  )

  if (!response.ok) {
    const body = await response.text()

    console.error(
      `${dataset}: failed to declare "${FIELD_NAME}" as a map field `
      + `(${response.status}): ${body}`,
    )
    process.exitCode = 1

    return
  }

  console.log(`${dataset}: "${FIELD_NAME}" declared as a map field.`)
}

async function listMapFields(dataset) {
  const response = await fetch(
    `https://api.axiom.co/v2/datasets/${encodeURIComponent(dataset)}/mapfields`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  )

  if (!response.ok) {
    return []
  }

  return response.json()
}
