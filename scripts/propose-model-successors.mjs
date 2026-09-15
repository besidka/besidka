#!/usr/bin/env node

/**
 * Scans models.dev for new upstream ids that are clearly the next point
 * release of an already-curated model family (curated `gemini-3.7-flash` +
 * upstream `gemini-3.8-flash` -> propose curating `gemini-3.8-flash`),
 * guarded so it only ever proposes a mechanical, same-price-tier copy —
 * never a new price tier, a preview/beta model, or anything needing real
 * human judgment. See scripts/detect-model-successors.mjs for the pure
 * detection logic and docs/models-data-fetching.md for the guardrail list.
 *
 * Wired into the weekly models-drift-check.yml workflow: a proposal becomes
 * a second commit in that week's refresh PR for a human to review and
 * merge. This script never merges or pushes anything itself.
 *
 * Usage:
 *   node scripts/propose-model-successors.mjs
 *   node scripts/propose-model-successors.mjs --dry-run
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchCatalog } from './models-dev-catalog.mjs'
import {
  findSuccessorProposals,
  formatSuccessorProposalsReport,
  insertCuratedEntry,
  renderCuratedEntry,
} from './detect-model-successors.mjs'
import anthropic from '../providers/anthropic.ts'
import google from '../providers/google.ts'
import openai from '../providers/openai.ts'

const isDryRun = process.argv.includes('--dry-run')
const providers = [anthropic, google, openai]

const catalog = await fetchCatalog()
const result = findSuccessorProposals({ providers, catalog })
const report = formatSuccessorProposalsReport(result)

console.log(report)

if (!isDryRun && result.proposals.length > 0) {
  applyProposals(result.proposals)
}

writeGithubOutput(result)
writeRunnerTempLog(report)

function applyProposals(proposals) {
  const sourcesByPath = new Map()

  for (const proposal of proposals) {
    const path = fileURLToPath(
      new URL(`../providers/${proposal.providerId}.ts`, import.meta.url),
    )
    const source = sourcesByPath.get(path) ?? readFileSync(path, 'utf-8')
    const entryText = renderCuratedEntry({
      id: proposal.modelId,
      template: proposal.template,
    })

    try {
      sourcesByPath.set(
        path,
        insertCuratedEntry(source, proposal.templateId, entryText),
      )
    } catch (exception) {
      console.error(
        `Could not insert "${proposal.modelId}" into ${path}: `
        + exception.message,
      )
      process.exit(1)
    }
  }

  for (const [path, source] of sourcesByPath) {
    writeFileSync(path, source)
  }
}

function writeGithubOutput(result) {
  const outputFile = process.env.GITHUB_OUTPUT

  if (!outputFile) {
    return
  }

  const proposedIds = result.proposals.map(proposal => proposal.modelId)
  const commitSubject = buildCommitSubject(proposedIds)

  appendFileSync(outputFile, `proposed_count=${result.proposals.length}\n`)
  appendFileSync(outputFile, `proposed_ids=${proposedIds.join(',')}\n`)
  appendFileSync(
    outputFile,
    `flagged_count=${result.priceTierFlags.length}\n`,
  )
  appendFileSync(outputFile, `commit_subject=${commitSubject}\n`)
}

function buildCommitSubject(proposedIds) {
  if (proposedIds.length === 1) {
    return `feat(models): propose ${proposedIds[0]} as a same-family `
      + 'successor'
  }

  if (proposedIds.length > 1) {
    return `feat(models): propose ${proposedIds.length} same-family `
      + 'successors'
  }

  return ''
}

function writeRunnerTempLog(report) {
  if (!process.env.RUNNER_TEMP) {
    return
  }

  writeFileSync(`${process.env.RUNNER_TEMP}/successors.log`, `${report}\n`)
}
