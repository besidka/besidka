import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAccountEmailListItems } from '#shared/utils/account-emails'
import { LEGAL_DOCUMENT_REVISIONS } from '#shared/utils/legal-document-revisions'
import {
  LEGAL_DOCUMENT_IDS,
  LEGAL_NOTICES,
  getLegalNoticeById,
} from '#shared/utils/legal-notices'
import type { LegalDocumentId } from '#shared/utils/legal-notices'
import {
  extractLegalBody,
  hashLegalDocument,
} from '../../../scripts/legal-revision-hash.mjs'

function readBody(documentId: LegalDocumentId): string {
  return extractLegalBody(
    readFileSync(
      join(process.cwd(), `content/legal/${documentId}.md`),
      'utf-8',
    ),
  )
}

function hashDocument(documentId: LegalDocumentId): string {
  return hashLegalDocument(
    readFileSync(
      join(process.cwd(), `content/legal/${documentId}.md`),
      'utf-8',
    ),
  )
}

describe.each(LEGAL_DOCUMENT_IDS)('legal revision of %s', (documentId) => {
  const revision = LEGAL_DOCUMENT_REVISIONS[documentId]

  it('matches the recorded hash, so every text change is classified', () => {
    const actualHash = hashDocument(documentId)

    expect(
      actualHash,
      `content/legal/${documentId}.md changed (the updatedAt date does not `
      + 'count) and the change is not classified yet. Decide whether it is '
      + 'material (it changes what data I collect, why, who receives it, how '
      + 'long I keep it, or your rights or choices, or the terms you agree '
      + 'to) or minor (typo, formatting, clarification that changes nothing '
      + 'I do). The checklist is in docs/legal.md, "Notifying users of '
      + 'changes". Then either (a) add a LEGAL_NOTICES entry in '
      + 'shared/utils/legal-notices.ts and, in '
      + `shared/utils/legal-document-revisions.ts, set '${documentId}' to `
      + `hash ${actualHash}, classification 'material' and that notice's id; `
      + 'or (b) set the hash to '
      + `${actualHash}, classification 'minor' and a one-line note. `
      + 'pnpm run legal:hash prints the hashes.',
    ).toBe(revision.hash)
  })

  it('has a note', () => {
    expect(revision.note.trim().length).toBeGreaterThan(0)
  })

  it('names a notice that covers this document when it is material', () => {
    if (revision.classification !== 'material') {
      expect('noticeId' in revision).toBe(false)

      return
    }

    const noticeId = 'noticeId' in revision ? revision.noticeId : undefined
    const notice = noticeId ? getLegalNoticeById(noticeId) : null

    expect(
      notice,
      `'${documentId}' is classified material but noticeId '${noticeId}' `
      + 'is not in LEGAL_NOTICES (shared/utils/legal-notices.ts).',
    ).not.toBeNull()
    expect(
      notice?.documents,
      `Notice '${noticeId}' does not list '${documentId}' in documents.`,
    ).toContain(documentId)
  })
})

describe('legal revision record', () => {
  it('covers exactly the three legal documents', () => {
    expect(Object.keys(LEGAL_DOCUMENT_REVISIONS).sort()).toEqual(
      [...LEGAL_DOCUMENT_IDS].sort(),
    )
  })
})

describe('generated content never moves a hash', () => {
  it('keeps the registry-generated lists out of the hashed body', () => {
    for (const documentId of LEGAL_DOCUMENT_IDS) {
      const body = readBody(documentId)

      for (const item of buildAccountEmailListItems()) {
        expect(body, `${documentId} types the email list by hand`)
          .not.toContain(item.body)
      }

      for (const notice of LEGAL_NOTICES) {
        for (const line of notice.summary) {
          expect(body, `${documentId} copies ${notice.id} by hand`)
            .not.toContain(line)
        }
      }
    }
  })

  it('references the generated lists only as directives', () => {
    expect(readBody('privacy-policy')).toContain('::account-email-list\n::')

    for (const documentId of LEGAL_DOCUMENT_IDS) {
      expect(readBody(documentId)).toContain(
        `::legal-change-history{document="${documentId}"}\n::`,
      )
    }
  })

  it('hashes the file alone, so a registry change cannot move it', () => {
    for (const documentId of LEGAL_DOCUMENT_IDS) {
      expect(hashDocument(documentId)).toBe(
        hashLegalDocument(readBody(documentId)),
      )
    }
  })
})
