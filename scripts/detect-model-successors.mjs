/**
 * Pure detection logic behind scripts/propose-model-successors.mjs: given
 * the curated provider files and the raw models.dev catalog, find upstream
 * model ids that are clearly the next point release of an already-curated
 * model family (curated `gemini-3.7-flash` + upstream `gemini-3.8-flash` ->
 * propose curating `gemini-3.8-flash`), with guardrails so it never
 * proposes something that needs real human judgment. Kept in its own
 * module (no top-level network calls or file writes) so it can be unit
 * tested directly, mirroring scripts/audit-curated-models.mjs.
 */

const VERSION_PATTERN = /\d+(?:[.-]\d+)*/
const REQUIRED_PRICE_TIER_RATIO = 2

/**
 * Ids a human already reviewed and rejected as a same-family successor
 * (see docs/models-data-fetching.md, "Ids deliberately not auto-added").
 * Append an id here whenever declining a future weekly proposal, so the
 * detector stops re-proposing it.
 */
export const DECLINED_IDS = ['gpt-5.6', 'gpt-6-astra']

export function parseModelFamily(id) {
  const match = id.match(VERSION_PATTERN)

  if (!match) {
    return null
  }

  const family
    = id.slice(0, match.index)
      + '{v}'
      + id.slice(match.index + match[0].length)

  return { family, version: match[0] }
}

export function compareModelVersions(a, b) {
  const segmentsA = a.split(/[.-]/).map(Number)
  const segmentsB = b.split(/[.-]/).map(Number)
  const segmentCount = Math.max(segmentsA.length, segmentsB.length)

  for (let index = 0; index < segmentCount; index++) {
    const segmentA = segmentsA[index] ?? 0
    const segmentB = segmentsB[index] ?? 0

    if (segmentA !== segmentB) {
      return segmentA - segmentB
    }
  }

  return 0
}

export function isProposableTemplate(model) {
  if (model.status) {
    return false
  }

  if (model.reasoningAlwaysOn) {
    return false
  }

  const priceKeys = Object.keys(model.price)
  const hasOnlyTokensPrice = priceKeys.length === 1
    && priceKeys[0] === 'tokens'
    && model.price.tokens === 1_000_000

  if (!hasOnlyTokensPrice) {
    return false
  }

  if (model.reasoning && model.reasoning.mode !== 'levels') {
    return false
  }

  return true
}

/**
 * Picks the highest-version currently curated model in each family as that
 * family's copy source (see isProposableTemplate for the eligibility check
 * applied afterward). Curated models with a `research` or `imageGeneration`
 * block are excluded from ever becoming a template — this is what keeps an
 * image-generation model (the image models form the tail of
 * providers/openai.ts, providers/google.ts and providers/xai.ts, e.g.
 * `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare` and `gpt-image-2`, pinned
 * by tests/unit/utils/model.spec.ts as sitting after every chat model) from
 * ever being chosen as insertCuratedEntry's insertion anchor. That guarantee
 * is what keeps the image-tail invariant intact regardless of which side of
 * the anchor insertCuratedEntry splices into: a chat-model anchor can never
 * sit after an image model, so inserting immediately before it never moves
 * a chat model into the image tail. The curated files are newest-first, so
 * a successor — being newer than its template — is spliced in immediately
 * before the template, never after.
 */
function buildFamilyTemplates(provider) {
  const templatesByFamily = new Map()

  for (const model of provider.models) {
    if (model.research || model.imageGeneration) {
      continue
    }

    const parsed = parseModelFamily(model.id)

    if (!parsed) {
      continue
    }

    const existing = templatesByFamily.get(parsed.family)

    if (
      !existing
      || compareModelVersions(parsed.version, existing.version) > 0
    ) {
      templatesByFamily.set(parsed.family, {
        template: model,
        version: parsed.version,
      })
    }
  }

  return templatesByFamily
}

/**
 * Lists, per family, the template the proposer would copy from for
 * `provider`: the highest-version curated model that passes
 * isProposableTemplate. Side-effect free so tests can rehearse the same
 * template selection the weekly proposer performs.
 */
export function listProposableTemplates(provider) {
  const proposableTemplates = []

  for (const [family, entry] of buildFamilyTemplates(provider)) {
    if (isProposableTemplate(entry.template)) {
      proposableTemplates.push({
        family,
        template: entry.template,
        version: entry.version,
      })
    }
  }

  return proposableTemplates
}

