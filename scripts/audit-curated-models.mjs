/**
 * Pure diff logic behind the "uncurated models" report printed by
 * scripts/fetch-models-metadata.mjs. Kept in its own module (no top-level
 * network calls or file writes) so it can be unit tested directly instead
 * of through the fetch script, which fetches models.dev and writes the
 * snapshot as a side effect of being imported.
 */

export function findUncuratedModels(remoteModels, curatedIds) {
  return Object.entries(remoteModels)
    .filter(([id]) => !curatedIds.has(id))
    .map(([id, model]) => {
      return {
        id,
        name: model.name,
        releaseDate: model.release_date,
      }
    })
    .sort((a, b) => {
      if (!a.releaseDate) {
        return 1
      }

      if (!b.releaseDate) {
        return -1
      }

      return b.releaseDate.localeCompare(a.releaseDate)
    })
}

export function formatUncuratedModelsReport(providerReports) {
  const lines = [
    'Models available on models.dev but not curated (informational, not a '
    + 'failure — review and add to providers/*.ts if relevant):',
  ]

  for (const { providerId, models } of providerReports) {
    lines.push(`  ${providerId} (${models.length} not curated):`)
    lines.push(...models.map((model) => {
      return `    - ${model.id} (${model.name}, released ${model.releaseDate})`
    }))
  }

  return lines.join('\n')
}

export function findDeprecatedCuratedModels(remoteModels, curatedIds) {
  return Object.entries(remoteModels)
    .filter(([id, model]) => {
      return curatedIds.has(id) && model.status === 'deprecated'
    })
    .map(([id, model]) => {
      return { id, name: model.name }
    })
}

/**
 * Unlike `formatUncuratedModelsReport()`, this returns `null` when there is
 * nothing to warn about, so the caller can skip printing an empty section —
 * a currently-curated model going deprecated upstream is rare enough that
 * silence is the common case.
 */
export function formatDeprecatedCuratedModelsWarning(providerReports) {
  const deprecatedModels = providerReports.flatMap(({ providerId, models }) => {
    return models.map(model => ({ providerId, ...model }))
  })

  if (deprecatedModels.length === 0) {
    return null
  }

  const lines = [
    '⚠ DEPRECATED: curated model(s) below are flagged deprecated on '
    + 'models.dev right now — review whether to swap or retire them in '
    + 'providers/*.ts:',
  ]

  lines.push(...deprecatedModels.map((model) => {
    return `  - ${model.providerId}/${model.id} (${model.name})`
  }))

  return lines.join('\n')
}
