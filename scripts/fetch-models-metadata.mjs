#!/usr/bin/env node

/**
 * Regenerates providers/data/models-dev-snapshot.json from models.dev, the
 * objective half of the model catalog: display name, description, release
 * date, context and output limits, modalities and per-million-token cost.
 * The curated
 * half — which tools, reasoning, research and image-generation capabilities
 * a model is offered with — stays hand-written in providers/anthropic.ts,
 * providers/google.ts, providers/openai.ts, providers/xai.ts,
 * providers/deepseek.ts, providers/moonshotai.ts and providers/qwen.ts and
 * is never touched here.
 *
 * The join only ever looks curated ids UP in models.dev; it never iterates
 * the remote catalog outward, so embedding, video, music, TTS and realtime
 * models that models.dev also lists can never leak into the app.
 *
 * This is a manual maintenance step, like `pnpm run db:generate`. The build
 * and the Cloudflare deploy stay offline: they read the committed snapshot.
 *
 * A curated id that models.dev no longer publishes is a hard failure rather
 * than a silent fallback to stale values — that is the whole point of
 * fetching. Retiring or renaming such a model is a deliberate edit to the
 * curated file (or to EXEMPT_IDS below).
 *
 * Usage:
 *   pnpm run models:fetch
 *   git diff providers/data/models-dev-snapshot.json
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findDeprecatedCuratedModels,
  findUncuratedModels,
  formatDeprecatedCuratedModelsWarning,
  formatUncuratedModelsReport,
} from './audit-curated-models.mjs'
import anthropic from '../providers/anthropic.ts'
import google from '../providers/google.ts'
import openai from '../providers/openai.ts'
import xai from '../providers/xai.ts'
import deepseek from '../providers/deepseek.ts'
import moonshotai from '../providers/moonshotai.ts'
import qwen from '../providers/qwen.ts'

const CATALOG_URL = 'https://models.dev/api.json'
const FETCH_TIMEOUT_MS = 60_000
const SNAPSHOT_PATH = fileURLToPath(
  new URL('../providers/data/models-dev-snapshot.json', import.meta.url),
)

// Ids that are knowingly absent from models.dev. Two kinds:
//  - Deep Research snapshots OpenAI bills separately but models.dev does not
//    track (it lists only the bare o3 / o4-mini). Fully curated in
//    providers/openai.ts.
//  - Retired-but-kept legacy ids models.dev no longer publishes at all.
//    Fully curated in providers/*.ts with `status: 'deprecated'` so the
//    legacy picker section and useChatProvider() guard keep working.
const EXEMPT_IDS = [
  'o3-deep-research',
  'o4-mini-deep-research',
  'gemini-3-pro-preview',
]

const KNOWN_MODEL_STATUSES = ['deprecated', 'beta', 'alpha']

const curatedProviders = [
  anthropic,
  google,
  openai,
  xai,
  deepseek,
  moonshotai,
  qwen,
]

const catalog = await fetchCatalog()
const snapshot = {}
const missingIds = []
const incompleteIds = []

for (const provider of curatedProviders) {
  const modelsDevKey = provider.modelsDevKey ?? provider.id
  const remoteModels = catalog[modelsDevKey]?.models

  if (!remoteModels) {
    console.error(
      `models.dev has no "${modelsDevKey}" provider. Its top-level keys `
      + 'are provider ids; check whether it was renamed, or whether '
      + `"${provider.id}" needs a modelsDevKey override.`,
    )
    process.exit(1)
  }

  for (const model of provider.models) {
    if (EXEMPT_IDS.includes(model.id)) {
      continue
    }

    const remoteModel = remoteModels[model.id]

    if (!remoteModel) {
      missingIds.push(`${provider.id}/${model.id}`)

      continue
    }

    const entry = toSnapshotEntry(remoteModel)

    if (!entry) {
      incompleteIds.push(`${provider.id}/${model.id}`)

      continue
    }

    snapshot[model.id] = entry
  }
}

if (missingIds.length > 0) {
  console.error(
    `models.dev no longer lists ${missingIds.length} curated model(s):`,
  )
  console.error(missingIds.map(id => `  - ${id}`).join('\n'))
  console.error(
    'Remove or replace them in providers/*.ts, or add them to EXEMPT_IDS '
    + 'and curate their metadata by hand. Snapshot NOT written.',
  )
  process.exit(1)
}

if (incompleteIds.length > 0) {
  console.error(
    `models.dev is missing required fields for ${incompleteIds.length} `
    + 'curated model(s):',
  )
  console.error(incompleteIds.map(id => `  - ${id}`).join('\n'))
  console.error('Snapshot NOT written.')
  process.exit(1)
}

await mkdir(dirname(SNAPSHOT_PATH), { recursive: true })
await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)

console.log(
  `Wrote ${Object.keys(snapshot).length} models to ${SNAPSHOT_PATH}`,
)
console.log(
  `Exempt (curated by hand): ${EXEMPT_IDS.join(', ')}`,
)

const providerReports = curatedProviders.map((provider) => {
  const curatedIds = new Set(provider.models.map(model => model.id))
  const remoteModels = catalog[provider.modelsDevKey ?? provider.id].models

  return {
    providerId: provider.id,
    curatedIds,
    remoteModels,
  }
})

const deprecatedCuratedWarning = formatDeprecatedCuratedModelsWarning(
  providerReports.map(({ providerId, curatedIds, remoteModels }) => {
    return {
      providerId,
      models: findDeprecatedCuratedModels(remoteModels, curatedIds),
    }
  }),
)

if (deprecatedCuratedWarning) {
  console.log()
  console.log(deprecatedCuratedWarning)
}

console.log()
console.log(formatUncuratedModelsReport(
  providerReports.map(({ providerId, curatedIds, remoteModels }) => {
    return {
      providerId,
      models: findUncuratedModels(remoteModels, curatedIds),
    }
  }),
))

async function fetchCatalog() {
  try {
    const response = await fetch(CATALOG_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(
        `${CATALOG_URL} responded ${response.status} ${response.statusText}`,
      )
      process.exit(1)
    }

    return await response.json()
  } catch (exception) {
    console.error(`Could not fetch ${CATALOG_URL}: ${exception.message}`)
    process.exit(1)
  }
}

function toSnapshotEntry(model) {
  const hasRequiredFields = typeof model.name === 'string'
    && typeof model.description === 'string'
    && typeof model.limit?.context === 'number'
    && typeof model.limit?.output === 'number'
    && Array.isArray(model.modalities?.input)
    && Array.isArray(model.modalities?.output)
    && typeof model.cost?.input === 'number'
    && typeof model.cost?.output === 'number'

  if (!hasRequiredFields) {
    return null
  }

  const entry = {
    name: model.name,
    description: model.description,
    ...(typeof model.release_date === 'string'
      ? { releaseDate: model.release_date }
      : {}),
    ...(KNOWN_MODEL_STATUSES.includes(model.status)
      ? { status: model.status }
      : {}),
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    modalities: {
      input: model.modalities.input,
      output: model.modalities.output,
    },
    cost: {
      input: model.cost.input,
      output: model.cost.output,
    },
  }

  if (Array.isArray(model.cost.tiers) && model.cost.tiers.length > 0) {
    entry.tieredPricing = true
  }

  return entry
}