function hasCompleteSnapshotFields(upstreamModel) {
  return typeof upstreamModel.name === 'string'
    && typeof upstreamModel.description === 'string'
    && typeof upstreamModel.limit?.context === 'number'
    && typeof upstreamModel.limit?.output === 'number'
    && Array.isArray(upstreamModel.modalities?.input)
    && Array.isArray(upstreamModel.modalities?.output)
    && typeof upstreamModel.cost?.input === 'number'
    && typeof upstreamModel.cost?.output === 'number'
}

function isDuplicateOfCuratedSibling(
  candidateId,
  upstreamModel,
  curatedIds,
  remoteModels,
) {
  for (const curatedId of curatedIds) {
    if (curatedId === candidateId) {
      continue
    }

    const siblingUpstream = remoteModels[curatedId]

    if (!siblingUpstream) {
      continue
    }

    const sameCost = siblingUpstream.cost?.input === upstreamModel.cost?.input
      && siblingUpstream.cost?.output === upstreamModel.cost?.output
    const sameReleaseDate
      = siblingUpstream.release_date === upstreamModel.release_date

    if (sameCost && sameReleaseDate) {
      return true
    }
  }

  return false
}

function computePriceRatio(candidateCost, templateCost) {
  if (templateCost === 0) {
    return Infinity
  }

  const ratio = candidateCost / templateCost

  return Math.max(ratio, 1 / ratio)
}

/**
 * Scans a provider's upstream models exactly once, matching each candidate
 * only to its own family's template (never to an unrelated family's), so a
 * candidate can be reported as declined/duplicate/flagged at most once —
 * even though many curated families share the same generic placeholder
 * (e.g. plain "gpt-{v}" covers gpt-5, gpt-5.1, gpt-4.1, gpt-4 alike).
 */
function scanProviderCandidates({ provider, remoteModels, familyTemplates }) {
  const curatedIds = new Set(provider.models.map(model => model.id))
  const declinedSkips = []
  const priceTierFlags = []
  const bestCandidatesByFamily = new Map()

  for (const [candidateId, upstreamModel] of Object.entries(remoteModels)) {
    if (curatedIds.has(candidateId)) {
      continue
    }

    const parsedCandidate = parseModelFamily(candidateId)

    if (!parsedCandidate) {
      continue
    }

    const familyEntry = familyTemplates.get(parsedCandidate.family)

    if (!familyEntry || !familyEntry.isProposable) {
      continue
    }

    const { template, version: templateVersion } = familyEntry

    if (DECLINED_IDS.includes(candidateId)) {
      declinedSkips.push({
        providerId: provider.id,
        id: candidateId,
        reason: 'previously declined (see DECLINED_IDS)',
      })

      continue
    }

    if (compareModelVersions(parsedCandidate.version, templateVersion) <= 0) {
      continue
    }

    if (isDuplicateOfCuratedSibling(
      candidateId,
      upstreamModel,
      curatedIds,
      remoteModels,
    )) {
      declinedSkips.push({
        providerId: provider.id,
        id: candidateId,
        reason: 'duplicate of a curated sibling: same cost and release '
          + 'date upstream',
      })

      continue
    }

    if (upstreamModel.tool_call !== true) {
      continue
    }

    if (Boolean(upstreamModel.reasoning) !== Boolean(template.reasoning)) {
      continue
    }

    if (upstreamModel.status) {
      continue
    }

    if (
      !upstreamModel.modalities?.input?.includes('text')
      || !upstreamModel.modalities?.output?.includes('text')
    ) {
      continue
    }

    if (!hasCompleteSnapshotFields(upstreamModel)) {
      continue
    }

    const templateUpstream = remoteModels[template.id]
    const templateCost = {
      input: templateUpstream?.cost?.input ?? 0,
      output: templateUpstream?.cost?.output ?? 0,
    }
    const inputRatio = computePriceRatio(
      upstreamModel.cost.input,
      templateCost.input,
    )
    const outputRatio = computePriceRatio(
      upstreamModel.cost.output,
      templateCost.output,
    )
    const worstRatio = Math.max(inputRatio, outputRatio)

    if (worstRatio > REQUIRED_PRICE_TIER_RATIO) {
      priceTierFlags.push({
        providerId: provider.id,
        templateId: template.id,
        id: candidateId,
        ratio: worstRatio,
      })

      continue
    }

    const currentBest = bestCandidatesByFamily.get(parsedCandidate.family)

    if (
      !currentBest
      || compareModelVersions(parsedCandidate.version, currentBest.version)
      > 0
    ) {
      bestCandidatesByFamily.set(parsedCandidate.family, {
        id: candidateId,
        version: parsedCandidate.version,
        templateId: template.id,
        template,
      })
    }
  }

  return { bestCandidatesByFamily, declinedSkips, priceTierFlags }
}

