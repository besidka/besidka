import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(resolve('app/pages/chats/[slug].vue'), 'utf8')

describe('pages/chats/[slug] created Google file card', () => {
  it('renders the card for a finished created file after the document branch',
    () => {
      const documentBranch = pageSource.indexOf('<ChatDocument')
      const googleFileBranch = pageSource.indexOf('<ChatGoogleFile')
      const textBranch = pageSource.indexOf('part.type === \'text\'')

      expect(googleFileBranch).toBeGreaterThan(documentBranch)
      expect(googleFileBranch).toBeLessThan(textBranch)
      expect(pageSource).toMatch(
        /<ChatGoogleFile\s+v-else-if="isGoogleCreatedFilePart\(part\)"\s+:part="part"/,
      )
    })

  it('orders output cards last through the shared card check', () => {
    expect(pageSource).toContain('orderOutputCardPartsLast(displayParts)')
    expect(pageSource).toContain('isGoogleCreatedFilePart,')
  })
})
