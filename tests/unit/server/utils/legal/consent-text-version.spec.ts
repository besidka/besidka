import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CURRENT_CONSENT_TEXT_SHA256,
  CURRENT_CONSENT_VERSION,
} from '~~/server/utils/legal/consent'

const MODAL_PATH = 'app/components/Legal/ConsentModal.client.vue'

function readConsentWording(): string[] {
  const source = readFileSync(join(process.cwd(), MODAL_PATH), 'utf-8')
  const spans = source.matchAll(
    /<span data-consent-text>([\s\S]*?)<\/span>/g,
  )

  return [...spans].map((match) => {
    return (match[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  })
}

function hashWording(wording: string[]): string {
  return createHash('sha256').update(wording.join('\n')).digest('hex')
}

describe('consent wording and version', () => {
  it('finds both consent boxes in the modal', () => {
    const wording = readConsentWording()

    expect(wording).toHaveLength(2)
    expect(wording[0]).toContain('I am 18 or over')
    expect(wording[1]).toContain('I explicitly consent')
  })

  it('pins the wording of the boxes to the consent version', () => {
    const actualHash = hashWording(readConsentWording())

    expect(
      actualHash,
      `The consent wording in ${MODAL_PATH} changed. If the change alters `
      + 'what users agree to, bump CURRENT_CONSENT_VERSION (now '
      + `${CURRENT_CONSENT_VERSION}) so everyone is asked again; either way `
      + `set CURRENT_CONSENT_TEXT_SHA256 to ${actualHash}.`,
    ).toBe(CURRENT_CONSENT_TEXT_SHA256)
  })
})