export function findSuccessorProposals({ providers, catalog }) {
  const proposals = []
  const priceTierFlags = []
  const declinedSkips = []
  const familiesNeedingHuman = []

  for (const provider of providers) {
    const modelsDevKey = provider.modelsDevKey ?? provider.id
    const remoteModels = catalog[modelsDevKey]?.models ?? {}
    const rawFamilyTemplates = buildFamilyTemplates(provider)
    const familyTemplates = new Map()

    for (const [family, entry] of rawFamilyTemplates) {
      const isProposable = isProposableTemplate(entry.template)

      familyTemplates.set(family, { ...entry, isProposable })

      if (!isProposable) {
        familiesNeedingHuman.push({
          providerId: provider.id,
          family,
          templateId: entry.template.id,
        })
      }
    }

    const scanResult = scanProviderCandidates({
      provider,
      remoteModels,
      familyTemplates,
    })

    declinedSkips.push(...scanResult.declinedSkips)
    priceTierFlags.push(...scanResult.priceTierFlags)

    for (const bestCandidate of scanResult.bestCandidatesByFamily.values()) {
      proposals.push({
        providerId: provider.id,
        templateId: bestCandidate.templateId,
        modelId: bestCandidate.id,
        template: bestCandidate.template,
      })
    }
  }

  return { proposals, priceTierFlags, declinedSkips, familiesNeedingHuman }
}

function formatTokenCount(amount) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

/**
 * Renders a new curated-model source block from a template model object.
 * Deliberately strips `default`, `forProjectMemory`, `retiredAt`, `status`,
 * `name` and `description` even when the template carries them — those are
 * per-model product decisions or lifecycle state, never something a new
 * sibling model should silently inherit just because its template has it.
 */
export function renderCuratedEntry({ id, template }) {
  const lines = [
    '    {',
    `      id: '${id}',`,
    '      price: {',
    `        tokens: ${formatTokenCount(template.price.tokens)},`,
    '      },',
    `      tools: [${
      template.tools.map(tool => `'${tool}'`).join(', ')
    }],`,
  ]

  if (template.reasoning) {
    lines.push(
      '      reasoning: {',
      `        mode: '${template.reasoning.mode}',`,
      `        levels: [${
        template.reasoning.levels.map(level => `'${level}'`).join(', ')
      }],`,
      '      },',
    )
  }

  lines.push('    },')

  return lines.join('\n')
}

/**
 * Splices a new curated-model block into `sourceText` immediately before the
 * opening brace of the existing sibling model whose `id: '<templateId>',`
 * line matches exactly — the curated files are newest-first, and a
 * successor is always newer than its template, so it belongs ahead of it in
 * the array. Throws if that id is missing or ambiguous in the source, or if
 * the sibling's opening brace can't be found before the start of the file.
 * Purely a text-splicing operation — it has no knowledge of families or
 * which ids are safe to use as `templateId`; that eligibility is decided by
 * buildFamilyTemplates before this is called.
 */
export function insertCuratedEntry(sourceText, templateId, entryText) {
  const lines = sourceText.split('\n')
  const idLine = `      id: '${templateId}',`
  const matchingIndexes = []

  lines.forEach((line, index) => {
    if (line === idLine) {
      matchingIndexes.push(index)
    }
  })

  if (matchingIndexes.length === 0) {
    throw new Error(`No curated model with id "${templateId}" found.`)
  }

  if (matchingIndexes.length > 1) {
    throw new Error(
      `Ambiguous match: found ${matchingIndexes.length} curated models `
      + `with id "${templateId}".`,
    )
  }

  const idLineIndex = matchingIndexes[0]
  let openingBraceIndex = -1

  for (let index = idLineIndex - 1; index >= 0; index--) {
    if (lines[index] === '    },') {
      throw new Error(
        `Reached the previous model's closing brace before finding the `
        + `opening brace for "${templateId}".`,
      )
    }

    if (lines[index] === '    {') {
      openingBraceIndex = index

      break
    }
  }

  if (openingBraceIndex === -1) {
    throw new Error(
      `Could not find the opening brace for curated model "${templateId}".`,
    )
  }

  lines.splice(openingBraceIndex, 0, entryText)

  return lines.join('\n')
}

