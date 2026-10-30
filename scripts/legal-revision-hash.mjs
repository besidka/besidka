#!/usr/bin/env node

/**
 * Prints the revision hash of every legal document, in the shape of
 * shared/utils/legal-document-revisions.ts. The hash covers only the markdown
 * body: the frontmatter (title, description, updatedAt, summary) is left out,
 * and line endings are normalised. A date-only change, a git-derived date and
 * the lists generated from registries (::account-email-list,
 * ::legal-change-history) therefore never move it. The same function backs
 * tests/unit/content/legal-revisions.spec.ts. See "Notifying users of
 * changes" in docs/legal.md.
 *
 * Usage:
 *   pnpm run legal:hash
 */

/* eslint-disable no-console */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGAL_DOCUMENT_IDS = [
  'privacy-policy',
  'terms-of-use',
  'cookie-policy',
]

export function extractLegalBody(source) {
  const normalised = source.replace(/\r\n?/g, '\n')

  if (!normalised.startsWith('---\n')) {
    return normalised
  }

  const frontmatterEnd = normalised.indexOf('\n---\n', 3)

  if (frontmatterEnd === -1) {
    return normalised
  }

  return normalised.slice(frontmatterEnd + '\n---\n'.length)
}

export function hashLegalDocument(source) {
  return createHash('sha256').update(extractLegalBody(source)).digest('hex')
}

export function readLegalDocumentHashes(root = process.cwd()) {
  return Object.fromEntries(
    LEGAL_DOCUMENT_IDS.map((documentId) => {
      const source = readFileSync(
        join(root, 'content', 'legal', `${documentId}.md`),
        'utf-8',
      )

      return [documentId, hashLegalDocument(source)]
    }),
  )
}

const isEntryPoint = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntryPoint) {
  for (const [documentId, hash] of Object.entries(readLegalDocumentHashes())) {
    console.log(`${documentId.padEnd(15)} ${hash}`)
  }
}