function findBlockRange(lines, openingLine, closingLine) {
  const startIndex = lines.findIndex(line => line.startsWith(openingLine))

  if (startIndex === -1) {
    return null
  }

  const endIndex = lines.findIndex((line, index) => {
    return index > startIndex && line === closingLine
  })

  if (endIndex === -1) {
    throw new Error(
      `Could not find the closing "${closingLine}" for "${openingLine}".`,
    )
  }

  return { startIndex, endIndex }
}

function findUniqueLineInBlock(lines, range, matchesLine, description) {
  const matchingIndexes = []

  for (let index = range.startIndex + 1; index < range.endIndex; index++) {
    if (matchesLine(lines[index])) {
      matchingIndexes.push(index)
    }
  }

  if (matchingIndexes.length === 0) {
    throw new Error(`No ${description} found.`)
  }

  if (matchingIndexes.length > 1) {
    throw new Error(
      `Ambiguous match: found ${matchingIndexes.length} of ${description}.`,
    )
  }

  return matchingIndexes[0]
}

/**
 * Splices a new id into the pinned expectations of a provider spec
 * (tests/unit/providers/<provider>.spec.ts) so the spec keeps passing once
 * insertCuratedEntry has added the same model to providers/<provider>.ts:
 * `'<newId>',` goes immediately before `'<templateId>',` inside
 * `const expectedModelIds = [`, and, when the spec also pins
 * `const expectedToolsById`, a `'<newId>': [...]` line goes immediately
 * before the template's entry. Throws if the ids block is missing or the
 * template line is missing or ambiguous in either block.
 */
export function insertPinnedSpecEntry(
  specText,
  templateId,
  { newId, tools },
) {
  const lines = specText.split('\n')
  const idsRange = findBlockRange(lines, 'const expectedModelIds = [', ']')

  if (!idsRange) {
    throw new Error('No "const expectedModelIds = [" block found in spec.')
  }

  const toolsRange = findBlockRange(
    lines,
    'const expectedToolsById',
    '}',
  )
  const idLine = `  '${templateId}',`
  const toolsLinePrefix = `  '${templateId}': `
  const idIndex = findUniqueLineInBlock(
    lines,
    idsRange,
    line => line === idLine,
    `"${templateId}" entries in expectedModelIds`,
  )
  const toolsIndex = toolsRange
    ? findUniqueLineInBlock(
      lines,
      toolsRange,
      line => line.startsWith(toolsLinePrefix),
      `"${templateId}" entries in expectedToolsById`,
    )
    : -1

  const insertions = [{ index: idIndex, line: `  '${newId}',` }]

  if (toolsIndex !== -1) {
    const renderedTools = tools.map(tool => `'${tool}'`).join(', ')

    insertions.push({
      index: toolsIndex,
      line: `  '${newId}': [${renderedTools}],`,
    })
  }

  insertions.sort((first, second) => second.index - first.index)

  for (const insertion of insertions) {
    lines.splice(insertion.index, 0, insertion.line)
  }

  return lines.join('\n')
}

export function formatSuccessorProposalsReport(result) {
  const { proposals, priceTierFlags, declinedSkips, familiesNeedingHuman }
    = result
  const lines = []

  if (proposals.length === 0) {
    lines.push('No same-family successors found this run.')
  } else {
    lines.push(`Proposed ${proposals.length} same-family successor(s):`)
    lines.push(...proposals.map((proposal) => {
      return `  - ${proposal.providerId}/${proposal.modelId} `
        + `(extends ${proposal.templateId})`
    }))
  }

  if (priceTierFlags.length > 0) {
    lines.push('')
    lines.push(
      'Possible new price tiers (flagged, not proposed — review by hand):',
    )
    lines.push(...priceTierFlags.map((flag) => {
      return `  - ${flag.providerId}/${flag.id} (extends ${flag.templateId}`
        + `, ${flag.ratio.toFixed(1)}x price ratio)`
    }))
  }

  if (declinedSkips.length > 0) {
    lines.push('')
    lines.push('Ids skipped as declined or duplicate:')
    lines.push(...declinedSkips.map((skip) => {
      return `  - ${skip.providerId}/${skip.id} (${skip.reason})`
    }))
  }

  if (familiesNeedingHuman.length > 0) {
    lines.push('')
    lines.push(
      'Families whose template needs a human review before it can be a '
      + 'copy source:',
    )
    lines.push(...familiesNeedingHuman.map((entry) => {
      return `  - ${entry.providerId}/${entry.family} `
        + `(template: ${entry.templateId})`
    }))
  }

  return lines.join('\n')
}
